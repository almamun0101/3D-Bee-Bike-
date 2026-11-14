// Delivery monitoring (pure functions, no React / Firebase - also used by the Netlify functions and the tests).
// All displayed times use Asia/Dhaka.
import { isSteadfast, sfIds, sfGroup, isDone } from "./shared.js";

export const TZ = "Asia/Dhaka";
export const HOUR = 3600000;
export const DEFAULT_MONITOR = { tiers: [24, 48, 72, 96], stuckHours: 24, trackingUrlTemplate: "" };

// Settings come from Firebase (settings/monitor); anything invalid falls back to the defaults.
export function normalizeMonitor(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  let tiers = Array.isArray(r.tiers) ? r.tiers.map(Number) : [];
  tiers = tiers.length === 4 && tiers.every(n => Number.isFinite(n) && n > 0) ? [...tiers].sort((a, b) => a - b) : DEFAULT_MONITOR.tiers;
  if (new Set(tiers).size !== 4) tiers = DEFAULT_MONITOR.tiers;
  const stuck = Number(r.stuckHours);
  const tpl = String(r.trackingUrlTemplate || "").trim();
  return {
    tiers, stuckHours: Number.isFinite(stuck) && stuck > 0 ? stuck : DEFAULT_MONITOR.stuckHours,
    // only a real http(s) link containing {code} (tracking code) or {id} (consignment id) is accepted - no built-in/guessed URL
    trackingUrlTemplate: /^https?:\/\/\S+$/i.test(tpl) && /\{(code|id)\}/.test(tpl) ? tpl : ""
  };
}

// 0 = on time, 1..4 = passed 1st..4th threshold
export const TIERS = [
  { key: "ok", label: "On time", tone: "green" },
  { key: "t1", label: "Watch", tone: "amber" },
  { key: "t2", label: "Late", tone: "orange" },
  { key: "t3", label: "Critical", tone: "red" },
  { key: "t4", label: "Severe", tone: "dark" }
];
export const tierOf = (hours, tiers) => (Number.isFinite(hours) ? tiers.filter(t => hours >= t).length : 0);

const ts = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; };

// When did the parcel start its journey? (booked on Steadfast, else moved to Shipped)
export function shipStart(o) {
  const direct = [o?.steadfastCreatedAt, o?.shippedAt].map(ts).find(Number.isFinite);
  if (Number.isFinite(direct)) return direct;
  const tl = Array.isArray(o?.timeline) ? o.timeline : [];
  const hit = tl.find(e => /^shipped$/i.test(e?.status || "") && Number.isFinite(ts(e.at)));
  return hit ? ts(hit.at) : NaN;
}

export const lastUpdateMs = o => [o?.steadfastLastEventAt, o?.steadfastStatusChangedAt, o?.steadfastCreatedAt, o?.shippedAt].map(ts).find(Number.isFinite) ?? NaN;
const lastCheckMs = o => ts(o?.steadfastSyncedAt);

export const isParcel = o => !!o && isSteadfast(o) && sfIds(o).length > 0;

// Everything the monitoring screens need for one parcel.
export function monitorInfo(o, cfg, now = Date.now()) {
  if (!isParcel(o)) return null;
  const g = sfGroup(o);
  const returned = g === "cancelled" || /^returned$/i.test(o.orderStatus || "");
  const delivered = !returned && (g === "delivered" || /^(delivered|completed)$/i.test(o.orderStatus || ""));
  const closed = returned || delivered;
  const start = shipStart(o);
  const endRaw = delivered ? ts(o.steadfastDeliveredAt) : returned ? ts(o.steadfastReturnedAt || o.steadfastStatusChangedAt) : NaN;
  const end = closed ? (Number.isFinite(endRaw) ? endRaw : NaN) : now;
  const hours = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / HOUR) : NaN;
  const tier = closed ? 0 : tierOf(hours, cfg.tiers);
  const last = lastUpdateMs(o);
  const sinceUpdateH = Number.isFinite(last) ? Math.max(0, (now - last) / HOUR) : NaN;
  // "failed" = never matched on Steadfast, unknown status, or the lookup failed 3 times in a row (a single hiccup is only retried)
  const failed = !closed && (g === "error" || g === "unknown" || (!!o.steadfastSyncError && Number(o.steadfastSyncFailures || 0) >= 3));
  const stuck = !closed && (g === "hold" || (Number.isFinite(sinceUpdateH) && sinceUpdateH >= cfg.stuckHours));
  const delayed = !closed && tier >= 1;
  return {
    group: g, delivered, returned, closed, active: !closed, start, end, hours, tier, tierMeta: TIERS[tier],
    last, sinceUpdateH, checkedAt: lastCheckMs(o), failed, stuck, delayed,
    // urgency used for sorting: higher = more urgent
    urgency: closed ? -1 : tier * 10 + (stuck ? 3 : 0) + (failed ? 2 : 0) + (followUpDue(o, now) ? 1 : 0)
  };
}

