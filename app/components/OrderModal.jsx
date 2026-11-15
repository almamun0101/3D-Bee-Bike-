"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { money, num, normKey, shortDate, SIDES, TYPES, STATUSES, PAYMENTS, VEHICLES, DEFAULT_PRICES, itemPrice, sideShort, buildPlateIndex, findPlate } from "../lib/shared";

const PRICE_FIELDS = [["bikeFront", "🏍 Bike · Front"], ["scooterFront", "🛵 Scooter · Front"], ["bikeBack", "🏍 Bike · Back"], ["scooterBack", "🛵 Scooter · Back"], ["customExtra", "★ Custom size extra"]];
const PHONE_RE = /01[3-9]\d{8}/;
const cleanPhone = v => String(v || "").replace(/[\s-]/g, "").replace(/^\+?88/, "");
const VEH_LABEL = { Bike: "🏍 Bike", Scooter: "🛵 Scooter" }, SIDE_LABEL = { "Front Side": "Front", "Back Side": "Back" }, TYPE_LABEL = { BRTA: "BRTA", Custom: "★ Custom" };
const AUTO_PAY = ["Unpaid", "Paid Advance", "Paid Full"];

// one-tap choice buttons (much faster than dropdowns, especially on a phone)
function Seg({ value, options, labels, onChange, label }) {
  return <div className="seg" role="radiogroup" aria-label={label}>
    {options.map(o => <button key={o} type="button" role="radio" aria-checked={value === o} className={`segbtn ${value === o ? "active" : ""}`} onClick={() => onChange(o)}>{labels?.[o] ?? o}</button>)}
  </div>;
}

// "Already ordered before" note shown under an item / customer name while typing
function Seen({ exact, similar, serials }) {
  const row = (k, i) => <li key={i}><b>#{serials[k.order.id] ?? "–"}</b> {k.order.customerName || "—"} · {shortDate(k.order)}{k.side ? ` · ${sideShort(k.side)} · ${k.type}` : ""}{k.name ? <em> {k.name}</em> : null}</li>;
  if (!exact.length && !similar.length) return null;
  return <div className={`seen ${exact.length ? "exact" : ""}`} role="status">
    {exact.length > 0 && <><strong>⚠ Ei item ager order e ase ({exact.length}x)</strong><ul>{exact.slice(0, 3).map(row)}</ul></>}
    {similar.length > 0 && <><strong className="soft">{exact.length ? "Similar:" : "Similar item ager order e ase:"}</strong><ul>{similar.slice(0, 3).map(row)}</ul></>}
  </div>;
}

