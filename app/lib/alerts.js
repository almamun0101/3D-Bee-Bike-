// Smart notifications: derived live from the orders (so they are always correct), de-duplicated by key.
import { monitorInfo, followUpDue, TIERS, fmtDuration } from "./monitor.js";

export function buildAlerts(orders, cfg, serials = {}, now = Date.now()) {
  const out = [];
  for (const o of orders) {
    const m = monitorInfo(o, cfg, now); if (!m) continue;
    const who = `#${serials[o.id] ?? o.serial ?? "?"} ${o.customerName || ""}`.trim();
    const add = (kind, key, level, title, body) => out.push({ kind, key, level, title, body, orderId: o.id, at: now });
    if (m.active && m.tier >= 1) add("delay", `delay:${o.id}:${m.tier}`, m.tier >= 3 ? "red" : m.tier === 2 ? "orange" : "amber", `${who}: over ${cfg.tiers[m.tier - 1]}h in transit`, `${TIERS[m.tier].label} · ${fmtDuration(m.hours)} since shipped`);
    if (m.active && m.stuck) add("stuck", `stuck:${o.id}:${m.group === "hold" ? "hold" : Math.floor(m.sinceUpdateH / cfg.stuckHours)}`, "orange", `${who}: parcel looks stuck`, m.group === "hold" ? "Steadfast put this parcel on hold" : `No courier update for ${fmtDuration(m.sinceUpdateH)}`);
    if (m.failed) add("failed", `failed:${o.id}:${o.steadfastSyncError || m.group}`, "red", `${who}: courier sync problem`, o.steadfastSyncError || "Steadfast status is unknown");
    if (followUpDue(o, now)) add("followup", `fu:${o.id}:${o.followUpAt}`, "blue", `${who}: follow-up due`, o.followUpNote || "Follow-up reminder");
  }
  const rank = { red: 0, orange: 1, blue: 2, amber: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