// Follow-up management (stored on the order: followUpAt, followUpNote, followUpDone)
export const followUpDue = (o, now = Date.now()) => !!o?.followUpAt && !o.followUpDone && ts(o.followUpAt) <= now;
export const hasFollowUp = o => !!o?.followUpAt && !o.followUpDone;

// Parcel tracking link: only a link Steadfast returned (trackingUrl) or one built from YOUR configured template.
export function trackingLinkOf(o, cfg) {
  // 1. a link typed on the order, 2. a tracking link Steadfast itself returned when the parcel was created
  const direct = String(o?.trackingUrl || o?.steadfastResponse?.consignment?.tracking_link || o?.steadfastResponse?.tracking_link || "").trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const tpl = cfg?.trackingUrlTemplate;
  if (!tpl) return "";
  const code = String(o?.steadfastTrackingCode || "").trim(), id = String(o?.courierId || "").trim();
  if (tpl.includes("{code}") && !code && !id) return "";
  return tpl.replace(/\{code\}/g, encodeURIComponent(code || id)).replace(/\{id\}/g, encodeURIComponent(id || code));
}

// "3d 4h", "5h 20m", "12m"
export function fmtDuration(hours) {
  if (!Number.isFinite(hours)) return "—";
  const m = Math.round(hours * 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
export const fmtAgo = (ms, now = Date.now()) => Number.isFinite(ms) ? `${fmtDuration((now - ms) / HOUR)} ago` : "—";
export const fmtDhaka = v => { const t = typeof v === "number" ? v : ts(v); return Number.isFinite(t) ? new Date(t).toLocaleString("en-GB", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : "—"; };
// value for <input type="datetime-local"> in Dhaka time, and back
export const toDhakaInput = v => { const t = typeof v === "number" ? v : ts(v); return Number.isFinite(t) ? new Date(t + 6 * HOUR).toISOString().slice(0, 16) : ""; };
export const fromDhakaInput = s => { const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s || "") ? Date.parse(`${s}:00+06:00`) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : ""; };

export function monitorSummary(orders, cfg, now = Date.now()) {
  const s = { parcels: 0, active: 0, delayed: 0, stuck: 0, failed: 0, delivered: 0, returned: 0, followUps: 0, tiers: [0, 0, 0, 0, 0], avgHours: NaN, onTimePct: NaN };
  let sum = 0, n = 0, ok = 0;
  for (const o of orders) {
    const m = monitorInfo(o, cfg, now); if (!m) continue;
    s.parcels++;
    if (m.active) { s.active++; s.tiers[m.tier]++; }
    if (m.delayed) s.delayed++;
    if (m.stuck) s.stuck++;
    if (m.failed) s.failed++;
    if (m.delivered) { s.delivered++; if (Number.isFinite(m.hours)) { sum += m.hours; n++; if (m.hours < cfg.tiers[1]) ok++; } }
    if (m.returned) s.returned++;
    if (followUpDue(o, now)) s.followUps++;
  }
  s.avgHours = n ? sum / n : NaN;
  s.onTimePct = n ? Math.round((ok / n) * 100) : NaN;
  return s;
}
