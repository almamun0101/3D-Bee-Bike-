"use client";
import { useState } from "react";
import { SF, chargeOf, chargeDiff, money, codInfo } from "../lib/shared";
import { trackingLinkOf } from "../lib/monitor";

export default function SfPill({ o }) {
  const s = o?.steadfastStatus, meta = s ? SF[s] : null;
  if (!s) return o?.steadfastSyncError ? <span className="pill red" title={o.steadfastSyncError}>⚠ ID problem</span> : null;
  return <span className={`pill ${meta?.tone || "amber"}`} title={`Steadfast: ${s}`}>{meta?.label || s}</span>;
}

// Steadfast delivery charge vs. what the order assumed
export function ChargeTag({ o }) {
  const c = chargeOf(o); if (!c) return null;
  const d = chargeDiff(o);
  return <small className="chargetag" title={c.actual ? "Real Steadfast charge" : "Your assumed delivery cost"}>🚚 {money(c.amount)}{c.actual ? "" : " (est.)"}{d && d.diff !== 0 && <b className={d.diff > 0 ? "up" : "down"}> {d.diff > 0 ? "+" : "−"}{money(Math.abs(d.diff))}</b>}</small>;
}

// "💰 Collect ৳1,250" while the parcel is out for COD, "✅ COD ৳1,250 collected" after Steadfast delivered it
export function CollectTag({ o }) {
  const c = codInfo(o);
  if (!c || c.state === "paid") return null;
  return c.state === "collect"
    ? <small className="collecttag"><b>💰 Collect {money(c.amount)}</b></small>
    : <small className="collecttag done">✅ COD {money(c.amount)} collected</small>;
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch { const a = Object.assign(document.createElement("textarea"), { value: t }); document.body.appendChild(a); a.select(); const ok = document.execCommand?.("copy"); a.remove(); return !!ok; }
}

// Clickable tracking: a real link (from Steadfast / your own template) + copy button. No link is ever guessed.
export function TrackLink({ o, cfg, showId }) {
  const [copied, setCopied] = useState(false);
  const link = trackingLinkOf(o, cfg), id = String(o?.steadfastTrackingCode || o?.courierId || "");
  if (!link && !id) return null;
  const stop = e => e.stopPropagation();
  return <span className="trackrow" onClick={stop}>
    {link && <a className="trackbtn" href={link} target="_blank" rel="noreferrer noopener">📍 Track</a>}
    {id && <button type="button" className="trackbtn ghost" title="Copy tracking ID" onClick={async e => { stop(e); if (await copyText(id)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }}>{copied ? "✓ Copied" : showId ? `⧉ ${id}` : "⧉ Copy ID"}</button>}
  </span>;
}
