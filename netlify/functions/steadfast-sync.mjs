import { runSync } from "../shared/syncCore.mjs";

// Runs on Netlify's scheduler even when the dashboard is closed. Safety net for webhooks.
export default async () => {
  try { const r = await runSync({ source: "schedule" }); console.log("[steadfast-sync]", JSON.stringify(r)); }
  catch (e) { console.error("[steadfast-sync] failed:", e.message); }
  return new Response(null, { status: 200 });
};
export const config = { schedule: "*/10 * * * *" };
