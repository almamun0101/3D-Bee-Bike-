import { createVerify } from "node:crypto";

// Shared helpers for Steadfast Netlify functions (server side only)
const BASES = [process.env.STEADFAST_BASE_URL, "https://portal.packzy.com/api/v1", "https://portal.steadfast.com.bd/api/v1"]
  .filter(Boolean).map(u => u.replace(/\/+$/, "")).filter((u, i, a) => a.indexOf(u) === i);

export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const missingCreds = () => !process.env.STEADFAST_API_KEY || !process.env.STEADFAST_SECRET_KEY;

const why = e => (e?.cause?.code ? `${e.cause.code}${e.cause.hostname ? " (" + e.cause.hostname + ")" : ""}` : e?.message || "unknown error");

// Calls Steadfast. Tries every base URL, so one blocked domain does not break everything.
export async function sf(path) {
  let last = "";
  for (const base of BASES) {
    try {
      const r = await fetch(`${base}/${path}`, {
        headers: { "Api-Key": process.env.STEADFAST_API_KEY.trim(), "Secret-Key": process.env.STEADFAST_SECRET_KEY.trim(), "Content-Type": "application/json", Accept: "application/json" },
        signal: AbortSignal.timeout(8000)
      });
      const text = await r.text();
      try { return JSON.parse(text); } catch { last = `${base} -> JSON na (HTTP ${r.status})`; }
    } catch (e) { last = `${base} -> ${why(e)}`; }
  }
  throw new Error(`Steadfast e connect hocche na: ${last}`);
}

// ── Firebase ID token verification (standard method: RS256 signature against Google's public certs) ──
const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certCache = { certs: null, until: 0 };

async function getCerts(force) {
  if (!force && certCache.certs && Date.now() < certCache.until) return certCache.certs;
  const r = await fetch(CERT_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Google certs HTTP ${r.status}`);
  const maxAge = Number((r.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1]) || 3600;
  certCache = { certs: await r.json(), until: Date.now() + maxAge * 1000 };
  return certCache.certs;
}

const b64 = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

async function checkToken(token, project) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("token format bhul");
  const header = JSON.parse(b64(parts[0]).toString());
  const claims = JSON.parse(b64(parts[2 - 1]).toString());
  if (header.alg !== "RS256" || !header.kid) throw new Error("token algorithm bhul");
  let certs = await getCerts(false);
  if (!certs[header.kid]) certs = await getCerts(true);
  if (!certs[header.kid]) throw new Error("signing key pawa jayni");
  const ok = createVerify("RSA-SHA256").update(parts[0] + "." + parts[1]).verify(certs[header.kid], b64(parts[2]));
  if (!ok) throw new Error("signature mile nai");
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) throw new Error("token expire hoye geche, abar login koro");
  if (claims.iat && claims.iat > now + 300) throw new Error("computer er ghori (time) thik nai");
  if (claims.aud !== project) throw new Error(`Firebase project mile nai (token: ${claims.aud}, server: ${project})`);
  if (claims.iss !== "https://securetoken.google.com/" + project) throw new Error("issuer mile nai");
  if (!claims.sub) throw new Error("user id nai");
  return claims;
}

export async function verifyUser(request) {
  const bearer = request.headers.get("authorization") || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  if (!token) return { error: json({ error: "Authentication required" }, 401) };
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  if (!project) return { error: json({ error: "Server e NEXT_PUBLIC_FIREBASE_PROJECT_ID nai. .env.local (ba Netlify env) e Firebase project ID dao, tarpor restart koro." }, 500) };
  try {
    const identity = await checkToken(token, project);
    const allowed = process.env.STEADFAST_ALLOWED_EMAIL;
    if (allowed && String(identity.email || "").toLowerCase() !== allowed.toLowerCase())
      return { error: json({ error: "This account is not allowed to use courier features." }, 403) };
    return { identity };
  } catch (e) {
    return { error: json({ error: `Firebase sign-in verify hoyni: ${e.message}` }, 401) };
  }
}
