import { timingSafeEqual, createHash } from "node:crypto";
import { adminConfigured } from "../shared/firebaseAdmin.mjs";
import { updateOrder, findOrderId } from "../shared/syncCore.mjs";
import { buildSyncPatch } from "../../app/lib/shared.js";
import { json } from "../shared/steadfast.mjs";

// Steadfast -> this function (configure the URL + Bearer token in the Steadfast merchant panel):
//   https://YOUR-SITE.netlify.app/.netlify/functions/steadfast-webhook
// Notification types seen in Steadfast webhook integrations: delivery_status, tracking_update, consignment_update.
const sha = s => createHash("sha256").update(String(s)).digest();
const authorised = req => {
  const token = process.env.STEADFAST_WEBHOOK_TOKEN;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return !!token && !!got && timingSafeEqual(sha(got), sha(token));
};
const money = v => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };

export default async req => {
  if (req.method === "GET") return json({ ok: true, message: "steadfast-webhook is live", tokenSet: !!process.env.STEADFAST_WEBHOOK_TOKEN, serverSyncReady: adminConfigured() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!process.env.STEADFAST_WEBHOOK_TOKEN) return json({ status: "error", message: "Webhook token is not configured" }, 503);
  if (!authorised(req)) return json({ status: "error", message: "Invalid token" }, 401);
  if (!adminConfigured()) return json({ status: "error", message: "FIREBASE_SERVICE_ACCOUNT is not configured" }, 503);
  let b; try { b = await req.json(); } catch { return json({ status: "error", message: "Invalid JSON" }, 400); }
  const type = String(b.notification_type || (b.status ? "delivery_status" : "tracking_update"));
  const key = [type, b.consignment_id, b.status, b.updated_at, b.tracking_message].join("|");
  try {
    const id = await findOrderId({ invoice: b.invoice, consignmentId: b.consignment_id, trackingCode: b.tracking_code });
    // unknown parcel: answer 200 so Steadfast does not keep retrying parcels that are not ours
    if (!id) return json({ status: "success", message: "No matching order (ignored)" });
    const now = new Date().toISOString();
    const res = await updateOrder(id, o => {
      if (o.steadfastWebhookKey === key) return { reason: "duplicate" };
      let patch;
      if (type === "delivery_status" && b.status) {
        const out = buildSyncPatch(o, { status: String(b.status), message: b.tracking_message, providerUpdatedAt: b.updated_at, source: "webhook" }, now);
        patch = out.patch;
        const charge = money(b.delivery_charge);
        if (charge !== null && charge >= 0) { patch.steadfastCharge = charge; patch.steadfastChargeActual = true; }
        const cod = money(b.cod_amount);
        if (cod !== null && patch.steadfastCodAmount === undefined && o.steadfastCodAmount === undefined) patch.steadfastCodAmount = cod;
      } else {
        // tracking / consignment updates carry no new status: only record the message
        const msg = String(b.tracking_message || b.message || "").slice(0, 300);
        const ev = Array.isArray(o.steadfastEvents) ? o.steadfastEvents : [];
        patch = { steadfastLastEventAt: now, ...(msg ? { steadfastTrackingMessage: msg } : {}), ...(b.updated_at ? { steadfastProviderUpdatedAt: String(b.updated_at) } : {}),
          steadfastEvents: [...ev, { at: now, status: o.steadfastStatus || "", message: msg || type, source: "webhook" }].slice(-30) };
      }
      patch.steadfastWebhookKey = key;
      return { patch };
    });
    return json({ status: "success", message: res?.skipped === "duplicate" ? "Duplicate ignored" : "Order updated", orderId: id });
  } catch (e) {
    // 500 -> Steadfast can retry later; the scheduled sync is the safety net
    return json({ status: "error", message: e.message }, 500);
  }
};
