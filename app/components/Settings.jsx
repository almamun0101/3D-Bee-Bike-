"use client";
import { useEffect, useState } from "react";
import { normalizeMonitor, DEFAULT_MONITOR, fmtAgo } from "../lib/monitor";
import { callSteadfast, FN_BASE } from "../lib/steadfastClient";
import { copyText } from "./SfPill";

export default function Settings({ cfg, onSave, notify, now }) {
  const [t, setT] = useState(cfg.tiers.map(String));
  const [stuck, setStuck] = useState(String(cfg.stuckHours));
  const [tpl, setTpl] = useState(cfg.trackingUrlTemplate);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => { setT(cfg.tiers.map(String)); setStuck(String(cfg.stuckHours)); setTpl(cfg.trackingUrlTemplate); }, [cfg]);

  const nums = t.map(Number);
  const tierErr = nums.some(n => !Number.isFinite(n) || n <= 0) ? "Every threshold must be a number above 0." : new Set(nums).size !== 4 || nums.some((n, i) => i && n <= nums[i - 1]) ? "Thresholds must increase: each one larger than the previous." : "";
  const tplErr = tpl.trim() && !normalizeMonitor({ trackingUrlTemplate: tpl }).trackingUrlTemplate ? "Use a full https:// link that contains {code} (tracking code) or {id} (consignment id)." : "";
  const stuckErr = !(Number(stuck) > 0) ? "Enter hours above 0." : "";

  async function check() {
    setBusy("health");
    try { setHealth(await callSteadfast("health")); } catch (e) { setHealth({ error: e.message }); }
    setBusy("");
  }
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function serverSync() {
    setBusy("sync");
    try { const r = await callSteadfast("serverSync"); notify(r.skipped ? `Server sync skipped: ${r.skipped}` : `Server sync done: ${r.checked} checked, ${r.changed} changed, ${r.failed} failed`, !!r.failed); await check(); }
    catch (e) { notify("Server sync failed: " + e.message, true); }
    setBusy("");
  }
  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}${FN_BASE.startsWith("http") ? "/.netlify/functions" : FN_BASE}/steadfast-webhook` : "";
  const dot = ok => <i className={`dot ${ok ? "ok" : "bad"}`} />;
  const meta = health?.meta;

  return <div className="settings">
    <section className="panel">
      <div className="phead"><h3>⏱ Delivery delay thresholds</h3><small>Hours since the parcel was shipped</small></div>
      <p className="hint">Parcels that stay with the courier longer than these limits are flagged. Defaults: {DEFAULT_MONITOR.tiers.join(" / ")} hours.</p>
      <div className="tierinputs">{t.map((v, i) => <label key={i}>Level {i + 1}<span className="inwrap"><input type="number" min="1" step="1" inputMode="numeric" value={v} onChange={e => setT(t.map((x, j) => j === i ? e.target.value : x))} /><em>hours</em></span></label>)}</div>
      {tierErr && <p className="formerr" role="alert">{tierErr}</p>}
      <label className="wide">“Stuck” when there is no courier update for<span className="inwrap"><input type="number" min="1" inputMode="numeric" value={stuck} onChange={e => setStuck(e.target.value)} /><em>hours</em></span></label>
      {stuckErr && <p className="formerr" role="alert">{stuckErr}</p>}
    </section>

    <section className="panel">
      <div className="phead"><h3>📍 Tracking link</h3></div>
      <p className="hint">Steadfast's own tracking link is saved automatically when it is returned for a parcel. If you have an official tracking page address, add it here with <code>{"{code}"}</code> (tracking code) or <code>{"{id}"}</code> (consignment id) and every order gets a clickable Track button. Nothing is guessed — it stays empty until you set it.</p>
      <label className="wide">Tracking URL template<input value={tpl} onChange={e => setTpl(e.target.value)} placeholder="https://…/{code}" spellCheck={false} /></label>
      {tplErr && <p className="formerr" role="alert">{tplErr}</p>}
    </section>

    <div className="row"><button className="btn primary" disabled={!!tierErr || !!tplErr || !!stuckErr} onClick={() => onSave({ tiers: nums, stuckHours: Number(stuck), trackingUrlTemplate: tpl.trim() })}>💾 Save settings</button>
      <button className="btn ghost" onClick={() => { setT(DEFAULT_MONITOR.tiers.map(String)); setStuck(String(DEFAULT_MONITOR.stuckHours)); }}>Reset thresholds</button></div>

    <section className="panel">
      <div className="phead"><h3>🔌 Automation & connection status</h3><button className="btn sm" disabled={busy === "health"} onClick={check}>{busy === "health" ? "Checking…" : "Re-check"}</button></div>
      {!health ? <div className="empty small">Checking…</div> : health.error ? <p className="formerr">Could not check: {health.error}</p> : <ul className="healthlist">
        <li>{dot(health.credentialsSet)}<span><b>Steadfast API keys</b><small>STEADFAST_API_KEY / STEADFAST_SECRET_KEY</small></span></li>
        <li>{dot(health.serverSyncReady)}<span><b>Automatic background sync (every 10 min)</b><small>{health.serverSyncReady ? (meta?.lastRunAt ? `Last run ${fmtAgo(Date.parse(meta.lastRunAt), now)} · ${meta.lastResult ? `${meta.lastResult.checked} checked, ${meta.lastResult.changed} changed, ${meta.lastResult.failed} failed` : "no result yet"}${meta.lastError ? ` · ${meta.lastError}` : ""}` : "Ready - first run within 10 minutes of deploy") : "Needs FIREBASE_SERVICE_ACCOUNT in Netlify environment variables"}</small></span>
          <button className="btn sm" disabled={!health.serverSyncReady || busy === "sync"} onClick={serverSync}>{busy === "sync" ? "Running…" : "Run now"}</button></li>
        <li>{dot(health.webhookReady)}<span><b>Steadfast webhook (instant updates)</b><small>{health.webhookReady ? "Token set. Paste this address into the Steadfast panel webhook settings:" : "Needs STEADFAST_WEBHOOK_TOKEN in Netlify environment variables"}</small>
          <code className="urlbox">{webhookUrl}</code></span><button className="btn sm" onClick={async () => notify((await copyText(webhookUrl)) ? "Webhook URL copied" : "Copy failed", false)}>Copy</button></li>
      </ul>}
    </section>
  </div>;
}
