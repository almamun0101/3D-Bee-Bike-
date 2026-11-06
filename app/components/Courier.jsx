"use client";
import { useMemo, useState } from "react";
import { money, fmtDate, courierOf, isSteadfast, sfIds, SF, sfGroup, getDue, isDone, orderTime, DAY, chargeOf, chargeDiff, returnLoss, courierCost } from "../lib/shared";
import SfPill from "./SfPill";
import { HBars } from "./charts";

const FILTERS = [["all", "All"], ["active", "On the way"], ["hold", "On hold"], ["delivered", "Delivered"], ["cancelled", "Cancelled / Returned"], ["none", "Not synced"], ["error", "ID problem"]];
const ageDays = o => { const t = Date.parse(o.steadfastCreatedAt) || orderTime(o); return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / DAY)); };
const codOf = o => (o.steadfastCodAmount !== undefined ? Number(o.steadfastCodAmount || 0) : getDue(o));

export default function Courier({ orders, sync, onSync, autoSync, setAutoSync, onOpen }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const sent = useMemo(() => orders.filter(o => courierOf(o)), [orders]);
  const sfOrders = useMemo(() => sent.filter(isSteadfast), [sent]);

  const byCourier = useMemo(() => {
    const m = {};
    sent.forEach(o => { const k = courierOf(o); m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  }, [sent]);

  const g = useMemo(() => {
    const c = { active: 0, hold: 0, delivered: 0, cancelled: 0, none: 0, error: 0, unknown: 0 };
    sfOrders.forEach(o => { c[sfGroup(o)]++; });
    const done = c.delivered + c.cancelled;
    return {
      ...c,
      rate: done ? Math.round((c.delivered / done) * 100) : null,
      codWay: sfOrders.filter(o => ["active", "hold"].includes(sfGroup(o))).reduce((s, o) => s + codOf(o), 0),
      codDone: sfOrders.filter(o => sfGroup(o) === "delivered").reduce((s, o) => s + codOf(o), 0),
      noId: sfOrders.filter(o => !sfIds(o).length).length,
      unsent: orders.filter(o => !courierOf(o) && !isDone(o.orderStatus) && /ready|ship/i.test(o.orderStatus || "")).length
    };
  }, [sfOrders, orders]);

  const stuck = useMemo(() => sfOrders.filter(o => ["active", "hold"].includes(sfGroup(o)) && (ageDays(o) ?? 0) >= 5).sort((a, b) => ageDays(b) - ageDays(a)), [sfOrders]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rank = { active: 0, hold: 1, error: 2, none: 3, unknown: 4, delivered: 5, cancelled: 6 };
    return sent.filter(o => (filter === "all" || sfGroup(o) === filter) && (!s || [o.customerName, o.courierId, o.bikeNumbers, o.courierRecipientPhone, o.customerDetails, o.steadfastTrackingCode].join(" ").toLowerCase().includes(s)))
      .sort((a, b) => (rank[sfGroup(a)] - rank[sfGroup(b)]) || ((ageDays(b) ?? 0) - (ageDays(a) ?? 0)));
  }, [sent, filter, q]);

  const counts = useMemo(() => { const c = { all: sent.length }; sent.forEach(o => { const k = sfGroup(o); c[k] = (c[k] || 0) + 1; }); return c; }, [sent]);

  const chargeInfo = useMemo(() => {
    let total = 0, actual = 0, est = 0, over = 0;
    sfOrders.forEach(o => { const c = chargeOf(o); if (!c) return; total += c.amount; if (c.actual) actual++; else est++; const d = chargeDiff(o); if (d && d.diff > 0) over += d.diff; });
    return { total, actual, est, over };
  }, [sfOrders]);

  const returns = useMemo(() => sfOrders.filter(o => sfGroup(o) === "cancelled"), [sfOrders]);
  const loss = useMemo(() => returns.reduce((s, o) => s + returnLoss(o), 0), [returns]);

  const pct = sync.total ? Math.round((sync.done / sync.total) * 100) : 0;
  const card = (label, value, sub, cls = "") => <div className={`stat ${cls}`}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;

  return <div className="stack">
    <section className="stats">
      {card("Sent via courier", sent.length, `${sfOrders.length} Steadfast parcels`)}
      {card("On the way / on hold", g.active + g.hold, `COD ${money(g.codWay)} to collect`)}
      {card("Delivered", g.delivered, `COD ${money(g.codDone)}`)}
      {card("Cancelled / returned", g.cancelled, g.rate === null ? "—" : `Delivery success ${g.rate}%`, g.cancelled ? "warn" : "")}
      {card("Not synced / ID problem", g.none + g.error, g.noId ? `${g.noId} order has no tracking ID` : "Press Sync", g.error ? "warn" : "")}
      {card("Courier charges", money(chargeInfo.total), chargeInfo.over > 0 ? `🔴 ${money(chargeInfo.over)} beshi (dhora cost er cheye)` : `${chargeInfo.actual} actual · ${chargeInfo.est} estimated`, chargeInfo.over > 0 ? "warn" : "")}
      {card("Return loss", money(loss), `${returns.length} returned parcels`, loss > 0 ? "warn" : "")}
      {card("Ready but not sent", g.unsent, "Ready / Shipped, no courier ID")}
    </section>

    <section className="panel">
      <div className="expensehead"><div><h2>Courier sync</h2><p>Order er Tracking / parcel ID = Steadfast ID. Sync korle Steadfast theke status niye order e boshe jabe, Firebase e save hobe.</p></div></div>
      <div className="row wrap">
        <button className="btn primary" disabled={sync.busy} onClick={() => onSync(sfOrders.filter(o => !["delivered", "cancelled"].includes(sfGroup(o))))}>{sync.busy ? `Syncing ${sync.done}/${sync.total}…` : "🔄 Sync active parcels"}</button>
        <button className="btn" disabled={sync.busy} onClick={() => onSync(sfOrders, false, true)}>Sync everything</button>
        <label className="switch"><input type="checkbox" checked={autoSync} onChange={e => setAutoSync(e.target.checked)} />Auto-sync every 15 min</label>
        <span className="hint">{sync.at ? `Last sync ${sync.at.toLocaleTimeString()}` : "Not synced in this session"}</span>
      </div>
      {sync.busy && <div className="progress"><i style={{ width: `${pct}%` }} /></div>}
    </section>

    <div className="two">
      <section className="panel"><h2>Courier wise parcels</h2><p className="sub">Koto ta parcel kon courier e gelo</p>
        <HBars rows={byCourier} fmt={v => `${v} parcels`} />
      </section>
      <section className="panel"><h2>Needs attention</h2><p className="sub">5+ din dhore ashe, ekhono deliver hoyni</p>
        {!stuck.length ? <div className="empty small">Everything looks fine 🎉</div> :
          <div className="attn">{stuck.slice(0, 8).map(o => <button key={o.id} onClick={() => onOpen(o.id)}><span><strong>{o.customerName || "—"}</strong><small>{o.courierId} · {SF[o.steadfastStatus]?.label}</small></span><b className={ageDays(o) >= 10 ? "due-highlight" : "amber-t"}>{ageDays(o)} days</b></button>)}</div>}
      </section>
    </div>

    <section className="panel">
      <div className="expensehead"><div><h2>↩️ Returns & loss</h2><p>Return / cancel hoye fire asha parcel. Loss = production cost + other cost + courier charge (custom jinish tai resell hoy na).</p></div><strong className={loss > 0 ? "due-highlight" : ""}>{money(loss)}</strong></div>
      {!returns.length ? <div className="empty small">Kono return nai 🎉</div> : <div className="tablewrap"><table style={{ minWidth: 820 }}>
        <thead><tr><th>Customer</th><th>Bill</th><th>Advance held</th><th>Production + other</th><th>Courier charge</th><th>Loss</th></tr></thead>
        <tbody>{returns.map(o => <tr key={o.id} onClick={() => onOpen(o.id)}>
          <td><strong>{o.customerName || "—"}</strong><small>{o.bikeNumbers}</small></td>
          <td>{money(o.total)}</td>
          <td>{money(o.paidAmount || 0)}<small>refund / keep?</small></td>
          <td>{money(Number(o.productionCost || 0) + Number(o.otherCost || 0))}</td>
          <td>{money(courierCost(o))}<small>{chargeOf(o)?.actual ? "Steadfast" : "estimate"}</small></td>
          <td><strong className="due-highlight">{money(returnLoss(o))}</strong></td>
        </tr>)}</tbody></table></div>}
    </section>

    <section className="panel">
      <div className="toolbar courier-toolbar">
        <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="🔎  Search name, tracking ID, phone…" />
      </div>
      <div className="chips">{FILTERS.map(([k, l]) => <button key={k} className={`chip ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{l} <b>{counts[k] || 0}</b></button>)}</div>
      {!rows.length ? <div className="empty">{sent.length ? "No parcels match." : "Kono order e Tracking / parcel ID nai. Order edit kore Steadfast ID boshao."}</div> :
        <div className="tablewrap"><table style={{ minWidth: 1180 }}>
          <thead><tr><th>Customer</th><th>Steadfast ID</th><th>Courier status</th><th>COD</th><th>Charge</th><th>Age</th><th>Order status</th><th>Last sync</th><th /></tr></thead>
          <tbody>{rows.map(o => {
            const age = ageDays(o);
            return <tr key={o.id} onClick={() => onOpen(o.id)}>
              <td><strong>{o.customerName || "—"}</strong><small>{o.bikeNumbers}</small></td>
              <td>{o.courierId || "—"}{o.steadfastTrackingCode && o.steadfastTrackingCode !== o.courierId && <small>{o.steadfastTrackingCode}</small>}<small>{courierOf(o)}</small></td>
              <td><SfPill o={o} />{o.steadfastSyncError && !o.steadfastStatus && <small>{o.steadfastSyncError}</small>}</td>
              <td><strong>{money(codOf(o))}</strong></td>
              <td>{(() => {
                const c = chargeOf(o); if (!c) return "—"; const d = chargeDiff(o);
                return <><span className={d && d.diff > 0 ? "redt" : ""}>{money(c.amount)}</span><small>{c.actual ? "Steadfast" : "estimate"} · dhora {money(o.deliveryFee || 0)}</small>
                  {d && d.diff !== 0 && <small className={d.diff > 0 ? "redt" : "greent"}>{d.diff > 0 ? `▲ +${money(d.diff)} beshi` : `▼ ${money(-d.diff)} kom`}</small>}</>;
              })()}</td>
              <td className={age >= 10 && !["delivered", "cancelled"].includes(sfGroup(o)) ? "due-highlight" : ""}>{age === null ? "—" : `${age}d`}</td>
              <td>{o.orderStatus}<small>{o.deliveryStatus}</small></td>
              <td className="nowrap">{fmtDate(o.steadfastSyncedAt)}</td>
              <td><button className="btn sm" disabled={sync.busy} onClick={e => { e.stopPropagation(); onSync([o]); }}>Sync</button></td>
            </tr>;
          })}</tbody></table></div>}
    </section>
  </div>;
}
