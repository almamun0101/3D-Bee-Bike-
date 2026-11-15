"use client";
import { useMemo, useState } from "react";
import { customerInfoText } from "../lib/shared.js";
import { monitorInfo, monitorSummary, followUpDue, hasFollowUp, fmtDuration, fmtAgo, fmtDhaka, toDhakaInput, fromDhakaInput, TIERS, HOUR } from "../lib/monitor";
import SfPill, { CollectTag, TrackLink, CopyBtn } from "./SfPill";

const TABS = [
  ["active", "🚚 Active", m => m.active], ["delayed", "⏱ Delayed", m => m.delayed], ["stuck", "🧱 Stuck", m => m.stuck],
  ["failed", "⚠️ Failed", m => m.failed], ["delivered", "✅ Delivered", m => m.delivered], ["returned", "↩️ Returned", m => m.returned], ["followups", "📞 Follow-ups", (m, o) => hasFollowUp(o)]
];

function FollowUpEditor({ o, now, onSave, onClose }) {
  const [at, setAt] = useState(toDhakaInput(o.followUpAt) || toDhakaInput(now + 2 * HOUR));
  const [note, setNote] = useState(o.followUpNote || "");
  const quick = h => setAt(toDhakaInput(now + h * HOUR));
  const tomorrow = () => { const d = new Date(now + 6 * HOUR); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(10, 0, 0, 0); setAt(d.toISOString().slice(0, 16)); };
  return <div className="fuedit" onClick={e => e.stopPropagation()}>
    <div className="row wrap"><button type="button" className="chip" onClick={() => quick(1)}>+1h</button><button type="button" className="chip" onClick={() => quick(3)}>+3h</button><button type="button" className="chip" onClick={tomorrow}>Tomorrow 10:00</button></div>
    <label>Remind me (Dhaka time)<input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label>
    <label>Note<input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. call Steadfast hub, ask rider" maxLength={200} /></label>
    <div className="row wrap">
      <button type="button" className="btn primary sm" disabled={!fromDhakaInput(at)} onClick={() => onSave({ followUpAt: fromDhakaInput(at), followUpNote: note.trim(), followUpDone: false })}>Save follow-up</button>
      {o.followUpAt && <button type="button" className="btn sm" onClick={() => onSave({ followUpAt: null, followUpNote: null, followUpDone: null })}>Remove</button>}
      <button type="button" className="btn ghost sm" onClick={onClose}>Cancel</button>
    </div>
  </div>;
}

