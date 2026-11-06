"use client";
import { useMemo, useState } from "react";
import { money, orderTime, dhakaDay, DAY, num, courierOf, isSteadfast, sfGroup, chargeOf, chargeDiff, courierCost, isReturned, returnLoss } from "../lib/shared";
import { BarChart, HBars, Donut } from "./charts";

const RANGES = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"], ["all", "All time"]];
const TONE = { green: "var(--green)", blue: "var(--blue)", amber: "var(--gold-dark)", red: "var(--red)", violet: "var(--violet)" };
const profitOf = o => num(o.total) - num(o.productionCost) - courierCost(o) - num(o.otherCost);
const pctf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const startOfDay = t => Date.parse(dhakaDay(t) + "T00:00:00+06:00");

export default function Analytics({ orders, expenses, initialRange = "30" }) {
  const [range, setRange] = useState(initialRange);

  const A = useMemo(() => {
    const now = Date.now();
    const all = range === "all";
    const cutoff = all ? 0 : startOfDay(now) - (Number(range) - 1) * DAY;
    const inRange = orders.filter(o => { const t = orderTime(o); return isNaN(t) ? all : t >= cutoff; });
    const live = inRange.filter(o => !/cancel/i.test(o.orderStatus || "") && !isReturned(o));
    const returned = inRange.filter(o => isReturned(o) && !/cancel/i.test(o.orderStatus || ""));
    const retLoss = returned.reduce((s, o) => s + returnLoss(o), 0);
    const exp = expenses.filter(e => { const t = Date.parse(e.createdAt); return isNaN(t) ? all : t >= cutoff; });

    const revenue = live.reduce((s, o) => s + num(o.total), 0);
    const orderProfit = live.reduce((s, o) => s + profitOf(o), 0);
    const overhead = exp.reduce((s, e) => s + num(e.amount), 0);
    const net = orderProfit - overhead - retLoss;
    const collected = live.reduce((s, o) => s + Math.min(num(o.paidAmount), num(o.total)), 0);
    const due = live.reduce((s, o) => s + Math.max(0, num(o.total) - num(o.paidAmount) - num(o.deliveryChargePaidAmount)), 0);
    const items = live.reduce((s, o) => s + num(o.quantity), 0);

    // buckets
    const mode = all ? "month" : Number(range) <= 31 ? "day" : Number(range) <= 120 ? "week" : "month";
    const keyOf = t => {
      const d = dhakaDay(t);
      if (mode === "day") return d;
      if (mode === "month") return d.slice(0, 7);
      const dt = new Date(d + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return dt.toISOString().slice(0, 10);
    };
    const times = live.map(orderTime).filter(t => !isNaN(t));
    const from = all ? (times.length ? Math.min(...times) : now) : cutoff;
    const buckets = new Map();
    for (let t = from; t <= now + DAY / 2; t += DAY) { const k = keyOf(t); if (!buckets.has(k)) buckets.set(k, { k, revenue: 0, profit: 0, orders: 0 }); }
    live.forEach(o => { const t = orderTime(o); if (isNaN(t)) return; const b = buckets.get(keyOf(t)); if (b) { b.revenue += num(o.total); b.profit += profitOf(o); b.orders++; } });
    exp.forEach(e => { const t = Date.parse(e.createdAt); if (isNaN(t)) return; const b = buckets.get(keyOf(t)); if (b) b.profit -= num(e.amount); });
    returned.forEach(o => { const t = orderTime(o); if (isNaN(t)) return; const b = buckets.get(keyOf(t)); if (b) b.profit -= returnLoss(o); });
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const series = [...buckets.values()].sort((a, b) => a.k.localeCompare(b.k)).map(b => ({ ...b, label: mode === "month" ? `${mon[Number(b.k.slice(5, 7)) - 1]} ${b.k.slice(2, 4)}` : b.k.slice(5) }));

    // status
    const st = {}; inRange.forEach(o => { const k = o.orderStatus || "—"; st[k] = (st[k] || 0) + 1; });
    const statusRows = Object.entries(st).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));

    // courier
    const sf = inRange.filter(isSteadfast);
    const cg = { delivered: 0, active: 0, hold: 0, cancelled: 0, none: 0, error: 0, unknown: 0 };
    sf.forEach(o => { cg[sfGroup(o)]++; });
    const finished = cg.delivered + cg.cancelled;
    const byCourier = {}; inRange.filter(o => courierOf(o)).forEach(o => { const k = courierOf(o); byCourier[k] = (byCourier[k] || 0) + 1; });

    // delivery time (days) from timeline "Delivered" event
    const dtimes = [];
    inRange.forEach(o => {
      const ev = Array.isArray(o.timeline) ? o.timeline.find(e => /^delivered$/i.test(e.status || "")) : null;
      const a = Date.parse(o.createdAt), b = Date.parse(ev?.at || o.steadfastDeliveredAt);
      if (!isNaN(a) && !isNaN(b) && b >= a) dtimes.push((b - a) / DAY);
    });
    const avgDays = dtimes.length ? dtimes.reduce((s, x) => s + x, 0) / dtimes.length : null;

    // area, weekday, customers, expenses by category
    const area = {}; live.forEach(o => { const k = o.deliveryArea || "Unknown"; area[k] = area[k] || { n: 0, rev: 0 }; area[k].n++; area[k].rev += num(o.total); });
    const wd = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    live.forEach(o => { const t = orderTime(o); if (!isNaN(t)) wd[new Date(t).toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Dhaka" })]++; });
    const cust = {};
    live.forEach(o => {
      const phone = String(o.courierRecipientPhone || (String(o.customerDetails || "").match(/01[3-9]\d{8}/) || [""])[0]).trim();
      const k = (phone || String(o.customerName || "").trim().toLowerCase() || o.id);
      const c = cust[k] = cust[k] || { name: o.customerName || phone || "—", n: 0, rev: 0 };
      c.n++; c.rev += num(o.total);
    });
    const custList = Object.values(cust);
    const repeat = custList.filter(c => c.n > 1).length;
    const expCat = {}; exp.forEach(e => { const k = e.category || "Other"; expCat[k] = (expCat[k] || 0) + num(e.amount); });

    const bestDay = Object.entries(wd).sort((a, b) => b[1] - a[1])[0];
    const insights = [];
    if (finished >= 3) insights.push(cg.delivered / finished < 0.85 ? `⚠️ Delivery success ${pctf(cg.delivered, finished)}%, ${cg.cancelled} parcel cancel/return hoyeche. Address ar phone verify kore pathale komte pare.` : `✅ Delivery success ${pctf(cg.delivered, finished)}% — courier performance bhalo.`);
    if (bestDay && bestDay[1] > 0) insights.push(`📅 Shobcheye beshi order ashe ${bestDay[0]} din (${bestDay[1]} ta).`);
    if (custList.length) insights.push(`🔁 ${repeat} jon customer ekadhik bar order korechen (${pctf(repeat, custList.length)}% repeat rate).`);
    if (revenue && due / revenue > 0.3) insights.push(`💸 Total sales er ${pctf(due, revenue)}% ekhono due (${money(due)}). Follow up korun.`);
    if (revenue && net / revenue < 0.15) insights.push(`📉 Net margin ${pctf(net, revenue)}% — cost ba delivery fee ektu dekhe nin.`);
    if (area["Outside Dhaka"] && area["Inside Dhaka"] && area["Outside Dhaka"].n > area["Inside Dhaka"].n) insights.push("🚚 Dhaka'r bahire order beshi, delivery charge ar return risk er dike nojor din.");

    let chargeTotal = 0, chargeActual = 0, chargeEst = 0, assumedSum = 0, actualSum = 0, over = 0;
    sf.forEach(o => {
      const c = chargeOf(o); if (!c) return;
      chargeTotal += c.amount; if (c.actual) chargeActual++; else chargeEst++;
      const d = chargeDiff(o); if (d) { assumedSum += d.assumed; actualSum += d.actual; if (d.diff > 0) over += d.diff; }
    });
    if (retLoss > 0) insights.push(`↩️ ${returned.length} ta parcel return hoyeche, total loss ${money(retLoss)} (production + courier charge).`);
    if (over > 0) insights.push(`🔴 Steadfast tomar dhora courier cost er cheye ${money(over)} beshi kete niyeche. Delivery fee/area rate ekbar check korun.`);
    return { inRange, live, revenue, orderProfit, overhead, net, collected, due, items, series, mode, statusRows, sf, cg, finished, byCourier, avgDays, area, wd, custList, repeat, expCat, insights, chargeTotal, chargeActual, chargeEst, assumedSum, actualSum, over, returned, retLoss };
  }, [orders, expenses, range]);

  const card = (label, value, sub, cls = "") => <div className={`stat ${cls}`}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
  const top = [...A.custList].sort((a, b) => b.rev - a.rev).slice(0, 8);
  const statusTone = l => /deliver|complet/i.test(l) ? TONE.green : /cancel/i.test(l) ? TONE.red : /ship|ready/i.test(l) ? TONE.violet : /process|print/i.test(l) ? TONE.blue : TONE.amber;

  return <div className="stack">
    <div className="rangebar">{RANGES.map(([k, l]) => <button key={k} className={`chip ${range === k ? "active" : ""}`} onClick={() => setRange(k)}>{l}</button>)}</div>

    <section className="stats">
      {card("Sales", money(A.revenue), `${A.live.length} orders · ${A.items} items`)}
      {card("Net profit", money(A.net), `Margin ${pctf(A.net, A.revenue)}% · after expenses`, A.net < 0 ? "warn" : "")}
      {card("Avg order value", money(A.live.length ? Math.round(A.revenue / A.live.length) : 0), `${A.inRange.length - A.live.length} cancelled / returned`)}
      {card("Money received", money(A.collected), `${pctf(A.collected, A.revenue)}% of sales`)}
      {card("Payment due", money(A.due), `${pctf(A.due, A.revenue)}% of sales`, "warn")}
      {card("Return loss", money(A.retLoss), `${A.returned.length} returned parcels`, A.retLoss > 0 ? "warn" : "")}
      {card("Courier cost overrun", money(A.over), A.over > 0 ? "Steadfast charge > dhora cost" : "Within your assumed cost", A.over > 0 ? "warn" : "")}
      {card("Delivery success", A.finished ? `${pctf(A.cg.delivered, A.finished)}%` : "—", A.avgDays === null ? "Steadfast parcels" : `Avg ${A.avgDays.toFixed(1)} days to deliver`)}
    </section>

    {A.insights.length > 0 && <section className="panel insights"><h2>Smart insights</h2>{A.insights.map((t, i) => <p key={i}>{t}</p>)}</section>}

    <section className="panel"><h2>Sales & profit</h2><p className="sub">Per {A.mode} · profit = sales − production − delivery − other costs − expenses</p>
      <BarChart data={A.series} series={[{ key: "revenue", label: "Sales", color: "var(--gold)" }, { key: "profit", label: "Net profit", color: "var(--green)" }]} />
    </section>

    <div className="two">
      <section className="panel"><h2>Orders by status</h2><p className="sub">&nbsp;</p>
        <Donut parts={A.statusRows.map(r => ({ ...r, color: statusTone(r.label) }))} />
      </section>
      <section className="panel"><h2>Courier performance</h2><p className="sub">Steadfast parcels in this period</p>
        <Donut center={A.sf.length} parts={[
          { label: "Delivered", value: A.cg.delivered, color: TONE.green }, { label: "On the way", value: A.cg.active, color: TONE.blue },
          { label: "On hold", value: A.cg.hold, color: TONE.violet }, { label: "Cancelled / returned", value: A.cg.cancelled, color: TONE.red },
          { label: "Not synced", value: A.cg.none + A.cg.error + A.cg.unknown, color: "var(--muted)" }]} />
      </section>
    </div>

    <div className="two">
      <section className="panel"><h2>Parcels by courier</h2><p className="sub">Koto ta kon courier e gelo</p>
        <HBars rows={Object.entries(A.byCourier).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} fmt={v => `${v} parcels`} />
        <div className="costbox">
          <div><span>Delivery fee billed to customers</span><b>{money(A.live.reduce((s, o) => s + num(o.deliveryFee), 0))}</b></div>
          <div><span>Courier cost you assumed</span><b>{money(A.assumedSum)}</b></div>
          <div><span>Steadfast actual charge</span><b className={A.actualSum > A.assumedSum ? "redt" : "greent"}>{money(A.actualSum)}</b></div>
          <small>{A.chargeActual} parcel e Steadfast er real charge · {A.chargeEst} parcel e estimate (total {money(A.chargeTotal)})</small>
        </div>
      </section>
      <section className="panel"><h2>Orders by weekday</h2><p className="sub">Kon din e beshi order ashe</p>
        <HBars rows={Object.entries(A.wd).map(([label, value]) => ({ label, value }))} fmt={v => `${v}`} color="var(--blue)" />
      </section>
    </div>

    <div className="two">
      <section className="panel"><h2>Inside vs outside Dhaka</h2><p className="sub">Orders and sales by delivery area</p>
        <HBars rows={Object.entries(A.area).map(([label, v]) => ({ label, value: v.rev, sub: `· ${v.n} orders` }))} fmt={money} color="var(--violet)" />
      </section>
      <section className="panel"><h2>Expenses by category</h2><p className="sub">Total {money(A.overhead)}</p>
        <HBars rows={Object.entries(A.expCat).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} fmt={money} color="var(--red)" />
      </section>
    </div>

    <section className="panel"><h2>Top customers</h2><p className="sub">{A.custList.length} customers · {A.repeat} repeat ({pctf(A.repeat, A.custList.length)}%)</p>
      {!top.length ? <div className="empty small">No data</div> : <div className="tablewrap"><table style={{ minWidth: 420 }}>
        <thead><tr><th>#</th><th>Customer</th><th>Orders</th><th>Sales</th></tr></thead>
        <tbody>{top.map((c, i) => <tr key={i} style={{ cursor: "default" }}><td>{i + 1}</td><td><strong>{c.name}</strong></td><td>{c.n}</td><td><strong>{money(c.rev)}</strong></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
