"use client";

import { useMemo, useRef, useState } from "react";
import { money, num, normKey, shortDate, SIDES, TYPES, STATUSES, PAYMENTS, DEFAULT_PRICES, priceKey, sideShort, buildPlateIndex, findPlate } from "../lib/shared";

const PRICE_FIELDS = [["brtaFront", "BRTA · Front"], ["brtaBack", "BRTA · Back"], ["customFront", "Custom · Front"], ["customBack", "Custom · Back"]];

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
    const side = SIDES.includes(it.side) ? it.side : "Front Side", type = TYPES.includes(it.type) ? it.type : "BRTA";
    const def = P[priceKey(type, side)];
    const price = it.price === undefined || it.price === "" ? def : num(it.price);
    return { uid: ++uid.current, name: it.name || "", side, type, qty: Math.max(1, num(it.qty) || 1), price, edited: price !== def, focus };
  };

  const [form, setForm] = useState(() => {
    const fee = initial.deliveryFee ?? "80";
    return {
      ...initial,
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

  const items = form.items;
  const subtotal = items.reduce((s, i) => s + Math.max(0, num(i.qty)) * num(i.price), 0);
  const totalQty = items.reduce((s, i) => s + Math.max(0, num(i.qty)), 0);
  const fee = num(form.deliveryFee);
  const total = subtotal + fee;
  const due = Math.max(0, total - num(form.paidAmount) - num(form.deliveryChargePaidAmount));

  function change(e) {
    const { name, value } = e.target;
    const next = { ...form, [name]: value };
    if (name === "deliveryArea") next.deliveryFee = value === "Inside Dhaka" ? "80" : value === "Outside Dhaka" ? "130" : value === "No delivery" ? "0" : next.deliveryFee;
    if (name === "deliveryFee") next.deliveryArea = Number(value) === 80 ? "Inside Dhaka" : Number(value) === 130 ? "Outside Dhaka" : Number(value) === 0 ? "No delivery" : "Custom amount";
    if (name === "paymentStatus" && value === "Delivery Charge Paid") next.deliveryChargePaidAmount = String(num(next.deliveryFee));
    setForm(next);
  }
  const f = (name, props = {}) => ({ name, value: form[name] ?? "", onChange: change, ...props });

  // ── items ──
  const setItems = fn => setForm(s => ({ ...s, items: fn(s.items) }));
  const patch = (id, p) => setItems(list => list.map(it => {
    if (it.uid !== id) return it;
    const n = { ...it, ...p, focus: false };
    if (("side" in p || "type" in p) && !n.edited) n.price = P[priceKey(n.type, n.side)];   // option change -> default price (unless you typed your own)
    if ("price" in p) n.edited = true;
    return n;
  }));
  const addItem = () => setItems(list => [...list.map(i => ({ ...i, focus: false })), mk({}, true)]);
  const removeItem = id => setItems(list => list.length > 1 ? list.filter(i => i.uid !== id) : list);
  const bump = (it, d) => patch(it.uid, { qty: Math.max(1, num(it.qty) + d) });

  function saveDefaults() {
    const clean = {}; PRICE_FIELDS.forEach(([k]) => { clean[k] = Math.max(0, num(draft[k])); });
    onSavePrices(clean);
    setItems(list => list.map(it => it.edited ? it : { ...it, price: clean[priceKey(it.type, it.side)] }));
    setShowPrices(false);
  }

  // ── "already ordered before?" lookups ──
  const plateIndex = useMemo(() => buildPlateIndex(orders, editingId), [orders, editingId]);
  const customerNames = useMemo(() => [...new Set(orders.map(o => String(o.customerName || "").trim()).filter(Boolean))].sort().slice(0, 300), [orders]);
  const cn = normKey(form.customerName);
  const prevOrders = useMemo(() => cn.length >= 2 ? orders.filter(o => o.id !== editingId && normKey(o.customerName) === cn) : [], [orders, editingId, cn]);
  const lastPrev = prevOrders.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];

  function submit(e) {
    e.preventDefault();
    const clean = items.filter(i => i.name.trim());
    if (!form.customerName.trim()) return setErr("Customer name din.");
    if (!clean.length) return setErr("Kom pokkhe ekta item name / bike number din.");
    setErr("");
    onSave({ ...form, items: clean });
  }

  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <form className="modal ordermodal" onSubmit={submit}>
      <div className="modalhead">
        <div>
          <h2>{editing ? "Edit order" : "New order"} <span className="serialtag">#{serialNo}</span></h2>
          <p>{editing ? "Update the order details." : "Name, item, price — baki sob pore bhorle cholbe."}</p>
        </div>
        <div className="row">
          <label className="datefield">Order date<input {...f("orderDate", { type: "date" })} /></label>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      {/* 1 · customer */}
      <section className="fsec">
        <h3><i>1</i> Customer</h3>
        <div className="grid ordergrid two-col">
          <label>Customer name *
            <input {...f("customerName", { required: true, autoFocus: true, placeholder: "Customer name", list: "custnames", autoComplete: "off" })} />
            <datalist id="custnames">{customerNames.map(n => <option key={n} value={n} />)}</datalist>
            {prevOrders.length > 0 && <span className="seen soft-ok" role="status">🔁 Ager customer — {prevOrders.length}ti order{lastPrev ? ` · last #${serials[lastPrev.id] ?? "–"} (${shortDate(lastPrev)})` : ""}</span>}
          </label>
          <label>Customer info <small>(optional)</small><input {...f("customerDetails", { placeholder: "Phone / address / note" })} /></label>
        </div>
      </section>

      {/* 2 · items */}
      <section className="fsec">
        <div className="sechead">
          <h3><i>2</i> Items</h3>
          <button type="button" className="linkbtn" onClick={() => setShowPrices(v => !v)}>⚙ Default prices</button>
        </div>

        {showPrices && <div className="pricepanel">
          <p>Option select korle ei default price boshbe. Proti item e price alada kore edit kora jabe.</p>
          <div className="pricegrid">
            {PRICE_FIELDS.map(([k, l]) => <label key={k}>{l} (৳)<input type="number" min="0" value={draft[k] ?? ""} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} /></label>)}
          </div>
          <div className="row"><button type="button" className="btn sm primary" onClick={saveDefaults}>Save default prices</button><button type="button" className="btn sm" onClick={() => { setDraft(P); setShowPrices(false); }}>Cancel</button></div>
        </div>}

        <div className="itemlist">
          {items.map((it, idx) => {
            const { exact, similar } = findPlate(plateIndex, it.name);
            const dupHere = normKey(it.name) && items.some(o => o.uid !== it.uid && normKey(o.name) === normKey(it.name));
            const isCustom = it.type === "Custom";
            return <div key={it.uid} className={`itemrow ${isCustom ? "custom" : ""}`}>
              <div className="itemtop">
                <span className="itemno">{idx + 1}</span>
                <input className="itemname" value={it.name} placeholder="Bike number / item name"
                  autoFocus={it.focus || undefined} autoComplete="off"
                  onChange={e => patch(it.uid, { name: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (it.name.trim()) addItem(); } }} />
                {isCustom && <span className="custombadge">★ CUSTOM</span>}
                {items.length > 1 && <button type="button" className="icon sm" onClick={() => removeItem(it.uid)} aria-label="Remove item">✕</button>}
              </div>
              {dupHere && <div className="seen exact">⚠ Ei order e ei item agei add kora ase.</div>}
              <Seen exact={exact} similar={similar} serials={serials} />
              <div className="itemopts">
                <label>Side<select value={it.side} onChange={e => patch(it.uid, { side: e.target.value })}>{SIDES.map(s => <option key={s}>{s}</option>)}</select></label>
                <label>Type<select value={it.type} onChange={e => patch(it.uid, { type: e.target.value })}>{TYPES.map(s => <option key={s}>{s}</option>)}</select></label>
                <label>Qty
                  <div className="stepper">
                    <button type="button" onClick={() => bump(it, -1)} aria-label="Less">−</button>
                    <input type="number" min="1" value={it.qty} onChange={e => patch(it.uid, { qty: e.target.value })} onBlur={() => patch(it.uid, { qty: Math.max(1, num(it.qty)) })} />
                    <button type="button" onClick={() => bump(it, 1)} aria-label="More">+</button>
                  </div>
                </label>
                <label>Price (৳)<input type="number" min="0" value={it.price} onChange={e => patch(it.uid, { price: e.target.value })} /></label>
                <div className="linetotal"><span>Total</span><b>{money(Math.max(0, num(it.qty)) * num(it.price))}</b></div>
              </div>
            </div>;
          })}
        </div>
        <button type="button" className="btn additem" onClick={addItem}>＋ Add another item</button>
      </section>

      {/* 3 · notes */}
      <section className="fsec">
        <h3><i>3</i> Customization</h3>
        <label className="note-field">Customization notes
          <textarea {...f("instructions", { rows: 2, placeholder: "✍️ Color, size, text, design, customer request…" })} />
        </label>
      </section>

      {/* 4 · payment */}
      <section className="fsec">
        <h3><i>4</i> Delivery & payment</h3>
        <div className="grid ordergrid">
          <label>Delivery area<select {...f("deliveryArea")}><option>Inside Dhaka</option><option>Outside Dhaka</option><option>No delivery</option><option>Custom amount</option></select></label>
          <label>Delivery cost (৳)<input {...f("deliveryFee", { type: "number", min: 0 })} /></label>
          <label>Amount paid (৳)<input {...f("paidAmount", { type: "number", min: 0, step: "0.01" })} /></label>
          <label>Payment<select {...f("paymentStatus")}>{PAYMENTS.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Order status<select {...f("orderStatus")}>{STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Delivery charge paid (৳)<input {...f("deliveryChargePaidAmount", { type: "number", min: 0, max: fee, step: "0.01" })} /></label>
        </div>
      </section>

      <button type="button" className="more-toggle" onClick={() => setShowMore(v => !v)}>
        <span>{showMore ? "−" : "+"} More details</span><small>Courier, tracking, costs, extra fields</small>
      </button>
      {showMore && <div className="grid ordergrid moregrid">
        <label>Courier recipient phone<input {...f("courierRecipientPhone", { placeholder: "01XXXXXXXXX" })} /></label>
        <label className="wide">Courier delivery address<input {...f("courierRecipientAddress", { placeholder: "House, road, area, district" })} /></label>
        <label>Courier<input {...f("courierName", { placeholder: "Pathao, Steadfast…" })} /></label>
        <label>Tracking / parcel ID<input {...f("courierId", { placeholder: "Tracking ID" })} /></label>
        <label className="wide">Tracking URL<input {...f("trackingUrl", { type: "url", placeholder: "https://…" })} /></label>
        <label>Delivery status<select {...f("deliveryStatus")}>{["Not shipped", "Ready for pickup", "Picked up", "In transit", "Out for delivery", "On hold", "Partially delivered", "Delivered", "Delivery failed", "Returned"].map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Production cost (৳)<input {...f("productionCost", { type: "number", min: 0 })} /></label>
        <label>Other cost (৳)<input {...f("otherCost", { type: "number", min: 0 })} /></label>
        <label>Extra field 1<input {...f("reference1")} /></label>
        <label>Extra field 2<input {...f("reference2")} /></label>
      </div>}

      {err && <div className="alert" role="alert">{err}</div>}

      <div className="modalfoot orderfoot">
        <div className="sum">
          <span>{items.filter(i => i.name.trim()).length || items.length} item · {totalQty} pcs · Items {money(subtotal)} + Delivery {money(fee)}</span>
          <strong>{money(total)}</strong>
          <span className={due > 0 ? "due-highlight" : "paid-highlight"}>Due {money(due)}</span>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "＋ Add order"}</button>
        </div>
      </div>
    </form>
  </div>;
}
