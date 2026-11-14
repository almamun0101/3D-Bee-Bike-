// Server-side tests: webhook, scheduled sync, create-parcel safety. External services (Google, Firebase RTDB, Steadfast) are faked
// in-process, everything else (auth checks, ETag handling, status rules) is the real code.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── key material: service account key (for the RTDB admin token) + a Firebase-style signing cert (for user ID tokens)
const sa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dir = mkdtempSync(join(tmpdir(), "k-"));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -subj /CN=t -days 2 2>/dev/null`);
const certPem = readFileSync(`${dir}/c.pem`, "utf8"), userKey = readFileSync(`${dir}/k.pem`, "utf8");
const b64u = b => Buffer.from(b).toString("base64url");
const idToken = (over = {}) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), n = Math.floor(Date.now() / 1000);
  const c = b64u(JSON.stringify({ aud: "proj", iss: "https://securetoken.google.com/proj", sub: "u1", email: "a@b.c", iat: n - 5, exp: n + 3000, ...over }));
  return `${h}.${c}.${b64u(createSign("RSA-SHA256").update(`${h}.${c}`).sign(userKey))}`; };

process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "svc@x.iam", private_key: sa.privateKey.export({ type: "pkcs8", format: "pem" }) });
process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = "https://test-db.firebaseio.com";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "proj";
process.env.NEXT_PUBLIC_DB_ROOT = "3dbee v2";
process.env.STEADFAST_API_KEY = "k"; process.env.STEADFAST_SECRET_KEY = "s"; process.env.STEADFAST_WEBHOOK_TOKEN = "hook-secret";

// ── fake world
let db, etags, sfStatus, sfCreated, calls, failNext;
const reset = () => { db = {}; etags = {}; sfStatus = {}; sfCreated = []; calls = []; failNext = null; };
const getAt = p => p.reduce((a, k) => (a == null ? a : a[k]), db);
const setAt = (p, v) => { if (!p.length) { db = v; return; } let o = db; p.slice(0, -1).forEach(k => { o[k] = o[k] ?? {}; o = o[k]; }); if (v === null) delete o[p.at(-1)]; else o[p.at(-1)] = v; };
const J = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", ...headers } });
let tokenCalls = 0;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input)), method = init.method || "GET", h = Object.fromEntries(new Headers(init.headers || {}));
  calls.push(`${method} ${u.host}${decodeURIComponent(u.pathname)}`);
  if (u.host === "oauth2.googleapis.com") {
    tokenCalls++; const [hd, cl, sg] = new URLSearchParams(init.body).get("assertion").split(".");
    const { createVerify } = await import("node:crypto");
    assert.ok(createVerify("RSA-SHA256").update(`${hd}.${cl}`).verify(sa.publicKey, Buffer.from(sg, "base64url")), "service-account JWT signature");
    return J({ access_token: "tok123", expires_in: 3600 });
  }
  if (u.host === "www.googleapis.com") return J({ k1: certPem }, 200, { "cache-control": "max-age=300" });
  if (u.host === "test-db.firebaseio.com") {
    assert.equal(h.authorization, "Bearer tok123", "RTDB call must carry the admin token");
    const path = decodeURIComponent(u.pathname).replace(/^\//, "").replace(/\.json$/, "").split("/").filter(Boolean);
    const key = path.join("/");
    if (method === "GET") { const res = J(getAt(path) ?? null, 200, h["x-firebase-etag"] ? { etag: etags[key] || "etag-0" } : {});
      if (h["x-firebase-etag"] && failNext) { const f = failNext; failNext = null; f(); } // somebody else edits right AFTER our read
      return res; }
    if (method === "PUT") { if (h["if-match"] && h["if-match"] !== (etags[key] || "etag-0")) return J({ error: "conflict" }, 412);
      setAt(path, JSON.parse(init.body)); etags[key] = "etag-" + Math.random(); return J(JSON.parse(init.body)); }
    if (method === "PATCH") { const cur = getAt(path) || {}; setAt(path, { ...cur, ...JSON.parse(init.body) }); return J(JSON.parse(init.body)); }
  }
  if (u.host === "portal.packzy.com") {
    const m = u.pathname.match(/\/api\/v1\/(\w+)\/?(.*)$/); const [, kind, arg] = m || [];
    if (kind === "create_order") { const b = JSON.parse(init.body); sfCreated.push(b); sfStatus["inv:" + b.invoice] = "in_review"; return J({ status: 200, consignment: { consignment_id: 777, tracking_code: "TRK777", invoice: b.invoice } }); }
    const dec = decodeURIComponent(arg);
    const s = kind === "status_by_invoice" ? sfStatus["inv:" + dec] : sfStatus[dec];
    return s ? J({ status: 200, delivery_status: s }) : J({ status: 404, message: "Not found" });
  }
  throw new Error("unexpected fetch " + u.href);
};

const { default: webhook } = await import("../netlify/functions/steadfast-webhook.mjs");
const { default: createFn } = await import("../netlify/functions/steadfast.mjs");
const { runSync } = await import("../netlify/shared/syncCore.mjs");
const post = (body, token = "hook-secret") => new Request("https://x/hook", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
const seed = (id, o) => { db["3dbee v2"] = db["3dbee v2"] || { orders: {} }; db["3dbee v2"].orders[id] = { customerName: "Rahim", total: 1000, paidAmount: 200, courierName: "Steadfast", courierId: "555", orderStatus: "Ready to ship", steadfastStatus: "in_review", steadfastCreatedAt: "2026-11-13T00:00:00.000Z", ...o }; };
const order = id => db["3dbee v2"].orders[id];

test("webhook: rejects missing / wrong token, wrong method", async () => {
  reset(); seed("a", {});
  assert.equal((await webhook(post({ status: "delivered" }, null))).status, 401);
  assert.equal((await webhook(post({ status: "delivered" }, "nope"))).status, 401);
  assert.equal((await webhook(new Request("https://x/hook", { method: "PUT" }))).status, 405);
  assert.equal(order("a").steadfastStatus, "in_review", "unauthorised calls must not change anything");
});

test("webhook: delivery_status updates order, tracking fields, COD settles on delivered", async () => {
  reset(); seed("a", {});
  let r = await webhook(post({ notification_type: "delivery_status", consignment_id: 555, invoice: "3DBEE-a", status: "pending", tracking_message: "Out for delivery", updated_at: "2026-11-14 10:00:00" }));
  assert.equal(r.status, 200);
  let o = order("a");
  assert.equal(o.steadfastStatus, "pending"); assert.equal(o.orderStatus, "Shipped"); assert.equal(o.steadfastTrackingMessage, "Out for delivery");
  assert.equal(o.steadfastProviderUpdatedAt, "2026-11-14 10:00:00"); assert.ok(o.shippedAt); assert.equal(o.steadfastEvents.at(-1).source, "webhook");
  r = await webhook(post({ notification_type: "delivery_status", consignment_id: 555, invoice: "3DBEE-a", status: "delivered", cod_amount: 800, delivery_charge: 110, updated_at: "2026-11-14 15:00:00" }));
  o = order("a");
  assert.equal(o.orderStatus, "Completed"); assert.equal(o.paymentStatus, "Paid Full"); assert.equal(o.paidAmount, 1000); assert.equal(o.dueAmount, 0);
  assert.equal(o.steadfastCharge, 110); assert.equal(o.steadfastChargeActual, true); assert.ok(o.steadfastDeliveredAt);
});

test("webhook: duplicate delivery of the same event is ignored (idempotent)", async () => {
  reset(); seed("a", {});
  const ev = { notification_type: "delivery_status", consignment_id: 555, status: "pending", updated_at: "2026-11-14 10:00:00" };
  await webhook(post(ev)); const n1 = order("a").timeline.length;
  const r = await webhook(post(ev)); assert.equal((await r.json()).message, "Duplicate ignored"); assert.equal(order("a").timeline.length, n1);
});

test("webhook: tracking_update only records the message, never changes status", async () => {
  reset(); seed("a", {});
  await webhook(post({ notification_type: "tracking_update", consignment_id: 555, tracking_message: "Arrived at hub", updated_at: "2026-11-14 11:00:00" }));
  const o = order("a"); assert.equal(o.steadfastStatus, "in_review"); assert.equal(o.orderStatus, "Ready to ship"); assert.equal(o.steadfastTrackingMessage, "Arrived at hub");
});

test("webhook: unknown parcel -> 200 ignored; found by tracking code; cancelled -> Returned", async () => {
  reset(); seed("a", { steadfastTrackingCode: "TRKA" });
  assert.equal((await (await webhook(post({ consignment_id: 999, status: "delivered" }))).json()).message, "No matching order (ignored)");
  await webhook(post({ notification_type: "delivery_status", tracking_code: "trka", status: "cancelled" }));
  assert.equal(order("a").orderStatus, "Returned"); assert.ok(order("a").steadfastReturnedAt);
});

test("webhook: concurrent edit by the dashboard is not overwritten (ETag retry)", async () => {
  reset(); seed("a", {});
  failNext = () => { order("a").customerName = "Edited in dashboard"; etags["3dbee v2/orders/a"] = "etag-changed"; };
  const r = await webhook(post({ notification_type: "delivery_status", consignment_id: 555, status: "pending" }));
  assert.equal(r.status, 200); assert.equal(order("a").customerName, "Edited in dashboard"); assert.equal(order("a").steadfastStatus, "pending");
});

test("webhook: not configured -> 503 (no silent success)", async () => {
  const t = process.env.STEADFAST_WEBHOOK_TOKEN; delete process.env.STEADFAST_WEBHOOK_TOKEN;
  assert.equal((await webhook(post({}, "x"))).status, 503); process.env.STEADFAST_WEBHOOK_TOKEN = t;
});

test("scheduled sync: updates active parcels, skips finished ones, records result, rate-limits itself", async () => {
  reset(); seed("a", { courierId: "100" }); seed("b", { courierId: "200", steadfastStatus: "delivered", orderStatus: "Completed", steadfastCodSettled: true }); seed("c", { courierId: "300", steadfastSyncedAt: "2020-01-01T00:00:00Z" }); seed("d", { courierName: "", courierId: "" });
  sfStatus["100"] = "pending"; sfStatus["200"] = "delivered"; sfStatus["300"] = "delivered";
  const r = await runSync({ source: "schedule" });
  assert.equal(r.checked, 2); assert.equal(r.changed, 2); assert.equal(order("a").orderStatus, "Shipped"); assert.equal(order("c").orderStatus, "Completed");
  assert.ok(!calls.some(c => c.includes("/status_by_cid/200")), "finished parcels are not re-checked");
  const meta = db["3dbee v2"].meta.serverSync; assert.equal(meta.lastResult.checked, 2);
  assert.deepEqual(await runSync({ source: "schedule" }), { skipped: "ran less than 4 minutes ago" });
  assert.equal((await runSync({ source: "manual", force: true })).checked, 1, "a is still active, c is delivered now");
});

test("scheduled sync: one failing parcel does not stop the others; error is stored on the order", async () => {
  reset(); seed("a", { courierId: "100" }); seed("b", { courierId: "404" }); sfStatus["100"] = "pending";
  const r = await runSync({ source: "schedule", force: true });
  assert.equal(r.checked, 2); assert.equal(r.failed, 1); assert.equal(order("a").steadfastStatus, "pending"); assert.ok(order("b").steadfastSyncError);
});

test("scheduled sync: no service account -> skipped, not crashing", async () => {
  const k = process.env.FIREBASE_SERVICE_ACCOUNT; delete process.env.FIREBASE_SERVICE_ACCOUNT;
  assert.deepEqual(await runSync(), { skipped: "FIREBASE_SERVICE_ACCOUNT not set" }); process.env.FIREBASE_SERVICE_ACCOUNT = k;
});

const createReq = (body, token = idToken()) => new Request("https://x/f", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
const good = { invoice: "3DBEE-a", recipient_name: "Rahim", recipient_phone: "+8801712345678", recipient_address: "Dhaka", cod_amount: 800 };

test("create parcel: auth, validation", async () => {
  reset();
  assert.equal((await createFn(createReq(good, null))).status, 401);
  assert.equal((await createFn(createReq(good, idToken({ aud: "other" })))).status, 401);
  assert.equal((await createFn(createReq(good, idToken({ exp: 1 })))).status, 401);
  assert.equal((await createFn(createReq({ ...good, recipient_phone: "123" }))).status, 400);
  assert.equal((await createFn(createReq({ ...good, cod_amount: -5 }))).status, 400);
  assert.equal((await createFn(createReq({ ...good, invoice: "bad invoice!" }))).status, 400);
  assert.equal((await createFn(createReq({ ...good, recipient_name: "" }))).status, 400);
  assert.equal(sfCreated.length, 0, "nothing invalid may reach Steadfast");
});

test("create parcel: creates once; phone normalised; second attempt is blocked (409), no duplicate parcel", async () => {
  reset();
  const r1 = await createFn(createReq(good)); assert.equal(r1.status, 200);
  assert.equal(sfCreated.length, 1); assert.equal(sfCreated[0].recipient_phone, "01712345678"); assert.equal(sfCreated[0].cod_amount, 800);
  const r2 = await createFn(createReq(good)); assert.equal(r2.status, 409); assert.equal((await r2.json()).duplicate, true);
  assert.equal(sfCreated.length, 1);
});

test("create parcel: simultaneous double click creates only one parcel", async () => {
  reset();
  const [a, b] = await Promise.all([createFn(createReq(good)), createFn(createReq(good))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]); assert.equal(sfCreated.length, 1);
});

test("create parcel: timeout is reported as unsure and NOT retried on another base URL", async () => {
  reset(); const orig = globalThis.fetch; let creates = 0;
  globalThis.fetch = async (i, init) => { if (String(i).endsWith("/create_order")) { creates++; throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); } return orig(i, init); };
  const r = await createFn(createReq(good)); const d = await r.json();
  assert.equal(r.status, 502); assert.equal(d.unsure, true); assert.equal(creates, 1); globalThis.fetch = orig;
});
