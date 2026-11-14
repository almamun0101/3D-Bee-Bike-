import { json, sf, verifyUser, missingCreds, resolveStatus } from "../shared/steadfast.mjs";

import { adminConfigured, dbGet } from "../shared/firebaseAdmin.mjs";
import { runSync } from "../shared/syncCore.mjs";

export default async request => {
  // Open /.netlify/functions/steadfast-api in the browser to confirm the function is deployed.
  if (request.method === "GET") return json({ ok: true, message: "steadfast-api function is live", credentialsSet: !missingCreds(), serverSyncReady: adminConfigured(), webhookReady: !!process.env.STEADFAST_WEBHOOK_TOKEN });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = await verifyUser(request);
  if (auth.error) return auth.error;
  if (missingCreds()) return json({ error: "Steadfast credentials are missing. Add STEADFAST_API_KEY and STEADFAST_SECRET_KEY in Netlify environment variables." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  try {
    switch (body.action) {
      case "health": {
        let meta = null; if (adminConfigured()) { try { meta = await dbGet("meta/serverSync"); } catch (e) { meta = { error: e.message }; } }
        return json({ credentialsSet: true, serverSyncReady: adminConfigured(), webhookReady: !!process.env.STEADFAST_WEBHOOK_TOKEN, meta });
      }
      case "serverSync": {
        if (!adminConfigured()) return json({ error: "Server sync needs FIREBASE_SERVICE_ACCOUNT in Netlify environment variables." }, 503);
        return json(await runSync({ source: "manual", force: true }));
      }
      case "tracking": { // best effort: Steadfast tracking history for one invoice (may not be enabled for every account)
        const inv = String(body.invoice ?? "").replace(/[^\w-]/g, "");
        if (!inv) return json({ error: "Missing invoice" }, 400);
        return json(await sf(`trackings_by_invoice/${inv}`));
      }
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
