import { getAuthInstance } from "./firebase";

// Netlify: "/.netlify/functions". Local: `npm run dev` starts the functions server and sets NEXT_PUBLIC_FUNCTIONS_URL.
// If you start plain `next dev`, we fall back to http://localhost:8899.
export const FN_BASE = process.env.NEXT_PUBLIC_FUNCTIONS_URL ||
  (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? "http://localhost:8899/.netlify/functions" : "/.netlify/functions");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const READ_ONLY = new Set(["status", "balance", "payments", "payment", "health", "tracking"]);

// Calls the Netlify function (Steadfast keys stay on the server).
// Read-only actions get a timeout and up to 2 retries on network errors / 502-504. Actions that change data are never retried automatically.
export async function callSteadfast(action, payload = {}) {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("Please sign in first.");
  const attempts = READ_ONLY.has(action) ? 3 : 1;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const token = await user.getIdToken();
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), action === "serverSync" ? 60000 : 25000);
      let r;
      try { r = await fetch(`${FN_BASE}/steadfast-api`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...payload }), signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      const d = await r.json().catch(() => ({}));
      if (r.status === 404 && !d.error) throw Object.assign(new Error(`Function pawa jayni (404): ${FN_BASE}/steadfast-api . Local e hole terminal e "npm run dev" chalao (npm run dev:next noy). Netlify te hole Git/CLI diye deploy koro.`), { fatal: true });
      if (!r.ok) throw Object.assign(new Error(d.error || d.message || `Request failed (${r.status})`), { fatal: ![502, 503, 504].includes(r.status) || r.status === 503 && /missing|needs/i.test(d.error || "") });
      return d;
    } catch (e) {
      lastErr = e.name === "AbortError" ? Object.assign(new Error("Steadfast took too long to answer. Try again."), { fatal: false }) : e instanceof TypeError ? Object.assign(new Error("No internet connection to the server."), { fatal: false }) : e;
      if (lastErr.fatal || i === attempts - 1) break;
      await sleep(700 * (i + 1));
    }
  }
  throw lastErr;
}
