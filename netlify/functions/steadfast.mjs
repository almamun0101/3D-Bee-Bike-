import { json, sf, sfPost, verifyUser, missingCreds } from "../shared/steadfast.mjs";

// Create a Steadfast parcel. Safe against double-booking:
//  1. the same invoice is never sent twice at the same time (in-flight lock),
//  2. Steadfast is asked first whether this invoice already exists (status_by_invoice) -> 409 instead of a second parcel,
//  3. a timeout is reported as "unsure" and never retried automatically.
const inflight = new Set();
const REQUIRED = ["invoice", "recipient_name", "recipient_phone", "recipient_address", "cod_amount"];

export default async request => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = await verifyUser(request);
  if (auth.error) return auth.error;
  if (missingCreds()) return json({ error: "Steadfast credentials are missing. Add STEADFAST_API_KEY and STEADFAST_SECRET_KEY in Netlify environment variables." }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  for (const k of REQUIRED) if (body[k] === undefined || body[k] === null || body[k] === "") return json({ error: `Missing required field: ${k}` }, 400);
  const invoice = String(body.invoice).trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(invoice)) return json({ error: "Invoice may contain only letters, numbers, dash and underscore" }, 400);
  const cod = Number(body.cod_amount);
  if (!Number.isFinite(cod) || cod < 0) return json({ error: "cod_amount must be a valid non-negative number" }, 400);
  const phone = String(body.recipient_phone).replace(/[\s-]/g, "").replace(/^\+?88/, "");
  if (!/^01\d{9}$/.test(phone)) return json({ error: "Recipient phone must be an 11 digit Bangladesh mobile number (01XXXXXXXXX)" }, 400);

  if (inflight.has(invoice)) return json({ error: "A parcel for this order is already being created. Wait a few seconds.", duplicate: true }, 409);
  inflight.add(invoice);
  try {
    // (2) already on Steadfast?
    try {
      const existing = await sf(`status_by_invoice/${encodeURIComponent(invoice)}`);
      if (existing?.delivery_status) return json({ error: `Steadfast already has a parcel for ${invoice} (status: ${existing.delivery_status}). No second parcel was created.`, duplicate: true, delivery_status: existing.delivery_status }, 409);
    } catch { /* cannot check (network) - creating below is still protected by timeout handling */ }
    const { status, data } = await sfPost("create_order", { ...body, invoice, recipient_phone: phone, cod_amount: cod });
    return json(data, status);
  } catch (e) {
    return json({ error: e.message || "Unable to contact Steadfast", ...(e.unsure ? { unsure: true } : {}) }, 502);
  } finally { inflight.delete(invoice); }
};
