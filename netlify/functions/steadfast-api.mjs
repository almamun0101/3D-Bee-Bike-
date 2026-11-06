import { json, sf, verifyUser, missingCreds } from "../shared/steadfast.mjs";

const isNum = s => /^\d+$/.test(s);

// Tracking ID -> Steadfast status. Tries consignment id, tracking code and invoice automatically.
async function resolveStatus(ids) {
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

export default async request => {
  // Open /.netlify/functions/steadfast-api in the browser to confirm the function is deployed.
  if (request.method === "GET") return json({ ok: true, message: "steadfast-api function is live", credentialsSet: !missingCreds() });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = await verifyUser(request);
  if (auth.error) return auth.error;
  if (missingCreds()) return json({ error: "Steadfast credentials are missing. Add STEADFAST_API_KEY and STEADFAST_SECRET_KEY in Netlify environment variables." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  try {
    switch (body.action) {
      case "balance": return json(await sf("get_balance"));
      case "payments": return json(await sf(`payments?page=${Number(body.page) || 1}`));
      case "payment": {
        const id = String(body.id ?? "").replace(/[^\w-]/g, "");
        if (!id) return json({ error: "Missing payment id" }, 400);
        return json(await sf(`payments/${id}`));
      }
      case "status": {
        const items = Array.isArray(body.items) ? body.items.slice(0, 12) : [];
        const results = {};
        await Promise.all(items.map(async it => {
          try { results[it.key] = await resolveStatus(it.ids); }
          catch (e) { results[it.key] = { error: e.message }; }
        }));
        return json({ results });
      }
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: e.message || "Steadfast request failed" }, 502);
  }
};
