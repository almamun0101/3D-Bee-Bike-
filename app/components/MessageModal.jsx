"use client";
import { useEffect, useMemo, useState } from "react";
import { banglaMessage, messageKind, KIND_LABEL, whatsappNumber } from "../lib/messages.js";
import { trackingLinkOf } from "../lib/monitor.js";
import { phoneOf } from "../lib/shared.js";
import { copyText } from "./SfPill";

// Bangla message for the customer: generated from the order, editable, one tap to copy or open in WhatsApp.
export default function MessageModal({ order, serial, brand, cfg, onClose }) {
  const [kind, setKind] = useState(() => messageKind(order));
  const [bn, setBn] = useState(true);
  const generated = useMemo(() => banglaMessage(order, serial, { kind, brand, link: trackingLinkOf(order, cfg), bnDigits: bn }), [order, serial, kind, brand, cfg, bn]);
  const [text, setText] = useState(generated);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setText(generated); }, [generated]);                 // options changed -> regenerate
  useEffect(() => { const h = e => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const wa = whatsappNumber(phoneOf(order));

  return <div className="overlay front" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="modal msgmodal" role="dialog" aria-label="Bangla message">
      <div className="modalhead">
        <div><h2>💬 Customer message <span className="serialtag">#{serial}</span></h2><p>Order theke auto banano. Edit kore nao, tarpor copy ba WhatsApp e pathao.</p></div>
        <button type="button" className="icon" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="seg msgkinds" role="radiogroup" aria-label="Message type">
        {Object.entries(KIND_LABEL).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={`segbtn ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      <label className="inl msgdigits"><input type="checkbox" checked={bn} onChange={e => setBn(e.target.checked)} /> বাংলা সংখ্যা (১২৩)</label>
      <textarea className="msgtext" value={text} onChange={e => setText(e.target.value)} aria-label="Message text" spellCheck={false} />
      <p className="hint">Option bodlale message abar auto-generate hoy (tomar edit mushe jabe).{!brand?.pageUrl && " Page link set kora nai: Settings > Brand e dile message-e link jabe."}</p>
      <div className="modalfoot">
        <span className="hint">{text.length} chars</span>
        <div className="row wrap">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn primary" onClick={async () => { if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? "✓ Copied" : "📋 Copy message"}</button>
          {wa ? <a className="btn wa" href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer noopener">🟢 WhatsApp</a> : <span className="hint">WhatsApp: valid phone nai</span>}
        </div>
      </div>
    </div>
  </div>;
}
