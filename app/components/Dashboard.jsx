"use client";
import { useMemo } from "react";
import { money, orderTime, dhakaDay, DAY, STATUSES, isSteadfast, isDone, getDue } from "../lib/shared";
import { monitorSummary, monitorInfo, fmtDuration, fmtAgo, TIERS, TZ } from "../lib/monitor";
import { BarChart, HBars, Donut } from "./charts";
import { CollectTag } from "./SfPill";

const STATUS_COLOR = { Pending: "#9a988f", Processing: "#1d5fd1", Printing: "#6d3fc4", "Ready to ship": "#d9a51c", Shipped: "#e07b00", Delivered: "#157347", Completed: "#0f9d6a", Returned: "#b42318", Cancelled: "#7a1b14" };
const TIER_COLOR = ["#157347", "#d9a51c", "#e07b00", "#b42318", "#5a0f0a"];
const hourIn = (ms) => Number(new Date(ms).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ })) % 24;

export default function Dashboard({ orders, serials, cfg, now, stats, onGo, onOpen, children }) {
  const d = useMemo(() => {
    const today = dhakaDay(now), month = today.slice(0, 7);
    const live = orders.filter(o => !/cancel|return/i.test(o.orderStatus || ""));
    const day = o => { const t = orderTime(o); return Number.isFinite(t) ? dhakaDay(t) : ""; };
    const inMonth = live.filter(o => day(o).startsWith(month));
    const series = Array.from({ length: 14 }, (_, i) => {
      const k = dhakaDay(now - (13 - i) * DAY), rows = live.filter(o => day(o) === k);
      return { key: k, label: new Date(`${k}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), revenue: rows.reduce((s, o) => s + Number(o.total || 0), 0), orders: rows.length };
    });
    const statusParts = STATUSES.map(s => ({ label: s, value: orders.filter(o => (o.orderStatus || "Pending") === s).length, color: STATUS_COLOR[s] })).filter(p => p.value > 0);
    const sum = monitorSummary(orders, cfg, now);
    const sf = orders.filter(isSteadfast).filter(o => o.courierId || o.steadfastTrackingCode);
    const doneN = sum.delivered + sum.returned;
    const attention = orders.map(o => ({ o, m: monitorInfo(o, cfg, now) })).filter(r => r.m && r.m.active && (r.m.delayed || r.m.stuck || r.m.failed)).sort((a, b) => b.m.urgency - a.m.urgency).slice(0, 6);
    const activity = orders.flatMap(o => (Array.isArray(o.timeline) ? o.timeline : []).map(e => ({ ...e, o, t: Date.parse(e.at) }))).filter(e => Number.isFinite(e.t)).sort((a, b) => b.t - a.t).slice(0, 10);
    const needsTracking = orders.filter(o => !o.courierId && !isDone(o.orderStatus) && /ready|ship/i.test(o.orderStatus || "")).length;
    return {
      todayN: live.filter(o => day(o) === today).length, monthN: inMonth.length, monthRev: inMonth.reduce((s, o) => s + Number(o.total || 0), 0),
      series, statusParts, sum, parcels: sf.length, successPct: doneN ? Math.round((sum.delivered / doneN) * 100) : null, attention, activity, needsTracking,
      dueTotal: orders.filter(o => !isDone(o.orderStatus)).reduce((s, o) => s + getDue(o), 0)
    };
  }, [orders, cfg, now]);

  const greet = hourIn(now) < 12 ? "Good morning" : hourIn(now) < 18 ? "Good afternoon" : "Good evening";
  const alertCount = d.sum.delayed + d.sum.stuck + d.sum.failed + d.sum.followUps;

  return <div className="dash">
    <section className="hero">
      <div><p className="eyebrow">{new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}</p><h2>{greet} 👋</h2>
        <p>{alertCount ? <><b>{alertCount}</b> parcel{alertCount > 1 ? "s" : ""} need attention.</> : "All parcels are moving on time."}{d.needsTracking ? <> · <b>{d.needsTracking}</b> shipped order{d.needsTracking > 1 ? "s" : ""} missing a tracking ID.</> : null}</p></div>
      <div className="row wrap"><button className="btn primary" onClick={() => onGo("monitor", { tab: alertCount ? "delayed" : "active" })}>🛰 Open delivery monitor</button><button className="btn" onClick={() => onGo("orders")}>📋 All orders</button></div>
    </section>

    <section className="kpis">
      <button className="kpi" onClick={() => onGo("orders")}><span>Orders today</span><strong>{d.todayN}</strong><small>{d.monthN} this month</small></button>
      <button className="kpi" onClick={() => onGo("analytics")}><span>Revenue this month</span><strong>{money(d.monthRev)}</strong><small>Excl. cancelled / returned</small></button>
      <button className="kpi warn" onClick={() => onGo("orders", { smart: "unpaid" })}><span>Outstanding dues</span><strong>{money(d.dueTotal)}</strong><small>Open orders</small></button>
      <button className="kpi gold" onClick={() => onGo("orders", { smart: "collect" })}><span>💰 COD to collect</span><strong>{money(stats.toCollect)}</strong><small>{stats.toCollectN} parcels with courier</small></button>
      <button className="kpi" onClick={() => onGo("monitor", { tab: "active" })}><span>Active parcels</span><strong>{d.sum.active}</strong><small>{d.parcels} total on Steadfast</small></button>
      <button className={`kpi ${d.sum.delayed ? "danger" : ""}`} onClick={() => onGo("monitor", { tab: "delayed", tier: 1 })}><span>⏱ Delayed parcels</span><strong>{d.sum.delayed}</strong><small>over {cfg.tiers[0]}h · {d.sum.tiers[4]} over {cfg.tiers[3]}h</small></button>
      <button className="kpi" onClick={() => onGo("courier")}><span>Delivery success</span><strong>{d.successPct === null ? "—" : `${d.successPct}%`}</strong><small>{d.sum.delivered} delivered · {d.sum.returned} returned</small></button>
      <button className="kpi" onClick={() => onGo("monitor", { tab: "delivered" })}><span>Avg delivery time</span><strong>{fmtDuration(d.sum.avgHours)}</strong><small>{Number.isFinite(d.sum.onTimePct) ? `${d.sum.onTimePct}% within ${cfg.tiers[1]}h` : "No data yet"}</small></button>
    </section>

    <section className="grid2">
      <div className="panel"><div className="phead"><h3>Revenue · last 14 days</h3><small>Asia/Dhaka</small></div>
        <BarChart data={d.series} series={[{ key: "revenue", label: "Revenue", color: "var(--gold)" }]} height={210} /></div>
      <div className="panel"><div className="phead"><h3>Orders by status</h3></div><Donut parts={d.statusParts} /></div>
    </section>

    <section className="grid2">
      <div className="panel"><div className="phead"><h3>🚨 Needs attention</h3><button className="btn sm ghost" onClick={() => onGo("monitor", { tab: "delayed" })}>View all</button></div>
        {!d.attention.length ? <div className="empty small">Nothing delayed, stuck or failing 🎉</div> : <div className="attn">{d.attention.map(({ o, m }) =>
          <button key={o.id} className={`attnrow t${m.tier}`} onClick={() => onOpen(o.id)}>
            <span className={`tierbadge ${m.tierMeta.tone}`}>{fmtDuration(m.hours)}</span>
            <span className="grow"><b>#{serials[o.id]} {o.customerName || "—"}</b><small>{m.group === "hold" ? "On hold at Steadfast" : m.failed ? "Courier sync problem" : m.stuck ? `No update for ${fmtDuration(m.sinceUpdateH)}` : `${TIERS[m.tier].label} · last update ${fmtAgo(m.last, now)}`}</small></span>
            <CollectTag o={o} /></button>)}</div>}
      </div>
      <div className="panel"><div className="phead"><h3>Active parcels by time in transit</h3></div>
        <HBars rows={[{ label: `Under ${cfg.tiers[0]}h`, value: d.sum.tiers[0], color: TIER_COLOR[0] }, ...cfg.tiers.map((h, i) => ({ label: i < 3 ? `${h}–${cfg.tiers[i + 1]}h` : `Over ${h}h`, value: d.sum.tiers[i + 1], color: TIER_COLOR[i + 1] }))]} />
        <div className="perf"><div><span>Parcels</span><b>{d.parcels}</b></div><div><span>Delivered</span><b>{d.sum.delivered}</b></div><div><span>Returned</span><b>{d.sum.returned}</b></div><div><span>Success</span><b>{d.successPct === null ? "—" : `${d.successPct}%`}</b></div><div><span>Avg time</span><b>{fmtDuration(d.sum.avgHours)}</b></div></div>
      </div>
    </section>

    <section className="panel"><div className="phead"><h3>Recent activity</h3><small>Latest changes across all orders</small></div>
      {!d.activity.length ? <div className="empty small">No activity yet</div> : <ol className="feed">{d.activity.map((e, i) =>
        <li key={i} onClick={() => onOpen(e.o.id)}><i /><div><b>#{serials[e.o.id]} {e.o.customerName || "—"} · {e.status}</b><small>{e.note || ""}</small></div><time>{fmtAgo(e.t, now)}</time></li>)}</ol>}
    </section>

    <h3 className="sectitle">Finance</h3>
    {children}
  </div>;
}
