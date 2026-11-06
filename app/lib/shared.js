// Helpers shared by the dashboard, Courier tab and Analytics tab.
export const DAY = 86400000;
export const money = n => `৳${Number(n || 0).toLocaleString("en-BD")}`;
export const isPaid = s => /^paid/i.test(s || "");
export const isDone = s => /deliver|complet|cancel|return/i.test(s || "");
export const getDue = o => Math.max(0, Number(o?.total || 0) - Number(o?.paidAmount || (isPaid(o?.paymentStatus) ? o?.total : 0)) - Number(o?.deliveryChargePaidAmount || 0));
export const fmtDate = v => {
  const d = new Date(v);
  if (!v || isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(String(v))) return v || "—";
  return d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });
};
export const num = v => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
export const pick = (o, ks) => { for (const k of ks) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; };
export const compact = v => { const a = Math.abs(v); return a >= 100000 ? (v / 100000).toFixed(1).replace(/\.0$/, "") + "L" : a >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(Math.round(v)); };

// order time (createdAt, or orderDate in yyyy-mm-dd / dd/mm/yyyy)
export const orderTime = o => {
  const t = Date.parse(o?.createdAt);
  if (!isNaN(t)) return t;
  const s = String(o?.orderDate || "");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00+06:00`);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Date.parse(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00+06:00`);
  return NaN;
};
export const dhakaDay = t => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

// ── courier helpers ──
export const courierOf = o => { const n = String(o?.courierName || "").trim(); return n || (o?.courierId ? "Steadfast" : ""); };
export const isSteadfast = o => /steadfast/i.test(courierOf(o));
// ids we try against Steadfast (tracking id = Steadfast consignment id / tracking code / our invoice)
export const sfIds = o => {
  const ids = [o?.courierId, o?.steadfastTrackingCode].map(x => String(x ?? "").trim()).filter(Boolean);
  if (ids.length) ids.push(`3DBEE-${o.id}`);
  return [...new Set(ids)].slice(0, 3);
};

export const SF = {
  in_review: { label: "In review", tone: "amber", group: "active", delivery: "Ready for pickup" },
  pending: { label: "On the way", tone: "blue", group: "active", delivery: "In transit" },
  hold: { label: "On hold", tone: "violet", group: "hold", delivery: "On hold" },
  delivered: { label: "Delivered", tone: "green", group: "delivered", delivery: "Delivered" },
  delivered_approval_pending: { label: "Delivered (approval pending)", tone: "green", group: "delivered", delivery: "Delivered" },
  partial_delivered: { label: "Partially delivered", tone: "green", group: "delivered", partial: true, delivery: "Partially delivered" },
  partial_delivered_approval_pending: { label: "Partially delivered (approval pending)", tone: "green", group: "delivered", partial: true, delivery: "Partially delivered" },
  cancelled: { label: "Cancelled / Returned", tone: "red", group: "cancelled", delivery: "Returned" },
  cancelled_approval_pending: { label: "Cancelled (approval pending)", tone: "red", group: "cancelled", delivery: "Returned" },
  unknown: { label: "Unknown", tone: "amber", group: "unknown" },
  unknown_approval_pending: { label: "Unknown (approval pending)", tone: "amber", group: "unknown" }
};
// none | error | active | hold | delivered | cancelled | unknown
export const sfGroup = o => {
  const s = o?.steadfastStatus;
  if (s) return SF[s]?.group || "unknown";
  return o?.steadfastSyncError ? "error" : "none";
};

// Steadfast delivery charge for one order: real value from Steadfast payments, else our own delivery-fee estimate
export const chargeOf = o => {
  if (!o || !isSteadfast(o) || !sfIds(o).length) return null;
  if (o.steadfastCharge !== undefined && o.steadfastCharge !== null && o.steadfastCharge !== "") return { amount: num(o.steadfastCharge), actual: !!o.steadfastChargeActual };
  const fee = num(o.deliveryFee);
  return fee > 0 ? { amount: fee, actual: false } : null;
};

// What the order costs for courier: Steadfast's real charge if known, else the delivery cost you assumed on the order.
export const courierCost = o => { const c = chargeOf(o); return c?.actual ? c.amount : num(o?.deliveryFee); };
// Assumed (order) delivery cost vs Steadfast's real charge. diff > 0 means Steadfast charged MORE than you assumed.
export const chargeDiff = o => {
  const c = chargeOf(o);
  if (!c || !c.actual) return null;
  const assumed = num(o.deliveryFee);
  return { assumed, actual: c.amount, diff: c.amount - assumed };
};
export const isReturned = o => isSteadfast(o) && sfGroup(o) === "cancelled" || /^returned$/i.test(o?.orderStatus || "");
// Money lost on a returned parcel: production + other cost + courier charge (custom items can't be resold)
export const returnLoss = o => num(o?.productionCost) + num(o?.otherCost) + courierCost(o);

// Pure function: Steadfast status -> what to write on the order (status, COD settled, payment, return, timeline).
export function buildSyncPatch(o, r, now) {
  if (!r || !r.status) return { patch: { steadfastSyncError: r?.error || "ID not found on Steadfast", steadfastSyncedAt: now }, ok: false, changed: false };
  const meta = SF[r.status];
  const patch = { steadfastStatus: r.status, steadfastSyncedAt: now, steadfastSyncError: null };
  const oldTl = Array.isArray(o.timeline) ? o.timeline : [];
  const tl = [...oldTl];
  const changed = o.steadfastStatus !== r.status;
  if (!o.courierName) patch.courierName = "Steadfast";
  if (meta?.delivery) patch.deliveryStatus = meta.delivery;
  if (changed) tl.push({ status: `Steadfast: ${meta?.label || r.status}`, note: "Courier status synced", at: now });
  const cancelled = /cancel/i.test(o.orderStatus || "");
  if (meta?.group === "delivered") {
    if (!o.steadfastDeliveredAt) patch.steadfastDeliveredAt = now;
    if (meta.partial) {
      if (changed) tl.push({ status: "Partial delivery", note: "Steadfast delivered only part of the parcel - check the COD amount", at: now });
    } else if (!o.steadfastCodSettled && !cancelled) {
      // customer received the parcel -> COD collected -> everything settles automatically
      const dueNow = getDue(o);
      patch.steadfastCodSettled = true;
      if (o.steadfastCodAmount === undefined) patch.steadfastCodAmount = dueNow;
      if (dueNow > 0) {
        patch.paidAmount = num(o.paidAmount) + dueNow;
        patch.paymentHistory = [...(Array.isArray(o.paymentHistory) ? o.paymentHistory : []), { amount: dueNow, type: "COD collected by Steadfast", at: now }];
      }
      patch.dueAmount = 0;
      patch.paymentStatus = "Paid Full";
      if (!isDone(o.orderStatus) || /^returned$/i.test(o.orderStatus || "")) { patch.orderStatus = "Delivered"; tl.push({ status: "Delivered", note: "Delivered via Steadfast - COD collected, payment settled", at: now }); }
      else tl.push({ status: "Payment settled", note: "Steadfast delivered - COD collected, due cleared", at: now });
    }
  }
  if (meta?.group === "cancelled" && !/cancel|return/i.test(o.orderStatus || "")) {
    patch.orderStatus = "Returned";
    tl.push({ status: "Returned", note: "Parcel cancelled / returned by Steadfast", at: now });
  }
  if (tl.length !== oldTl.length) patch.timeline = tl;
  return { patch, ok: true, changed };
}
