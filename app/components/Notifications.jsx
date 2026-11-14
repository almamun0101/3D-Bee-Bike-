"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const LS = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const SAVE = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Bell with smart alerts (delay tiers, stuck / failed parcels, follow-ups). Dismissing hides one alert; a higher delay tier alerts again.
export default function Notifications({ alerts, onOpen }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState([]);
  const [push, setPush] = useState(false);
  const seen = useRef(null);
  useEffect(() => { setDismissed(LS("bee_dismissed") || []); setPush(!!LS("bee_push") && typeof Notification !== "undefined" && Notification.permission === "granted"); }, []);
  const live = useMemo(() => alerts.filter(a => !dismissed.includes(a.key)), [alerts, dismissed]);

  // desktop / phone notification for NEW alerts while the dashboard is open (opt-in)
  useEffect(() => {
    const keys = new Set(alerts.map(a => a.key));
    if (seen.current && push) alerts.filter(a => !seen.current.has(a.key) && !dismissed.includes(a.key) && a.level !== "amber").slice(0, 3).forEach(a => { try { new Notification(a.title, { body: a.body, tag: a.key }); } catch {} });
    seen.current = keys;
  }, [alerts, push, dismissed]);

  const dismiss = keys => { const next = [...new Set([...dismissed, ...keys])].slice(-400); setDismissed(next); SAVE("bee_dismissed", next); };
  const togglePush = async () => {
    if (typeof Notification === "undefined") return alert("This browser does not support notifications.");
    if (push) { setPush(false); SAVE("bee_push", false); return; }
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (p === "granted") { setPush(true); SAVE("bee_push", true); } else alert("Notifications are blocked for this site in the browser settings.");
  };
  useEffect(() => {
    if (!open) return undefined;
    const h = e => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [open]);
  const urgent = live.filter(a => a.level === "red" || a.level === "orange").length;

  return <div className="bellwrap">
    <button className="iconbtn" aria-label={`Notifications (${live.length})`} aria-expanded={open} onClick={() => setOpen(o => !o)}>🔔{live.length > 0 && <b className={`badge ${urgent ? "hot" : ""}`}>{live.length > 99 ? "99+" : live.length}</b>}</button>
    {open && <>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="bellpanel" role="dialog" aria-label="Notifications">
        <div className="phead"><h3>Notifications</h3><div className="row"><button className="btn sm ghost" onClick={togglePush}>{push ? "🔕 Pop-ups on" : "🔔 Pop-ups off"}</button>{live.length > 0 && <button className="btn sm ghost" onClick={() => { dismiss(live.map(a => a.key)); setOpen(false); }}>Clear all</button>}</div></div>
        {!live.length ? <div className="empty small">You're all caught up ✨</div> : <ul className="alerts">{live.slice(0, 40).map(a => <li key={a.key} className={a.level}>
          <button className="grow" onClick={() => { setOpen(false); onOpen(a.orderId); }}><b>{a.title}</b><small>{a.body}</small></button>
          <button className="x" aria-label="Dismiss" onClick={() => dismiss([a.key])}>✕</button></li>)}</ul>}
      </div></>}
  </div>;
}
