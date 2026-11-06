// Runs the Netlify functions locally (no Netlify CLI needed): http://localhost:8888/.netlify/functions/<name>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// load .env.local / .env into process.env (server-side keys + Firebase project id)
for (const file of [".env", ".env.local"]) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

export function startFunctionsServer(startPort = 8899) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
    const m = (req.url || "").split("?")[0].match(/^\/\.netlify\/functions\/([\w-]+)$/);
    const file = m && path.join(root, "netlify", "functions", `${m[1]}.mjs`);
    if (!file || !fs.existsSync(file)) { res.writeHead(404, { ...CORS, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "Function not found" })); }
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      const { default: handler } = await import(pathToFileURL(file).href + `?t=${Date.now()}`);   // fresh import = live edits
      const r = await handler(request);
      res.writeHead(r.status, { ...CORS, "Content-Type": r.headers.get("content-type") || "application/json" });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  // port busy? try the next one
  return new Promise((resolve, reject) => {
    let port = startPort;
    server.on("error", e => { if (e.code === "EADDRINUSE" && port < startPort + 15) { port++; server.listen(port); } else reject(e); });
    server.on("listening", () => { console.log(`✅ Netlify functions running on http://localhost:${port}/.netlify/functions/`); resolve(port); });
    server.listen(port);
  });
}
