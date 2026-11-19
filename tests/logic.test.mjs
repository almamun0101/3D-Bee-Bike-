// Pure-logic tests: monitoring tiers, settings validation, tracking links, alerts, sync patch (status switching, tracking fields).
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMonitor, DEFAULT_MONITOR, monitorInfo, tierOf, trackingLinkOf, fmtDuration, fromDhakaInput, toDhakaInput, monitorSummary, followUpDue } from "../app/lib/monitor.js";
import { buildSyncPatch, codInfo, itemPrice, DEFAULT_PRICES, itemsText, itemsOfOrder, phoneOf, addressOf, trackingIdOf, customerInfoText, orderSummaryText } from "../app/lib/shared.js";
import { buildAlerts } from "../app/lib/alerts.js";
import { normalizeBrand, DEFAULT_BRAND } from "../app/lib/brand.js";
import { banglaMessage, messageKind, toBn, whatsappNumber } from "../app/lib/messages.js";

const cfg = normalizeMonitor(null), H = 3600000, now = Date.parse("2026-11-14T12:00:00Z");
const ago = h => new Date(now - h * H).toISOString();
const mk = o => ({ id: "a", courierName: "Steadfast", courierId: "111", orderStatus: "Shipped", steadfastStatus: "pending", ...o });

test("settings: defaults, sorting, rejects bad values and non-http tracking templates", () => {
  assert.deepEqual(cfg.tiers, [24, 48, 72, 96]);
  assert.deepEqual(normalizeMonitor({ tiers: [96, 12, 48, 24], stuckHours: 6 }).tiers, [12, 24, 48, 96]);
  assert.deepEqual(normalizeMonitor({ tiers: [1, 1, 2, 3] }).tiers, DEFAULT_MONITOR.tiers);
  assert.deepEqual(normalizeMonitor({ tiers: [-1, 2, 3, 4] }).tiers, DEFAULT_MONITOR.tiers);
  assert.equal(normalizeMonitor({ trackingUrlTemplate: "javascript:alert({code})" }).trackingUrlTemplate, "");
  assert.equal(normalizeMonitor({ trackingUrlTemplate: "https://x.test/t/" }).trackingUrlTemplate, "");
  assert.equal(normalizeMonitor({ trackingUrlTemplate: "https://x.test/t/{code}" }).trackingUrlTemplate, "https://x.test/t/{code}");
});

test("tiers: 24 / 48 / 72 / 96 hour boundaries", () => {
  [[0, 0], [23.9, 0], [24, 1], [47.9, 1], [48, 2], [72, 3], [96, 4], [300, 4]].forEach(([h, t]) => assert.equal(tierOf(h, cfg.tiers), t, `h=${h}`));
  assert.equal(tierOf(30, [12, 24, 36, 48]), 2);
});

test("monitorInfo: delayed / stuck / failed / delivered / returned / timeline start", () => {
  let m = monitorInfo(mk({ steadfastCreatedAt: ago(50), steadfastLastEventAt: ago(2) }), cfg, now);
  assert.equal(m.tier, 2); assert.equal(m.delayed, true); assert.equal(m.stuck, false); assert.equal(Math.round(m.hours), 50);
  m = monitorInfo(mk({ steadfastCreatedAt: ago(10), steadfastLastEventAt: ago(30) }), cfg, now); assert.equal(m.stuck, true); assert.equal(m.delayed, false);
  assert.equal(monitorInfo(mk({ steadfastStatus: "hold", steadfastCreatedAt: ago(5) }), cfg, now).stuck, true);
  m = monitorInfo(mk({ steadfastStatus: "delivered", orderStatus: "Completed", steadfastCreatedAt: ago(60), steadfastDeliveredAt: ago(20) }), cfg, now);
  assert.equal(m.delivered, true); assert.equal(Math.round(m.hours), 40); assert.equal(m.tier, 0); assert.equal(m.delayed, false);
  assert.equal(monitorInfo(mk({ steadfastStatus: "cancelled", orderStatus: "Returned" }), cfg, now).returned, true);
  m = monitorInfo(mk({ timeline: [{ status: "Pending", at: ago(100) }, { status: "Shipped", at: ago(80) }] }), cfg, now); assert.equal(Math.round(m.hours), 80); assert.equal(m.tier, 3);
  assert.equal(monitorInfo({ id: "x", orderStatus: "Pending" }, cfg, now), null);
});