export default function OrderModal({ initial, editing, editingId, orders, serials, serialNo, prices, onSavePrices, onClose, onSave, busy }) {
  const P = { ...DEFAULT_PRICES, ...(prices || {}) };
  const uid = useRef(0);
  const mk = (it = {}, focus = false) => {
    const vehicle = VEHICLES.includes(it.vehicle) ? it.vehicle : "Bike", side = SIDES.includes(it.side) ? it.side : "Front Side", type = TYPES.includes(it.type) ? it.type : "BRTA";
    const def = itemPrice(vehicle, side, type, P);
    const price = it.price === undefined || it.price === "" ? def : num(it.price);
    return { uid: ++uid.current, name: it.name || "", vehicle, side, type, qty: Math.max(1, num(it.qty) || 1), price, edited: price !== def, focus };
  };

  const [form, setForm] = useState(() => {
    const fee = initial.deliveryFee ?? "80";
    const det = String(initial.customerDetails || "");
    return {
      ...initial,
      // phone + address are first-class fields now (old orders: taken from "customer info")
      courierRecipientPhone: initial.courierRecipientPhone || (det.match(PHONE_RE) || [""])[0],
      courierRecipientAddress: initial.courierRecipientAddress || det.replace(PHONE_RE, "").replace(/^[\s·,|/-]+|[\s·,|/-]+$/g, "").trim(),
      orderDate: initial.orderDate || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }),
      deliveryFee: String(fee),
      deliveryArea: Number(fee) === 130 ? "Outside Dhaka" : Number(fee) === 80 ? "Inside Dhaka" : Number(fee) === 0 ? "No delivery" : "Custom amount",
      paymentStatus: initial.paymentStatus || "Unpaid",
      deliveryChargePaidAmount: initial.deliveryChargePaidAmount ?? "0",
      orderStatus: initial.orderStatus || "Pending",
      items: Array.isArray(initial.items) && initial.items.length ? initial.items.map(i => mk(i)) : [mk({})]
    };
  });
  const [showMore, setShowMore] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [draft, setDraft] = useState(P);
  const [err, setErr] = useState("");
  const topRef = useRef(null);
  const [copied, setCopied] = useState(false);
  async function pasteTracking() {
    try { const t = (await navigator.clipboard.readText()).trim(); if (t) setForm(s => ({ ...s, courierId: t.split(/\s+/)[0] })); else setErr("Clipboard khali."); }
    catch { setErr("Browser clipboard permission dey nai. Field-e click kore Ctrl+V / paste koro."); }
  }
  async function copyTracking() { try { await navigator.clipboard.writeText(form.courierId); setCopied(true); setTimeout(() => setCopied(false), 1300); } catch {} }

  const items = form.items;
  const subtotal = items.reduce((s, i) => s + Math.max(0, num(i.qty)) * num(i.price), 0);
  const totalQty = items.reduce((s, i) => s + Math.max(0, num(i.qty)), 0);
  const fee = num(form.deliveryFee);
  const total = subtotal + fee;
  const due = Math.max(0, total - num(form.paidAmount) - num(form.deliveryChargePaidAmount));
  const namedItems = items.filter(i => i.name.trim()).length;
  const phone = cleanPhone(form.courierRecipientPhone);
  const phoneOk = /^01\d{9}$/.test(phone);

  const withAutoPay = next => {
    if (!AUTO_PAY.includes(next.paymentStatus)) return next;
    const sub = next.items.reduce((s, i) => s + Math.max(0, num(i.qty)) * num(i.price), 0), t = sub + num(next.deliveryFee) - num(next.deliveryChargePaidAmount), paid = num(next.paidAmount);
    return { ...next, paymentStatus: paid <= 0 ? "Unpaid" : paid >= t ? "Paid Full" : "Paid Advance" };
  };
  function change(e) {
    const { name, value } = e.target;
    let next = { ...form, [name]: value };
    if (name === "deliveryArea") next.deliveryFee = value === "Inside Dhaka" ? "80" : value === "Outside Dhaka" ? "130" : value === "No delivery" ? "0" : next.deliveryFee;
    if (name === "deliveryFee") next.deliveryArea = Number(value) === 80 ? "Inside Dhaka" : Number(value) === 130 ? "Outside Dhaka" : Number(value) === 0 ? "No delivery" : "Custom amount";
    if (name === "paymentStatus" && value === "Delivery Charge Paid") next.deliveryChargePaidAmount = String(num(next.deliveryFee));
    if (name === "paidAmount") next = withAutoPay(next);
    setForm(next);
  }
  const f = (name, props = {}) => ({ name, value: form[name] ?? "", onChange: change, ...props });
  const setPaid = amount => setForm(s => withAutoPay({ ...s, paidAmount: String(Math.max(0, Math.round(amount))) }));
  const setArea = a => change({ target: { name: "deliveryArea", value: a } });

  // ── items ──
  const setItems = fn => setForm(s => ({ ...s, items: fn(s.items) }));
  const patch = (id, p) => setItems(list => list.map(it => {
    if (it.uid !== id) return it;
    const n = { ...it, ...p, focus: false };
    if (("vehicle" in p || "side" in p || "type" in p) && !n.edited) n.price = itemPrice(n.vehicle, n.side, n.type, P);   // option change -> default price (unless you typed your own)
    if ("price" in p) n.edited = true;
    return n;
  }));
  const addItem = () => setItems(list => { const last = list[list.length - 1] || {}; return [...list.map(i => ({ ...i, focus: false })), mk({ vehicle: last.vehicle, side: last.side, type: last.type }, true)]; });
  const removeItem = id => setItems(list => list.length > 1 ? list.filter(i => i.uid !== id) : list);
  const bump = (it, d) => patch(it.uid, { qty: Math.max(1, num(it.qty) + d) });
  const resetPrice = it => setItems(list => list.map(x => x.uid === it.uid ? { ...x, price: itemPrice(x.vehicle, x.side, x.type, P), edited: false } : x));
  const otherSide = s => s === "Front Side" ? "Back Side" : "Front Side";
  const hasPair = it => items.some(o => o.uid !== it.uid && normKey(o.name) === normKey(it.name) && o.side === otherSide(it.side) && o.vehicle === it.vehicle && o.type === it.type);
  const addPair = it => setItems(list => { const i = list.findIndex(x => x.uid === it.uid); const copy = [...list]; copy.splice(i + 1, 0, mk({ name: it.name, vehicle: it.vehicle, type: it.type, qty: it.qty, side: otherSide(it.side) })); return copy; });

  function saveDefaults() {
    const clean = {}; PRICE_FIELDS.forEach(([k]) => { clean[k] = Math.max(0, num(draft[k])); });
    onSavePrices(clean);
    setItems(list => list.map(it => it.edited ? it : { ...it, price: itemPrice(it.vehicle, it.side, it.type, clean) }));
    setShowPrices(false);
  }

  // ── "already ordered before?" lookups ──
  const plateIndex = useMemo(() => buildPlateIndex(orders, editingId), [orders, editingId]);
  const customerNames = useMemo(() => [...new Set(orders.map(o => String(o.customerName || "").trim()).filter(Boolean))].sort().slice(0, 300), [orders]);
  const cn = normKey(form.customerName);
  const prevOrders = useMemo(() => cn.length >= 2 ? orders.filter(o => o.id !== editingId && normKey(o.customerName) === cn) : [], [orders, editingId, cn]);
  const lastPrev = prevOrders.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  const lastPhone = lastPrev ? (lastPrev.courierRecipientPhone || (String(lastPrev.customerDetails || "").match(PHONE_RE) || [""])[0]) : "";
  const lastAddr = lastPrev ? (lastPrev.courierRecipientAddress || String(lastPrev.customerDetails || "").replace(PHONE_RE, "").replace(/^[\s·,|/-]+|[\s·,|/-]+$/g, "").trim()) : "";
  const canReuse = !!(lastPrev && (lastPhone || lastAddr) && (!form.courierRecipientPhone || !form.courierRecipientAddress));

  function submit(e) {
    e?.preventDefault();
    const clean = items.filter(i => i.name.trim());
    const fail = m => { setErr(m); topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); };
    if (!form.customerName.trim()) return fail("Customer name din.");
    if (!clean.length) return fail("Kom pokkhe ekta bike / scooter number din.");
    if (form.courierRecipientPhone && !phoneOk) return fail("Phone number thik na. 11 digit din (01XXXXXXXXX), ba khali rakhun.");
    setErr("");
    const addr = String(form.courierRecipientAddress || "").trim();
    onSave({ ...form, courierRecipientPhone: phone, courierRecipientAddress: addr, customerDetails: [phone, addr].filter(Boolean).join(" · ") || form.customerDetails || "", items: clean });
  }

  // Ctrl/Cmd + Enter saves from anywhere in the form, Esc closes it
  useEffect(() => {
    const h = e => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [busy, onClose]);

  const priceLine = `Front 🏍 ${money(P.bikeFront)} · 🛵 ${money(P.scooterFront)}  |  Back ${P.bikeBack === P.scooterBack ? money(P.bikeBack) : `🏍 ${money(P.bikeBack)} · 🛵 ${money(P.scooterBack)}`}${num(P.customExtra) ? `  |  Custom +${money(P.customExtra)}` : ""}`;

  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <form className="modal ordermodal v4" onSubmit={submit} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit(e); }} noValidate>
      <div ref={topRef} className="modalhead">
        <div>
          <h2>{editing ? "Edit order" : "New order"} <span className="serialtag">#{serialNo}</span></h2>
          <p>{editing ? "Update the order details." : "Customer, bike/scooter number, side — baki sob auto. Ctrl+Enter diye save."}</p>
        </div>
        <div className="row">
          <label className="datefield">Order date<input {...f("orderDate", { type: "date" })} /></label>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      {err && <div className="alert" role="alert">{err}</div>}

      {/* tracking id: first field, big and easy to paste into */}
      <div className="trackbox">
        <div className="trackhead"><b>📦 Parcel tracking ID</b><small>sticker print-e lagbe · pore-o dewa jay</small></div>
        <div className="trackinput">
          <input {...f("courierId", { placeholder: "Tracking ID ekhane paste koro", autoComplete: "off", autoCapitalize: "characters", spellCheck: false, "aria-label": "Parcel tracking ID", autoFocus: editing && !form.courierId })} />
          <button type="button" className="btn sm" onClick={pasteTracking}>📋 Paste</button>
          {form.courierId && <button type="button" className="btn sm" onClick={copyTracking}>{copied ? "✓ Copied" : "⧉ Copy"}</button>}
        </div>
      </div>

      {/* 1 · customer */}
      <section className="fsec">
        <h3><i>1</i> Customer</h3>
        <div className="grid ordergrid two-col">
          <label>Customer name *
            <input {...f("customerName", { autoFocus: !editing, placeholder: "Customer name", list: "custnames", autoComplete: "off", "aria-required": true })} />
            <datalist id="custnames">{customerNames.map(n => <option key={n} value={n} />)}</datalist>
            {prevOrders.length > 0 && <span className="seen soft-ok" role="status">🔁 Ager customer — {prevOrders.length}ti order{lastPrev ? ` · last #${serials[lastPrev.id] ?? "–"} (${shortDate(lastPrev)})` : ""}
              {canReuse && <button type="button" className="linkbtn inlinebtn" onClick={() => setForm(s => ({ ...s, courierRecipientPhone: s.courierRecipientPhone || lastPhone, courierRecipientAddress: s.courierRecipientAddress || lastAddr }))}>Use last phone & address</button>}</span>}
          </label>
          <label>Phone <small>{form.courierRecipientPhone ? (phoneOk ? "✓" : "⚠ 11 digit lagbe") : "(courier er jonno)"}</small>
            <input {...f("courierRecipientPhone", { type: "tel", inputMode: "tel", placeholder: "01XXXXXXXXX", autoComplete: "off", className: form.courierRecipientPhone && !phoneOk ? "bad" : "" })} />
          </label>
          <label className="wide">Delivery address <small>(optional)</small>
            <input {...f("courierRecipientAddress", { placeholder: "House, road, area, district", autoComplete: "off" })} />
          </label>
        </div>
      </section>

      {/* 2 · items */}
      <section className="fsec">
        <div className="sechead">
          <h3><i>2</i> Bike / scooter plates</h3>
          <button type="button" className="linkbtn" onClick={() => setShowPrices(v => !v)}>⚙ Edit prices</button>
        </div>
        <button type="button" className="pricehint" onClick={() => setShowPrices(v => !v)} title="Default prices (tap to edit)">💰 {priceLine}</button>

        {showPrices && <div className="pricepanel">
          <p>Vehicle + side select korle ei default price boshbe. Proti item e price alada kore edit kora jabe.</p>
          <div className="pricegrid">
            {PRICE_FIELDS.map(([k, l]) => <label key={k}>{l} (৳)<input type="number" min="0" inputMode="numeric" value={draft[k] ?? ""} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} /></label>)}
          </div>
          <div className="row"><button type="button" className="btn sm primary" onClick={saveDefaults}>Save default prices</button><button type="button" className="btn sm" onClick={() => { setDraft(P); setShowPrices(false); }}>Cancel</button></div>
        </div>}

        <div className="itemlist">
          {items.map((it, idx) => {
            const { exact, similar } = findPlate(plateIndex, it.name);
            const dupHere = normKey(it.name) && items.some(o => o.uid !== it.uid && normKey(o.name) === normKey(it.name) && o.side === it.side && o.vehicle === it.vehicle && o.type === it.type);
            const isCustom = it.type === "Custom", def = itemPrice(it.vehicle, it.side, it.type, P);
            return <div key={it.uid} className={`itemrow ${isCustom ? "custom" : ""}`}>
              <div className="itemtop">
                <span className="itemno">{idx + 1}</span>
                <input className="itemname" value={it.name} placeholder="Bike / scooter number  (e.g. DHAKA-METRO-HA 11-2233)" aria-label={`Plate ${idx + 1}`}
                  autoFocus={it.focus || undefined} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                  onChange={e => patch(it.uid, { name: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (it.name.trim()) addItem(); } }} />
                {items.length > 1 && <button type="button" className="icon sm" onClick={() => removeItem(it.uid)} aria-label={`Remove plate ${idx + 1}`}>✕</button>}
              </div>
              {dupHere && <div className="seen exact">⚠ Ei order e ei plate, ei side, agei add kora ase.</div>}
              <Seen exact={exact} similar={similar} serials={serials} />
              <div className="itemseg">
                <div><span className="lbl">Vehicle</span><Seg label="Vehicle" value={it.vehicle} options={VEHICLES} labels={VEH_LABEL} onChange={v => patch(it.uid, { vehicle: v })} /></div>
                <div><span className="lbl">Side</span><Seg label="Side" value={it.side} options={SIDES} labels={SIDE_LABEL} onChange={v => patch(it.uid, { side: v })} /></div>
                <div><span className="lbl">Size</span><Seg label="Size" value={it.type} options={TYPES} labels={TYPE_LABEL} onChange={v => patch(it.uid, { type: v })} /></div>
              </div>
              <div className="itembottom">
                <div className="qtybox"><span className="lbl">Qty</span>
                  <div className="stepper">
                    <button type="button" onClick={() => bump(it, -1)} aria-label="Less">−</button>
                    <input type="number" min="1" inputMode="numeric" value={it.qty} aria-label="Quantity" onChange={e => patch(it.uid, { qty: e.target.value })} onBlur={() => patch(it.uid, { qty: Math.max(1, num(it.qty)) })} />
                    <button type="button" onClick={() => bump(it, 1)} aria-label="More">+</button>
                  </div>
                </div>
                <div className="pricebox"><span className="lbl">Price (৳) {it.edited ? <button type="button" className="linkbtn" onClick={() => resetPrice(it)}>reset to {money(def)}</button> : <em>auto</em>}</span>
                  <input type="number" min="0" inputMode="numeric" value={it.price} aria-label="Price" onChange={e => patch(it.uid, { price: e.target.value })} /></div>
                <div className="linetotal"><span>Total</span><b>{money(Math.max(0, num(it.qty)) * num(it.price))}</b></div>
              </div>
              {normKey(it.name) && !hasPair(it) && <button type="button" className="pairbtn" onClick={() => addPair(it)}>＋ {it.side === "Front Side" ? "Back" : "Front"} side-o lagbe ({VEH_LABEL[it.vehicle]} · {money(itemPrice(it.vehicle, otherSide(it.side), it.type, P))})</button>}
            </div>;
          })}
        </div>
        <button type="button" className="btn additem" onClick={addItem}>＋ Add another plate</button>
      </section>

      {/* 3 · notes */}
      <section className="fsec">
        <h3><i>3</i> Customization <small className="opt">(optional)</small></h3>
        <label className="note-field">
          <textarea {...f("instructions", { rows: 2, placeholder: "✍️ Color, size, text, design, customer request…" })} aria-label="Customization notes" />
        </label>
      </section>

      {/* 4 · delivery & payment */}
      <section className="fsec">
        <h3><i>4</i> Delivery & payment</h3>
        <div className="paygrid">
          <div className="payblock"><span className="lbl">Delivery</span>
            <Seg label="Delivery area" value={form.deliveryArea} options={["Inside Dhaka", "Outside Dhaka", "No delivery", "Custom amount"]} labels={{ "Inside Dhaka": "Inside Dhaka ৳80", "Outside Dhaka": "Outside ৳130", "No delivery": "None", "Custom amount": "Custom" }} onChange={setArea} />
            {form.deliveryArea === "Custom amount" && <label className="inl">Delivery cost (৳)<input {...f("deliveryFee", { type: "number", min: 0, inputMode: "numeric" })} /></label>}
          </div>
          <div className="payblock"><span className="lbl">Paid so far</span>
            <div className="paidrow">
              <input {...f("paidAmount", { type: "number", min: 0, step: "0.01", inputMode: "decimal", "aria-label": "Amount paid" })} />
              <button type="button" className="chip" onClick={() => setPaid(0)}>None</button>
              <button type="button" className="chip" onClick={() => setPaid(total / 2)}>Half</button>
              <button type="button" className="chip" onClick={() => setPaid(total - num(form.deliveryChargePaidAmount))}>Full {money(total)}</button>
            </div>
          </div>
          <label>Payment<select {...f("paymentStatus")}>{PAYMENTS.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Order status<select {...f("orderStatus")}>{STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
          {(num(form.deliveryChargePaidAmount) > 0 || form.paymentStatus === "Delivery Charge Paid") &&
            <label>Delivery charge paid (৳)<input {...f("deliveryChargePaidAmount", { type: "number", min: 0, max: fee, step: "0.01" })} /></label>}
        </div>
      </section>

      <button type="button" className="more-toggle" onClick={() => setShowMore(v => !v)} aria-expanded={showMore}>
        <span>{showMore ? "−" : "+"} More details</span><small>Courier, costs, extra fields</small>
      </button>
      {showMore && <div className="grid ordergrid moregrid">
        <label>Courier<input {...f("courierName", { placeholder: "Pathao, Steadfast…" })} /></label>
        <label className="wide">Tracking URL<input {...f("trackingUrl", { type: "url", placeholder: "https://…" })} /></label>
        <label>Delivery status<select {...f("deliveryStatus")}>{["Not shipped", "Ready for pickup", "Picked up", "In transit", "Out for delivery", "On hold", "Partially delivered", "Delivered", "Delivery failed", "Returned"].map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Production cost (৳)<input {...f("productionCost", { type: "number", min: 0 })} /></label>
        <label>Other cost (৳)<input {...f("otherCost", { type: "number", min: 0 })} /></label>
        <label>Extra field 1<input {...f("reference1")} /></label>
        <label>Extra field 2<input {...f("reference2")} /></label>
      </div>}

      <div className="modalfoot orderfoot">
        <div className="sum">
          <span>{namedItems || items.length} plate · {totalQty} pcs · Items {money(subtotal)} + Delivery {money(fee)}</span>
          <strong>{money(total)}</strong>
          <span className={due > 0 ? "due-highlight" : "paid-highlight"}>{due > 0 ? `Due ${money(due)}` : "Fully paid ✓"}</span>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "＋ Add order"}</button>
        </div>
      </div>
    </form>
  </div>;
}