export default function Monitor({ orders, cfg, serials, now, sync, onSync, onOpen, onFollowUp, preset }) {
  const [tab, setTab] = useState(preset?.tab || "active");
  const [minTier, setMinTier] = useState(preset?.tier || 0);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);

  const rows = useMemo(() => orders.map(o => ({ o, m: monitorInfo(o, cfg, now) })).filter(r => r.m), [orders, cfg, now]);
  const sum = useMemo(() => monitorSummary(orders, cfg, now), [orders, cfg, now]);
  const counts = useMemo(() => Object.fromEntries(TABS.map(([k, , f]) => [k, rows.filter(r => f(r.m, r.o)).length])), [rows]);

  const list = useMemo(() => {
    const f = TABS.find(t => t[0] === tab)[2], needle = q.trim().toLowerCase();
    let l = rows.filter(r => f(r.m, r.o));
    if (minTier && ["active", "delayed"].includes(tab)) l = l.filter(r => r.m.tier >= minTier);
    if (needle) l = l.filter(r => [r.o.customerName, r.o.courierId, r.o.steadfastTrackingCode, r.o.courierRecipientPhone, r.o.customerDetails, "#" + (serials[r.o.id] ?? "")].join(" ").toLowerCase().includes(needle));
    return l.sort((a, b) => ["delivered", "returned"].includes(tab) ? (b.m.end || 0) - (a.m.end || 0) : tab === "followups" ? String(a.o.followUpAt).localeCompare(String(b.o.followUpAt)) : b.m.urgency - a.m.urgency || (b.m.hours || 0) - (a.m.hours || 0));
  }, [rows, tab, minTier, q, serials]);

  const go = (t, tier = 0) => { setTab(t); setMinTier(tier); };
  const tierCards = [["On time", 0, sum.tiers[0], "green"], ...cfg.tiers.map((h, i) => [`Over ${h}h`, i + 1, sum.tiers.slice(i + 1).reduce((a, b) => a + b, 0), TIERS[i + 1].tone])];

  return <div className="monitor">
    <section className="tiercards" aria-label="Delivery time overview">
      {tierCards.map(([label, tier, n, tone]) => <button key={label} className={`tiercard ${tone} ${minTier === tier && tab === (tier ? "delayed" : "active") ? "on" : ""}`} onClick={() => tier ? go("delayed", tier) : go("active", 0)}>
        <span>{label}</span><strong>{n}</strong><small>{tier ? "active parcels" : "in transit now"}</small></button>)}
      <div className="tiercard info"><span>Avg delivery time</span><strong>{fmtDuration(sum.avgHours)}</strong><small>{Number.isFinite(sum.onTimePct) ? `${sum.onTimePct}% within ${cfg.tiers[1]}h` : "no delivered parcels yet"}</small></div>
    </section>

    <section className="panel">
      <div className="toolbar">
        <nav className="subtabs" aria-label="Parcel groups">{TABS.map(([k, l]) => <button key={k} className={`subtab ${tab === k ? "active" : ""}`} onClick={() => go(k)}>{l} <b>{counts[k]}</b></button>)}</nav>
        <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Search customer, tracking ID, phone…" aria-label="Search parcels" />
        <button className="btn primary" disabled={sync.busy || !list.length || !["active", "delayed", "stuck", "failed", "followups"].includes(tab)} onClick={() => onSync(list.map(r => r.o))}>
          {sync.busy ? `Syncing ${sync.done}/${sync.total}…` : `🔄 Sync ${list.length} now`}</button>
      </div>
      {minTier > 0 && <div className="chips"><button className="chip active" onClick={() => setMinTier(0)}>Over {cfg.tiers[minTier - 1]}h ✕</button></div>}

      {!list.length ? <div className="empty">{rows.length ? "Nothing here - all clear 🎉" : "No courier parcels yet. Send an order to Steadfast or add a tracking ID and it will appear here."}</div> :
        <div className="monlist">{list.map(({ o, m }) => {
          const due = followUpDue(o, now);
          return <article key={o.id} className={`monrow t${m.tier} ${m.stuck ? "stuck" : ""} ${m.failed ? "failed" : ""}`} onClick={() => onOpen(o.id)}>
            <div className="mcust"><span className="serialtag">#{serials[o.id]}</span><strong>{o.customerName || "—"}</strong>
              {o.courierRecipientPhone && <a className="phonelink" href={`tel:${o.courierRecipientPhone}`} onClick={e => e.stopPropagation()}>📞 {o.courierRecipientPhone}</a>}<CopyBtn text={customerInfoText(o)} label="⧉ Copy info" title="Copy name, phone and address" /></div>
            <div className="mparcel"><b>{o.courierId || o.steadfastTrackingCode || "—"}</b><SfPill o={o} /><TrackLink o={o} cfg={cfg} /></div>
            <div className="mtime">
              <strong className={`tierbadge ${m.tierMeta.tone}`}>{m.closed ? (m.delivered ? "Delivered in " : "Closed after ") : ""}{fmtDuration(m.hours)}</strong>
              {m.active && <><span className={`tierlabel ${m.tierMeta.tone}`}>{m.tierMeta.label}</span><i className="bar"><u style={{ width: `${Math.min(100, ((m.hours || 0) / cfg.tiers[3]) * 100)}%` }} /></i></>}
              <small>Shipped {fmtDhaka(m.start)}</small>
            </div>
            <div className="mlast"><span>Last update {fmtAgo(m.last, now)}</span>{o.steadfastTrackingMessage && <small className="clip1">“{o.steadfastTrackingMessage}”</small>}<small>Checked {fmtAgo(m.checkedAt, now)}</small>
              {o.steadfastSyncError && <small className={m.failed ? "err" : ""}>{m.failed ? "⚠ " : "↻ Last check failed, retrying: "}{o.steadfastSyncError}</small>}</div>
            <div className="mmoney"><CollectTag o={o} /></div>
            <div className="mfu" onClick={e => e.stopPropagation()}>
              {o.followUpAt && !o.followUpDone ? <div className={`fubadge ${due ? "due" : ""}`}><b>{due ? "⏰ Follow up now" : `📞 ${fmtDhaka(o.followUpAt)}`}</b>{o.followUpNote && <small>{o.followUpNote}</small>}
                <div className="row wrap"><button className="btn sm" onClick={() => onFollowUp(o.id, { followUpDone: true })}>✓ Done</button><button className="btn sm ghost" onClick={() => setEditing(editing === o.id ? null : o.id)}>Edit</button></div></div>
                : <button className="btn sm ghost" onClick={() => setEditing(editing === o.id ? null : o.id)}>＋ Follow-up</button>}
              {editing === o.id && <FollowUpEditor o={o} now={now} onClose={() => setEditing(null)} onSave={p => { onFollowUp(o.id, p); setEditing(null); }} />}
            </div>
            <div className="mact" onClick={e => e.stopPropagation()}>
              {m.active && <button className="btn sm" disabled={sync.busy} onClick={() => onSync([o])} title="Check Steadfast now">🔄</button>}
              <button className="btn sm" onClick={() => onOpen(o.id)}>Open</button>
            </div>
          </article>;
        })}</div>}
    </section>
  </div>;
}
