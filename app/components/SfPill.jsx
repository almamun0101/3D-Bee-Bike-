import { SF, chargeOf, chargeDiff, money } from "../lib/shared";

export default function SfPill({ o }) {
  const s = o?.steadfastStatus;
  if (!s) {
    if (o?.steadfastSyncError) return <span className="pill red" title={o.steadfastSyncError}>ID mile nai</span>;
    return <span className="pill amber">Not synced</span>;
  }
  const m = SF[s] || { label: s, tone: "amber" };
  return <span className={`pill ${m.tone}`} title={o.steadfastSyncedAt ? `Synced ${new Date(o.steadfastSyncedAt).toLocaleString("en-GB")}` : ""}>{m.label}</span>;
}

// "🚚 ৳130" next to the order status. Red when Steadfast charged more than the courier cost you assumed on the order.
export function ChargeTag({ o }) {
  const c = chargeOf(o);
  if (!c) return null;
  const d = chargeDiff(o);
  const title = c.actual
    ? `Steadfast charge ${money(c.amount)} · your assumed courier cost ${money(o.deliveryFee || 0)}`
    : "Estimate (your delivery cost). Real Steadfast charge comes after payout.";
  return <small className="chargetag" title={title}>🚚 {money(c.amount)}{c.actual ? "" : " est."}
    {d && d.diff > 0 && <b className="redt"> ▲ +{money(d.diff)} beshi</b>}
    {d && d.diff < 0 && <b className="greent"> ▼ {money(-d.diff)} kom</b>}
    {d && d.diff === 0 && <b className="greent"> ✓ thik</b>}
  </small>;
}