test("failed: never-matched ID is failed at once, a matched parcel only after 3 failed checks in a row", () => {
  const never = mk({ steadfastStatus: undefined, steadfastSyncError: "not found", steadfastSyncFailures: 1 });
  assert.equal(monitorInfo(never, cfg, now).failed, true);
  const once = mk({ steadfastSyncError: "timeout", steadfastSyncFailures: 1, steadfastCreatedAt: ago(5) });
  assert.equal(monitorInfo(once, cfg, now).failed, false);
  assert.equal(monitorInfo({ ...once, steadfastSyncFailures: 3 }, cfg, now).failed, true);
  const r1 = buildSyncPatch(mk({}), { error: "x" }, ago(0)); assert.equal(r1.patch.steadfastSyncFailures, 1);
  const r2 = buildSyncPatch(mk({ steadfastSyncFailures: 2 }), { error: "x" }, ago(0)); assert.equal(r2.patch.steadfastSyncFailures, 3);
  assert.equal(buildSyncPatch(mk({ steadfastSyncFailures: 2, steadfastSyncError: "x" }), { status: "pending" }, ago(0)).patch.steadfastSyncFailures, null);
});

test("tracking link: only Steadfast's own link or the user's template - never invented", () => {
  assert.equal(trackingLinkOf(mk({}), cfg), "");
  assert.equal(trackingLinkOf(mk({ trackingUrl: "https://real.test/abc" }), cfg), "https://real.test/abc");
  assert.equal(trackingLinkOf(mk({ steadfastResponse: { consignment: { tracking_link: "https://sf.test/x" } } }), cfg), "https://sf.test/x");
  assert.equal(trackingLinkOf(mk({ trackingUrl: "javascript:alert(1)" }), cfg), "");
  const c2 = normalizeMonitor({ trackingUrlTemplate: "https://x.test/t/{code}" });
  assert.equal(trackingLinkOf(mk({ steadfastTrackingCode: "15BA EB" }), c2), "https://x.test/t/15BA%20EB");
  assert.equal(trackingLinkOf(mk({}), c2), "https://x.test/t/111");
});

test("formatting + Dhaka datetime-local round trip", () => {
  assert.equal(fmtDuration(0.2), "12m"); assert.equal(fmtDuration(5.5), "5h 30m"); assert.equal(fmtDuration(52), "2d 4h"); assert.equal(fmtDuration(NaN), "—");
  assert.equal(fromDhakaInput("2026-11-14T18:00"), "2026-11-14T12:00:00.000Z"); assert.equal(toDhakaInput("2026-11-14T12:00:00.000Z"), "2026-11-14T18:00"); assert.equal(fromDhakaInput("garbage"), "");
});

test("follow-ups + summary numbers", () => {
  assert.equal(followUpDue({ followUpAt: ago(1) }, now), true); assert.equal(followUpDue({ followUpAt: ago(1), followUpDone: true }, now), false); assert.equal(followUpDue({ followUpAt: new Date(now + H).toISOString() }, now), false);
  const s = monitorSummary([mk({ id: "1", steadfastCreatedAt: ago(100) }), mk({ id: "2", steadfastCreatedAt: ago(30), steadfastLastEventAt: ago(1) }), mk({ id: "3", steadfastStatus: "delivered", orderStatus: "Completed", steadfastCreatedAt: ago(40), steadfastDeliveredAt: ago(1) }), { id: "4" }], cfg, now);
  assert.deepEqual([s.parcels, s.active, s.delayed, s.tiers[4], s.tiers[1], s.delivered, s.onTimePct], [3, 2, 2, 1, 1, 1, 100]);
});

