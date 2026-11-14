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

// Creating a parcel must NEVER be sent twice. We only move to the next base URL when the connection could not even be opened;
// after a timeout / unclear failure we stop, because Steadfast may already have created the parcel.
const NOT_REACHED = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED"]);
export async function sfPost(path, body) {
  let last = "";
  for (const base of BASES) {
    let r;
    try {
      r = await fetch(`${base}/${path}`, {
        method: "POST",
        headers: { "Api-Key": process.env.STEADFAST_API_KEY.trim(), "Secret-Key": process.env.STEADFAST_SECRET_KEY.trim(), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
    } catch (e) {
      if (NOT_REACHED.has(e?.cause?.code)) { last = `${base} -> ${why(e)}`; continue; }
      const err = new Error("Steadfast did not answer in time. The parcel MAY have been created - check Steadfast / use Sync before trying again.");
      err.unsure = true; throw err;
    }
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) || "Invalid response from Steadfast" }; }
    return { status: r.status, data };
  }
  throw new Error(`Could not reach Steadfast: ${last}`);
}

// Tracking ID -> Steadfast status. Tries consignment id, tracking code and invoice automatically.
const isNum = s => /^\d+$/.test(s);
export async function resolveStatus(ids) {
  let lastMsg = "";
  for (const id of (ids || []).slice(0, 3)) {
    const c = String(id || "").trim();
    if (!c) continue;
    const kinds = isNum(c) ? ["status_by_cid", "status_by_trackingcode", "status_by_invoice"] : ["status_by_trackingcode", "status_by_invoice", "status_by_cid"];
    for (const kind of kinds) {
      const d = await sf(`${kind}/${encodeURIComponent(c)}`);
      if (d && d.delivery_status) return { status: d.delivery_status, matchedBy: kind, matchedId: c };
      lastMsg = d?.message || lastMsg;
      if (/unauthor|invalid.*(key|secret)/i.test(lastMsg)) return { error: "Steadfast API key/secret bhul (Unauthorized)" };
    }
  }
  return { error: lastMsg || "Steadfast e ei ID pawa jayni" };
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
