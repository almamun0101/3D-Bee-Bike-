// Minimal Firebase Realtime Database admin access over the official REST API (no extra dependencies).
// Needs FIREBASE_SERVICE_ACCOUNT = the service-account JSON (plain or base64) and NEXT_PUBLIC_FIREBASE_DATABASE_URL.
import { createSign } from "node:crypto";

export const DB_ROOT = process.env.NEXT_PUBLIC_DB_ROOT || "3dbee v2";
const dbUrl = () => String(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");

function credentials() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    if (!j.client_email || !j.private_key) return null;
    return { email: j.client_email, key: String(j.private_key).replace(/\\n/g, "\n") };
  } catch { return null; }
}
export const adminConfigured = () => !!credentials() && !!dbUrl();

const b64u = b => Buffer.from(b).toString("base64url");
let tokenCache = { v: "", until: 0 };

async function accessToken() {
  if (tokenCache.v && Date.now() < tokenCache.until - 60000) return tokenCache.v;
  const c = credentials();
  if (!c) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing or invalid");
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({ iss: c.email, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(c.key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64u(sig)}` }),
    signal: AbortSignal.timeout(8000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google token error: ${d.error_description || d.error || r.status}`);
  tokenCache = { v: d.access_token, until: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return tokenCache.v;
}

const url = path => `${dbUrl()}/${[DB_ROOT, ...String(path).split("/").filter(Boolean)].map(encodeURIComponent).join("/")}.json`;
export class ConflictError extends Error {}

async function call(path, init = {}) {
  const token = await accessToken();
  const r = await fetch(url(path), { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
  if (r.status === 412) throw new ConflictError("Data changed while saving");
  if (!r.ok) throw new Error(`Firebase ${init.method || "GET"} ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r;
}

export const dbGet = async path => (await call(path)).json();
// read with an ETag, so the write below can detect that somebody else changed the order in between
export async function dbGetWithEtag(path) {
  const r = await call(path, { headers: { "X-Firebase-ETag": "true" } });
  return { data: await r.json(), etag: r.headers.get("etag") };
}
export const dbPut = (path, data, etag) => call(path, { method: "PUT", body: JSON.stringify(data), headers: etag ? { "If-Match": etag } : {} });
export const dbPatch = (path, data) => call(path, { method: "PATCH", body: JSON.stringify(data) });