test("alerts: one per tier crossing, stuck, failed, follow-up; a higher tier alerts again", () => {
  const a1 = buildAlerts([mk({ steadfastCreatedAt: ago(50), steadfastLastEventAt: ago(1) })], cfg, { a: 7 }, now);
  assert.deepEqual(a1.map(a => a.kind), ["delay"]); assert.match(a1[0].title, /#7.*over 48h/); assert.equal(a1[0].key, "delay:a:2");
  const a2 = buildAlerts([mk({ steadfastCreatedAt: ago(80), steadfastLastEventAt: ago(1) })], cfg, {}, now); assert.equal(a2[0].key, "delay:a:3");
  const kinds = buildAlerts([mk({ steadfastCreatedAt: ago(5), steadfastLastEventAt: ago(30), steadfastSyncError: "x", steadfastSyncFailures: 5, followUpAt: ago(1) })], cfg, {}, now).map(a => a.kind).sort();
  assert.deepEqual(kinds, ["failed", "followup", "stuck"]);
  assert.deepEqual(buildAlerts([mk({ steadfastStatus: "delivered", orderStatus: "Completed", steadfastCreatedAt: ago(200), steadfastDeliveredAt: ago(1) })], cfg, {}, now), []);
});

test("sync patch: courier status moves the order forward, never backwards; delivery settles COD", () => {
  const base = { id: "z", courierName: "Steadfast", courierId: "9", total: 500, paidAmount: 0 };
  const run = (st, courier) => buildSyncPatch({ ...base, orderStatus: st }, { status: courier }, ago(0)).patch.orderStatus;
  assert.equal(run("Printing", "in_review"), "Ready to ship"); assert.equal(run("Pending", "pending"), "Shipped"); assert.equal(run("Ready to ship", "pending"), "Shipped");
  assert.equal(run("Shipped", "hold"), undefined); assert.equal(run("Completed", "pending"), undefined); assert.equal(run("Cancelled", "pending"), undefined);
  assert.equal(run("Shipped", "cancelled"), "Returned");
  const d = buildSyncPatch({ ...base, orderStatus: "Shipped" }, { status: "delivered" }, ago(0)).patch;
  assert.deepEqual([d.orderStatus, d.paymentStatus, d.dueAmount], ["Completed", "Paid Full", 0]);
  assert.equal(codInfo({ ...base, orderStatus: "Shipped", steadfastStatus: "pending" }).state, "collect");
});

test("sync patch: tracking fields, event log, no duplicate events", () => {
  const base = { id: "z", courierName: "Steadfast", courierId: "9", orderStatus: "Printing", total: 500, paidAmount: 0 };
  let r = buildSyncPatch(base, { status: "pending", message: "Out for delivery", providerUpdatedAt: "2026-11-14 18:00:00", source: "webhook" }, ago(0));
  assert.deepEqual([r.patch.orderStatus, r.patch.shippedAt, r.patch.steadfastTrackingMessage, r.patch.steadfastEvents.length, r.patch.steadfastEvents[0].source], ["Shipped", ago(0), "Out for delivery", 1, "webhook"]);
  const b2 = { ...base, ...r.patch };
  r = buildSyncPatch(b2, { status: "pending" }, ago(-1)); assert.equal(r.patch.steadfastEvents, undefined); assert.equal(r.changed, false);
  r = buildSyncPatch(b2, { status: "cancelled" }, ago(-2)); assert.deepEqual([r.patch.orderStatus, r.patch.steadfastReturnedAt], ["Returned", ago(-2)]);
});

test("pricing: Front bike 250, Front scooter 350, Back 500; custom size adds only the configured extra", () => {
  assert.deepEqual(DEFAULT_PRICES, { bikeFront: 250, scooterFront: 350, bikeBack: 500, scooterBack: 500, customExtra: 0 });
  const p = (v, s, t, P) => itemPrice(v, s, t, P);
  assert.equal(p("Bike", "Front Side", "BRTA"), 250); assert.equal(p("Scooter", "Front Side", "BRTA"), 350);
  assert.equal(p("Bike", "Back Side", "BRTA"), 500); assert.equal(p("Scooter", "Back Side", "BRTA"), 500);
  assert.equal(p("Bike", "Front Side", "Custom"), 250, "custom costs the same until an extra is set");
  assert.equal(p("Scooter", "Back Side", "Custom", { ...DEFAULT_PRICES, customExtra: 50 }), 550);
  assert.equal(p(undefined, undefined, undefined), 250, "unknown values fall back to Bike / Front / BRTA");
  assert.equal(p("Bike", "Front Side", "BRTA", { bikeFront: "300" }), 300, "string prices from Firebase are numbers");
});

test("items text mentions Scooter; old orders without vehicle still read as a bike", () => {
  assert.equal(itemsText([{ name: "A 1", vehicle: "Scooter", side: "Back Side", type: "Custom", qty: 2 }]), "A 1 · Scooter · Back · Custom ×2");
  assert.equal(itemsText([{ name: "A 1", side: "Front Side", type: "BRTA", qty: 1 }]), "A 1 · Front · BRTA");
  const legacy = itemsOfOrder({ bikeNumbers: "OLD 5", quantity: 2, unitPrice: 300 })[0];
  assert.deepEqual([legacy.vehicle, legacy.side, legacy.qty, legacy.price], ["Bike", "Front Side", 2, 300]);
});

test("copy helpers: customer info, phone, address, tracking id, full summary", () => {
  const o = { id: "a", customerName: "Rahim", courierRecipientPhone: "01711111111", courierRecipientAddress: "House 5, Mirpur", bikeNumbers: "DHAKA 1 · Front · BRTA", items: [{ name: "DHAKA 1", vehicle: "Scooter", side: "Back Side", type: "BRTA", qty: 2, price: 500 }], total: 1080, paidAmount: 500, courierId: "9ABC1", instructions: "Black plate" };
  assert.equal(customerInfoText(o), "Rahim\n01711111111\nHouse 5, Mirpur");
  assert.equal(trackingIdOf(o), "9ABC1"); assert.equal(trackingIdOf({ steadfastTrackingCode: "TRK9" }), "TRK9"); assert.equal(trackingIdOf({}), "");
  const sum = orderSummaryText({ ...o, dueAmount: 580 }, 12);
  assert.match(sum, /^#12 Rahim\n01711111111\nHouse 5, Mirpur\n\nItems: DHAKA 1 · Scooter · Back · BRTA ×2/);
  assert.match(sum, /Note: Black plate/); assert.match(sum, /Tracking ID: 9ABC1$/); assert.match(sum, /Due ৳580/);
  // old orders: phone + address come from the single "customer info" text
  const old = { customerName: "Karim", customerDetails: "01822222222, Road 3, Dhanmondi" };
  assert.equal(phoneOf(old), "01822222222"); assert.equal(addressOf(old), "Road 3, Dhanmondi");
  assert.equal(customerInfoText({ customerName: "Only Name" }), "Only Name");
  assert.doesNotMatch(orderSummaryText({ customerName: "X", items: [{ name: "P", side: "Front Side", type: "BRTA", qty: 1, price: 250 }], total: 250 }, 1), /Tracking ID/);
});


test("brand settings: defaults, no guessed page link, invalid links dropped", () => {
  assert.deepEqual(normalizeBrand(null), DEFAULT_BRAND); assert.equal(DEFAULT_BRAND.pageUrl, "", "no page link is built in");
  assert.equal(normalizeBrand({ pageUrl: "https://www.facebook.com/3dbee" }).pageUrl, "https://www.facebook.com/3dbee");
  for (const bad of ["javascript:alert(1)", "facebook.com/x", "https://nodot", "ftp://x.y/z", "https://a b.com", "https://" + "x".repeat(300) + ".com"]) assert.equal(normalizeBrand({ pageUrl: bad }).pageUrl, "", bad);
  assert.equal(normalizeBrand({ pageName: "  " }).pageName, "3D Bee"); assert.equal(normalizeBrand({ pageName: "x".repeat(90) }).pageName.length, 40);
  assert.deepEqual([normalizeBrand({ thankYou: false }).thankYou, normalizeBrand({ banglaLine: false }).banglaLine, normalizeBrand({}).thankYou], [false, false, true]);
  assert.equal(normalizeBrand({ tagline: "" }).tagline, "", "an empty marketing line stays empty");
});

const order = { id: "a", customerName: "Rahim", courierRecipientPhone: "01711111111", courierRecipientAddress: "House 5, Mirpur", total: 1430, paidAmount: 500, deliveryFee: 80, instructions: "Black plate", orderStatus: "Pending",
  items: [{ name: "DHAKA-METRO-HA 11-2233", vehicle: "Scooter", side: "Back Side", type: "BRTA", qty: 2, price: 500 }, { name: "DHAKA-METRO-HA 11-2233", vehicle: "Scooter", side: "Front Side", type: "Custom", qty: 1, price: 350 }] };

test("bangla message: confirmation has every detail with correct amounts", () => {
  assert.equal(toBn("Tk 1,430 #12"), "Tk ১,৪৩০ #১২");
  const m = banglaMessage(order, 12, { brand: { pageName: "3D Bee", pageUrl: "" } });
  for (const part of ["প্রিয় Rahim,", "অর্ডার নম্বর: #১২", "১) DHAKA-METRO-HA 11-2233 — স্কুটার পেছনের প্লেট (BRTA সাইজ) × ২ = ১,০০০ টাকা", "২) DHAKA-METRO-HA 11-2233 — স্কুটার সামনের প্লেট (কাস্টম সাইজ) × ১ = ৩৫০ টাকা",
    "ডেলিভারি চার্জ: ৮০ টাকা (ঢাকার ভেতরে)", "সর্বমোট: ১,৪৩০ টাকা", "পরিশোধিত: ৫০০ টাকা", "বাকি টাকা: ৯৩০ টাকা", "House 5, Mirpur", "01711111111", "নোট: Black plate", "— 3D Bee"]) assert.ok(m.includes(part), part);
  assert.ok(!/https?:/.test(m), "no link when none was configured");
  assert.ok(banglaMessage(order, 12, { bnDigits: false }).includes("সর্বমোট: 1,430 টাকা"), "English digits on request");
});

test("bangla message: kinds by status, shipping details, paid-in-full wording, page link only when set", () => {
  assert.deepEqual([messageKind(order), messageKind({ ...order, orderStatus: "Shipped" }), messageKind({ ...order, orderStatus: "Ready to ship", courierId: "9" }), messageKind({ ...order, orderStatus: "Completed" })], ["confirm", "shipping", "shipping", "thanks"]);
  const ship = banglaMessage({ ...order, orderStatus: "Shipped", courierId: "1234567", courierName: "Steadfast" }, 12, { link: "https://t.example/1234567", bnDigits: false });
  for (const part of ["কুরিয়ারে পাঠানো হয়েছে", "কুরিয়ার: Steadfast", "ট্র্যাকিং আইডি: 1234567", "ট্র্যাকিং লিংক: https://t.example/1234567", "ডেলিভারির সময় কুরিয়ারকে দিতে হবে: 930 টাকা"]) assert.ok(ship.includes(part), part);
  assert.ok(!banglaMessage({ ...order, orderStatus: "Shipped", courierId: "1" }, 1, {}).includes("ট্র্যাকিং লিংক"), "no tracking link line without a link");
  assert.ok(banglaMessage({ ...order, paidAmount: 1430 }, 1, {}).includes("সম্পূর্ণ টাকা পরিশোধিত"));
  const thanks = banglaMessage({ ...order, orderStatus: "Completed" }, 5, { brand: { pageName: "3D Bee", pageUrl: "https://www.facebook.com/3dbee" } });
  assert.ok(thanks.includes("ডেলিভারি হয়েছে") && thanks.endsWith("https://www.facebook.com/3dbee"));
  assert.equal(banglaMessage({ customerName: "", items: [] }, 1, {}).split("\n")[0], "প্রিয় গ্রাহক,");
});

test("whatsapp number: only valid Bangladesh mobiles, with country code", () => {
  assert.equal(whatsappNumber("01711111111"), "8801711111111"); assert.equal(whatsappNumber("+880 1711-111111"), "8801711111111");
  assert.equal(whatsappNumber("12345"), ""); assert.equal(whatsappNumber(""), "");
});
