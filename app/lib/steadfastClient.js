import { getAuthInstance } from "./firebase";

// Netlify: "/.netlify/functions". Local: `npm run dev` starts the functions server and sets NEXT_PUBLIC_FUNCTIONS_URL.
// If you start plain `next dev`, we fall back to http://localhost:8899.
export const FN_BASE = process.env.NEXT_PUBLIC_FUNCTIONS_URL ||
  (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? "http://localhost:8899/.netlify/functions" : "/.netlify/functions");

// Calls the Netlify function (Steadfast keys stay on the server).
export async function callSteadfast(action, payload = {}) {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("Please sign in first.");
  const token = await user.getIdToken();
  const r = await fetch(`${FN_BASE}/steadfast-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload })
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error(`Function pawa jayni (404): ${FN_BASE}/steadfast-api . Local e hole terminal e "npm run dev" chalao (npm run dev:next noy). Netlify te hole Git/CLI diye deploy koro.`);
  if (!r.ok) throw new Error(d.error || d.message || `Request failed (${r.status})`);
  return d;
}
