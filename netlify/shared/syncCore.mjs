// Server-side synchronisation: applies Steadfast data to orders in Firebase (used by the scheduled sync, "Sync now" and the webhook).
// The status rules live in app/lib/shared.js (buildSyncPatch) - the same code the dashboard uses.
import { adminConfigured, dbGet, dbGetWithEtag, dbPut, dbPatch, ConflictError } from "./firebaseAdmin.mjs";
import { resolveStatus } from "./steadfast.mjs";
import { buildSyncPatch, isSteadfast, sfIds, sfGroup, isDone } from "../../app/lib/shared.js";

const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

// Reads the order, lets `fn(order)` return a patch, writes it back only if nobody changed the order meanwhile (ETag), retries on conflict.
export async function updateOrder(id, fn, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const { data, etag } = await dbGetWithEtag(`orders/${id}`);
    if (!data || typeof data !== "object") return null;
    const order = { ...data, id };
    const out = fn(order);
    if (!out || !out.patch) return { order, patch: {}, skipped: out?.reason || "no change" };
    const next = strip({ ...data, ...out.patch });
    try { await dbPut(`orders/${id}`, next, etag); return { order: { ...next, id }, patch: out.patch, info: out }; }
    catch (e) { if (!(e instanceof ConflictError) || i === tries - 1) throw e; }
  }
  return null;
}

export async function syncOne(o, source = "sync") {
  const now = new Date().toISOString();
  const r = await resolveStatus(sfIds(o));
  const res = await updateOrder(o.id, fresh => {
    const out = buildSyncPatch(fresh, r.error ? { error: r.error } : { ...r, source }, now);
    return { patch: out.patch, changed: out.changed, ok: out.ok };
  });
  return { id: o.id, ok: !!res?.info?.ok, changed: !!res?.info?.changed, status: res?.order?.steadfastStatus, error: r.error };
}

const dueFirst = (a, b) => String(a.steadfastSyncedAt || "").localeCompare(String(b.steadfastSyncedAt || ""));

// One scheduled / manual run: oldest-checked active parcels first, limited so it always finishes inside the function time limit.
export async function runSync({ source = "schedule", force = false, limit = 18, budgetMs = 20000 } = {}) {
  if (!adminConfigured()) return { skipped: "FIREBASE_SERVICE_ACCOUNT not set" };
  const started = Date.now();
  const meta = (await dbGet("meta/serverSync").catch(() => null)) || {};
  if (!force && meta.lastRunAt && started - Date.parse(meta.lastRunAt) < 4 * 60 * 1000) return { skipped: "ran less than 4 minutes ago" };
  await dbPatch("meta/serverSync", { lastRunAt: new Date(started).toISOString(), lastSource: source });
  const all = (await dbGet("orders")) || {};
  const active = Object.entries(all).filter(([, v]) => v && typeof v === "object")
    .map(([id, v]) => ({ ...v, id }))
    .filter(o => isSteadfast(o) && sfIds(o).length && !["delivered", "cancelled"].includes(sfGroup(o)) && !isDone(o.orderStatus))
    .sort(dueFirst).slice(0, limit);
  const res = { checked: 0, changed: 0, failed: 0, errors: [] };
  for (let i = 0; i < active.length && Date.now() - started < budgetMs; i += 4) {
    const batch = active.slice(i, i + 4);
    const out = await Promise.all(batch.map(o => syncOne(o, source).catch(e => ({ id: o.id, ok: false, error: e.message }))));
    for (const x of out) { res.checked++; if (x.changed) res.changed++; if (!x.ok) { res.failed++; if (res.errors.length < 5) res.errors.push(`${x.id}: ${x.error || "failed"}`); } }
  }
  await dbPatch("meta/serverSync", { finishedAt: new Date().toISOString(), lastResult: { checked: res.checked, changed: res.changed, failed: res.failed, activeTotal: active.length, ms: Date.now() - started }, lastError: res.errors[0] || null });
  return res;
}

// Webhook -> order. Finds the order by our invoice (3DBEE-<orderId>), else by consignment id / tracking code.
export async function findOrderId({ invoice, consignmentId, trackingCode }) {
  const m = String(invoice || "").match(/^3DBEE-(.+)$/);
  if (m) { const hit = await dbGet(`orders/${encodeURIComponent(m[1])}/courierName`).catch(() => null); if (hit !== null) return m[1]; }
  const all = (await dbGet("orders")) || {};
  const want = [consignmentId, trackingCode].map(x => String(x ?? "").trim().toLowerCase()).filter(Boolean);
  for (const [id, v] of Object.entries(all)) {
    if (!v || typeof v !== "object") continue;
    const have = [v.courierId, v.steadfastTrackingCode].map(x => String(x ?? "").trim().toLowerCase()).filter(Boolean);
    if (want.some(w => have.includes(w))) return id;
  }
  return null;
}
