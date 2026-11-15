"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { ref, onValue, push, set, update, remove } from "firebase/database";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDb, getAuthInstance, getFirebaseConfigError, DB_ROOT, REQUIRE_LOGIN } from "./lib/firebase";
import { printLabel, browserPrint, pdfPreview, changePrinter, getMode, setMode, PRINTER_MODES, SIZES, getSizeKey, setSizeKey } from "./lib/printLabel";
import { money, getDue, isPaid, isDone, fmtDate, isSteadfast, sfIds, sfGroup, SF, chargeOf, chargeDiff, courierCost, isReturned, returnLoss, buildSyncPatch, codInfo, SMART, num, pick, orderTime, STATUSES, PAYMENTS, DEFAULT_PRICES, itemsOfOrder, itemsText, sideShort, VEHICLES } from "./lib/shared";
import { callSteadfast, FN_BASE } from "./lib/steadfastClient";
import SfPill, { ChargeTag, CollectTag, TrackLink } from "./components/SfPill";
import Monitor from "./components/Monitor";
import Overview from "./components/Dashboard";
import Notifications from "./components/Notifications";
import Settings from "./components/Settings";
import { normalizeMonitor, monitorInfo, followUpDue, fmtDuration, fmtAgo, fmtDhaka, TZ } from "./lib/monitor";
import { buildAlerts } from "./lib/alerts";
import { useNow } from "./lib/useNow";
import { toCsv, toXlsx, download, stamp, ORDER_COLUMNS } from "./lib/exporter";
import BillCell from "./components/BillCell";
import Courier from "./components/Courier";
import Analytics from "./components/Analytics";
import OrderModal from "./components/OrderModal";


const LABELS = {
  customerName: "Customer", courierRecipientPhone: "Courier phone", courierRecipientAddress: "Courier address", deliveryChargePaidAmount: "Delivery charge paid", bikeNumbers: "Bike number(s)", customerDetails: "Contact / address", deliveryArea: "Delivery area",
  paymentStatus: "Payment", courierId: "Tracking / parcel ID", courierName: "Courier", trackingUrl: "Tracking URL", deliveryStatus: "Delivery", productionCost: "Production cost", deliveryFee: "Delivery fee", otherCost: "Other cost", paidAmount: "Paid amount", instructions: "Customization",
  reference1: "Extra field 1", reference2: "Extra field 2", quantity: "Quantity",
  unitPrice: "Unit price", total: "Total", dueAmount: "Due amount", orderStatus: "Status", orderDate: "Order date",
  createdAt: "Created", updatedAt: "Last updated", id: "Order ID", serial: "Serial no.", itemsSubtotal: "Items subtotal"
};
const KNOWN_ORDER = Object.keys(LABELS);
const MONEY_KEYS = ["unitPrice", "total", "dueAmount", "productionCost", "deliveryFee", "otherCost", "paidAmount", "deliveryChargePaidAmount"];

const EMPTY = {
  customerName: "", courierRecipientPhone: "", courierRecipientAddress: "", deliveryChargePaidAmount: "0", bikeNumbers: "", customerDetails: "", paymentStatus: "Unpaid",
  courierId: "", courierName: "", trackingUrl: "", deliveryStatus: "Not shipped",
  instructions: "", reference1: "", reference2: "", quantity: "1",
  unitPrice: "250", total: "330", deliveryArea: "Inside Dhaka", productionCost: "0", deliveryFee: "80", otherCost: "0",
  paidAmount: "0", orderStatus: "Pending", orderDate: ""
};

const prettyKey = k => LABELS[k] || k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
const statusTone = s => /deliver|complet/i.test(s) ? "green" : /cancel|return/i.test(s) ? "red" : /ship|ready/i.test(s) ? "violet" : /process|print/i.test(s) ? "blue" : "amber";
const payTone = s => /^unpaid/i.test(s) ? "red" : /^paid/i.test(s) ? "green" : /cash|^delivery charge/i.test(s) ? "blue" : "amber";
const display = (k, v) => v === undefined || v === null || v === "" ? "—" : MONEY_KEYS.includes(k) ? money(v) : ["createdAt", "updatedAt"].includes(k) ? fmtDate(v) : typeof v === "object" ? JSON.stringify(v) : String(v);

/* ───────────── Login ───────────── */
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [courierBusy, setCourierBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await signInWithEmailAndPassword(getAuthInstance(), email.trim(), password); }
    catch (e) { setErr("Sign in failed. Check email and password (" + (e.code || e.message) + ")."); }
    finally { setBusy(false); }
  }
  return <main className="loginwrap">
    <form className="logincard" onSubmit={submit}>
      <div className="logo">🐝</div>
      <h1>3D Bee Order Desk</h1>
      <p>Admin sign in</p>
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
      {err && <div className="alert">{err}</div>}
      <button className="btn primary block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  </main>;
}

/* ───────────── item chips (custom highlighted) ───────────── */
function ItemChips({ o }) {
  const has = Array.isArray(o.items) && o.items.length;
  return <div className="itemchips">{itemsOfOrder(o).map((i, k) => <span key={k} className={`ichip ${has && i.type === "Custom" ? "custom" : ""}`}>
    <b>{i.name || "—"}</b>
    {has ? <small>{i.vehicle === "Scooter" ? "🛵 " : ""}{sideShort(i.side)} · {i.type}{num(i.qty) > 1 ? ` ×${num(i.qty)}` : ""}</small> : (num(o.quantity) > 1 ? <small>×{num(o.quantity)}</small> : null)}
  </span>)}</div>;
}

/* ───────────── Detail drawer: shows EVERY field ───────────── */
const notesText = o => (Array.isArray(o.internalNotes) ? o.internalNotes.map(n => n?.text).join(" ") : "");
// same customer = same phone (last 10 digits), else same name
const custKey = o => {
  const phone = String(o.courierRecipientPhone || (String(o.customerDetails || "").match(/01[3-9]\d{8}/) || [""])[0]).replace(/\D/g, "").slice(-10);
  if (phone.length >= 10) return "p" + phone;
  const name = String(o.customerName || "").trim().toLowerCase().replace(/\s+/g, " ");
  return name.length >= 3 ? "n" + name : "";
};

function Drawer({ order, serial, cfg, now, orders, serials, onOpen, onNote, onFollowUp, onClose, onEdit, onDelete, onQuick, onRecordPayment, onDeliveryChargePaid, onCreateCourier, courierBusy, onSync, syncBusy }) {
  const [paymentInput, setPaymentInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const mi = monitorInfo(order, cfg, now);
  const ck = custKey(order);
  const past = useMemo(() => ck ? orders.filter(o => o.id !== order.id && custKey(o) === ck).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))) : [], [orders, order.id, ck]);
  const notes = Array.isArray(order.internalNotes) ? order.internalNotes : [];
  const due = getDue(order);
  const cod = codInfo(order);
  // smart "next step" button
  const st = order.orderStatus || "";
  const next = /cancel|return|complet|deliver/i.test(st) ? null
    : /^pending$/i.test(st) ? { label: "▶ Start processing", run: () => onQuick(order.id, "orderStatus", "Processing") }
    : /^processing$/i.test(st) ? { label: "🖨️ Mark as printing", run: () => onQuick(order.id, "orderStatus", "Printing") }
    : /^printing$/i.test(st) ? { label: "📦 Mark ready to ship", run: () => onQuick(order.id, "orderStatus", "Ready to ship") }
    : !order.courierId ? { label: "🚚 Send to Steadfast", run: () => onCreateCourier(order) }
    : { label: "🔄 Check courier status now", run: () => onSync(order) };
  const deliveryRemaining = Math.max(0, Number(order.deliveryFee || 0) - Number(order.deliveryChargePaidAmount || 0));
  const keys = [...KNOWN_ORDER.filter(k => k === "id" || k in order), ...Object.keys(order).filter(k => !KNOWN_ORDER.includes(k)).sort()].filter(k => k !== "items");
  return <div className="overlay right" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <aside className="drawer">
      <div className="modalhead">
        <div><h2>{serial ? <span className="serialtag">#{serial}</span> : null} {order.customerName || "Unnamed order"}</h2><p>{fmtDate(order.createdAt || order.orderDate)}</p></div>
        <button className="icon" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="drawertags">
        <span className={`pill ${statusTone(order.orderStatus)}`}>{order.orderStatus || "—"}</span> <ChargeTag o={order} />
        <span className={`pill ${payTone(order.paymentStatus)}`}>{order.paymentStatus || "—"}</span>
        <strong className="big">{money(order.total)}</strong>
      </div>
      {cod?.state === "collect" && <div className="collectbox"><span>💰 Collect from customer (COD)</span><strong>{money(cod.amount)}</strong><small>Steadfast delivery-r somoy ei taka ta nibe</small></div>}
      {cod?.state === "collected" && <div className="collectbox done"><span>✅ COD collected by Steadfast</span><strong>{money(cod.amount)}</strong></div>}
      {next && <button className="btn primary nextstep" disabled={courierBusy || syncBusy} onClick={next.run}>{next.label}</button>}
      <div className="quick">
        <label>Status<select value={order.orderStatus || ""} onChange={e => onQuick(order.id, "orderStatus", e.target.value)}>
          {!STATUSES.includes(order.orderStatus) && order.orderStatus && <option>{order.orderStatus}</option>}{STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Payment<select value={order.paymentStatus || ""} onChange={e => onQuick(order.id, "paymentStatus", e.target.value)}>
          {!PAYMENTS.includes(order.paymentStatus) && order.paymentStatus && <option>{order.paymentStatus}</option>}{PAYMENTS.map(x => <option key={x}>{x}</option>)}</select></label>
      </div>
      <section className="payment-box">
        <div className="payment-summary"><span>Outstanding due</span><strong className={due > 0 ? "due-highlight" : "paid-highlight"}>{money(due)}</strong></div>
        <div className="payment-summary"><span>Paid to business</span><b>{money(order.paidAmount || 0)}</b></div>
        <div className="payment-summary"><span>Delivery charge paid separately</span><b>{money(order.deliveryChargePaidAmount || 0)}</b></div>
        <form className="payment-actions" onSubmit={e => { e.preventDefault(); onRecordPayment(order.id, paymentInput); setPaymentInput(""); }}>
          <input type="number" min="0.01" step="0.01" max={due} value={paymentInput} onChange={e => setPaymentInput(e.target.value)} placeholder="Payment amount (৳)" />
          <button className="btn primary" disabled={!paymentInput || Number(paymentInput) <= 0 || Number(paymentInput) > due}>＋ Record payment</button>
        </form>
        {deliveryRemaining > 0 && <button className="btn" onClick={() => onDeliveryChargePaid(order.id)}>Mark delivery charge paid ({money(deliveryRemaining)})</button>}
        <button className="btn" onClick={() => onCreateCourier(order)} disabled={courierBusy}>{courierBusy ? "Creating courier order…" : "Create Steadfast shipment"}</button>
        <small>Steadfast COD will be set to the remaining due after recorded payments and separately paid delivery charge.</small>
      </section>
      {(order.courierId || order.steadfastStatus) && <section className="payment-box">
        <div className="payment-summary"><span>Steadfast status</span><SfPill o={order} /></div>
        <div className="payment-summary"><span>Steadfast ID</span><b>{order.courierId || "—"}</b></div>
        <div className="payment-summary"><span>Courier cost you assumed</span><b>{money(order.deliveryFee || 0)}</b></div>
        {chargeOf(order) && <div className="payment-summary"><span>Steadfast charge{chargeOf(order).actual ? "" : " (estimate)"}</span><b className={chargeDiff(order)?.diff > 0 ? "redt" : ""}>{money(chargeOf(order).amount)}</b></div>}
        {chargeDiff(order) && chargeDiff(order).diff !== 0 && <div className="payment-summary"><span>Difference</span><b className={chargeDiff(order).diff > 0 ? "redt" : "greent"}>{chargeDiff(order).diff > 0 ? "▲ +" : "▼ "}{money(Math.abs(chargeDiff(order).diff))}</b></div>}
        <div className="payment-summary"><span>Last synced</span><b>{fmtDate(order.steadfastSyncedAt)}</b></div>
        {order.steadfastSyncError && !order.steadfastStatus && <div className="alert">{order.steadfastSyncError}</div>}
        <button className="btn" onClick={() => onSync(order)} disabled={syncBusy}>{syncBusy ? "Syncing…" : "🔄 Sync courier status"}</button>
      </section>}
      <section className="payment-box">
        <button className="btn primary" onClick={() => printLabel(order, serial)}>🖨️ Print sticker (Bluetooth)</button>
        <label>Sticker size (mm)<select defaultValue={getSizeKey()} onChange={e => setSizeKey(e.target.value)}>{SIZES.map(z => <option key={z} value={z}>{z.replace("x", " × ")}</option>)}</select></label>
        <label>Printer type<select defaultValue={getMode()} onChange={e => setMode(e.target.value)}>{Object.entries(PRINTER_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="row wrap"><button className="btn sm" onClick={changePrinter}>Change printer</button><button className="btn sm" onClick={() => pdfPreview(order, serial)}>📄 PDF preview</button><button className="btn sm" onClick={() => browserPrint(order, serial)}>Normal print</button></div>
      </section>
      {(order.courierId || order.steadfastTrackingCode) && <section className="payment-box">
        <div className="payment-summary"><span>Tracking</span><TrackLink o={order} cfg={cfg} showId /></div>
        {mi && <>
          <div className="payment-summary"><span>{mi.closed ? (mi.delivered ? "Delivered in" : "Closed after") : "In transit for"}</span><b className={`tierbadge ${mi.tierMeta.tone}`}>{fmtDuration(mi.hours)}{mi.active && mi.tier ? ` · ${mi.tierMeta.label}` : ""}</b></div>
          <div className="payment-summary"><span>Shipped</span><b>{fmtDhaka(mi.start)}</b></div>
          <div className="payment-summary"><span>Last courier update</span><b>{Number.isFinite(mi.last) ? `${fmtAgo(mi.last, now)} · ${fmtDhaka(mi.last)}` : "—"}</b></div></>}
        {order.steadfastTrackingMessage && <div className="payment-summary"><span>Courier message</span><b className="msg">{order.steadfastTrackingMessage}</b></div>}
        {Array.isArray(order.steadfastEvents) && order.steadfastEvents.length > 0 && <ol className="events">{[...order.steadfastEvents].reverse().slice(0, 8).map((e, i) => <li key={i}><b>{SF[e.status]?.label || e.status || "Update"}</b>{e.message && <span>{e.message}</span>}<time>{fmtDhaka(e.at)}</time></li>)}</ol>}
      </section>}
      {order.followUpAt && !order.followUpDone && <section className={`payment-box fubadge ${followUpDue(order, now) ? "due" : ""}`}>
        <div className="payment-summary"><span>📞 Follow-up</span><b>{followUpDue(order, now) ? "Due now" : fmtDhaka(order.followUpAt)}</b></div>
        {order.followUpNote && <small>{order.followUpNote}</small>}
        <button className="btn sm" onClick={() => onFollowUp(order.id, { followUpDone: true })}>✓ Mark done</button>
      </section>}
      <section className="drawer-items">
        <h3>Internal notes <small>(only you can see these)</small></h3>
        <form className="noteform" onSubmit={e => { e.preventDefault(); if (noteInput.trim()) { onNote(order.id, "add", noteInput.trim()); setNoteInput(""); } }}>
          <input value={noteInput} onChange={e => setNoteInput(e.target.value)} placeholder="Add a note…" maxLength={500} aria-label="Internal note" />
          <button className="btn primary sm" disabled={!noteInput.trim()}>Add</button>
        </form>
        {notes.length > 0 && <ul className="notes">{[...notes].map((n, i) => ({ n, i })).reverse().map(({ n, i }) => <li key={i}><p>{n.text}</p><small>{fmtDhaka(n.at)}{n.by ? ` · ${n.by}` : ""}</small><button className="x" aria-label="Delete note" onClick={() => onNote(order.id, "delete", i)}>✕</button></li>)}</ul>}
      </section>
      {past.length > 0 && <section className="drawer-items">
        <h3>Customer history <small>{past.length} other order{past.length > 1 ? "s" : ""} · lifetime {money(past.reduce((a, o) => a + Number(o.total || 0), Number(order.total || 0)))}{past.some(o => getDue(o) > 0) ? ` · due ${money(past.reduce((a, o) => a + getDue(o), 0))}` : ""}</small></h3>
        <ul className="history">{past.slice(0, 6).map(o => <li key={o.id}><button onClick={() => onOpen(o.id)}><b>#{serials[o.id]}</b><span>{o.bikeNumbers || fmtDate(o.createdAt)}</span><i className={`pill ${statusTone(o.orderStatus)}`}>{o.orderStatus || "—"}</i><em>{money(o.total)}</em></button></li>)}</ul>
      </section>}
      <section className="drawer-items">
        <h3>Items</h3>
        {itemsOfOrder(order).map((i, k) => {
          const has = Array.isArray(order.items) && order.items.length;
          return <div key={k} className={`ditem ${has && i.type === "Custom" ? "custom" : ""}`}>
            <div><strong>{i.name || "—"}</strong>{has && <small>{i.vehicle === "Scooter" ? "🛵 Scooter" : "🏍 Bike"} · {i.side} · {i.type}{i.type === "Custom" ? " ★" : ""}</small>}</div>
            <span>{num(i.qty)} × {money(i.price)}</span><b>{money(num(i.qty) * num(i.price))}</b>
          </div>;
        })}
      </section>
      <dl className="fields">
        {keys.map(k => <div key={k}><dt>{prettyKey(k)}</dt><dd>{display(k, order[k])}</dd></div>)}
      </dl>
      {Array.isArray(order.timeline) && order.timeline.length > 0 && <section className="timeline">
        <h3>Order activity</h3>
        {[...order.timeline].reverse().map((event, i) => <div className="timelineitem" key={`${event.at || i}-${i}`}><i /><div><strong>{event.status || "Update"}</strong><p>{event.note || "Order updated"} · {fmtDate(event.at)}</p></div></div>)}
      </section>}
      <div className="modalfoot">
        <button className="btn danger" onClick={() => onDelete(order.id)}>Delete</button>
        <button className="btn primary" onClick={() => onEdit(order)}>Edit order</button>
      </div>
    </aside>
  </div>;
}

/* ───────────── Dashboard ───────────── */
function Desk({ user }) {
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [expenseName, setExpenseName] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Materials");
  const [prices, setPrices] = useState(DEFAULT_PRICES);
  const [lastSynced, setLastSynced] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(false);
  const [firebaseError, setFirebaseError] = useState("");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState([]);
  const [pays, setPays] = useState([]);
  const [courierF, setCourierF] = useState("any");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [picked, setPicked] = useState(() => new Set());
  const [views, setViews] = useState({});
  const [cfg, setCfg] = useState(() => normalizeMonitor(null));
  const [monPreset, setMonPreset] = useState(null);
  const creatingRef = useRef(new Set());
  const now = useNow(30000);
  const [sort, setSort] = useState("newest");
  const [modal, setModal] = useState(null);   // null | { id?, values }
  const [selected, setSelected] = useState(null);
  // Esc closes the order drawer (the edit form is left alone so nothing typed is lost)
  useEffect(() => {
    const h = e => { if (e.key === "Escape") { setExportOpen(false); if (!modal) setSelected(null); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [modal]);
  const [busy, setBusy] = useState(false);
  const [courierBusy, setCourierBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState("dashboard");   // dashboard | orders | monitor | courier | analytics | settings
  const [sync, setSync] = useState({ busy: false, done: 0, total: 0, at: null });
  const [autoSync, setAutoSyncState] = useState(true);
  const [smart, setSmart] = useState("all");
  const ordersRef = useRef([]);
  const syncingRef = useRef(false);

  const notify = useCallback((text, bad) => {
    setToast({ text, bad });
  }, []);

  useEffect(() => {
    let db;
    try {
      db = getDb();
    } catch (err) {
      setFirebaseError(err.message || "Firebase configuration is missing.");
      setLoaded(true);
      return undefined;
    }
    const offOrders = onValue(ref(db, `${DB_ROOT}/orders`), snap => {
      const data = snap.val() || {};
      setOrders(Object.entries(data).filter(([, v]) => v && typeof v === "object").map(([id, v]) => ({ ...v, id })));
      setFirebaseError("");
      setLastSynced(new Date());
      setLoaded(true);
    }, err => {
      setLoaded(true);
      setFirebaseError(err.message || "Unable to read the Realtime Database.");
      notify("Firebase error: " + err.message, true);
    });
    const offExpenses = onValue(ref(db, `${DB_ROOT}/expenses`), snap => {
      const data = snap.val() || {};
      setExpenses(Object.entries(data).filter(([, v]) => v && typeof v === "object").map(([id, v]) => ({ ...v, id })));
    }, err => setFirebaseError(err.message || "Unable to read expenses."));
    const offPrices = onValue(ref(db, `${DB_ROOT}/settings/defaultPrices`), snap => setPrices({ ...DEFAULT_PRICES, ...(snap.val() || {}) }), () => {});
    const offCfg = onValue(ref(db, `${DB_ROOT}/settings/monitor`), snap => setCfg(normalizeMonitor(snap.val())), () => {});
    const offViews = onValue(ref(db, `${DB_ROOT}/settings/views`), snap => setViews(snap.val() || {}), () => {});
    const offConn = onValue(ref(db, ".info/connected"), s => setOnline(!!s.val()));
    return () => { offOrders(); offExpenses(); offPrices(); offCfg(); offViews(); offConn(); };
  }, [notify]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") { setModal(null); setSelected(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedOrder = selected && orders.find(o => o.id === selected);
  ordersRef.current = orders;

  // serial number: stored on new orders; older orders get one by creation order
  const serials = useMemo(() => {
    const m = {};
    orders.filter(o => !o.serial).sort((a, b) => (orderTime(a) || 0) - (orderTime(b) || 0) || String(a.id).localeCompare(String(b.id))).forEach((o, i) => { m[o.id] = i + 1; });
    orders.forEach(o => { if (o.serial) m[o.id] = Number(o.serial); });
    return m;
  }, [orders]);
  const nextSerial = Math.max(0, ...Object.values(serials)) + 1;

  async function savePrices(p) {
    try { await set(ref(getDb(), `${DB_ROOT}/settings/defaultPrices`), p); notify("Default prices saved"); }
    catch (e) { notify("Could not save default prices: " + e.message, true); }
  }

  const setAutoSync = v => { setAutoSyncState(v); try { localStorage.setItem("sf_auto", v ? "1" : "0"); } catch {} };
  useEffect(() => { try { if (localStorage.getItem("sf_auto") === "0") setAutoSyncState(false); } catch {} }, []);

  // Match tracking IDs with Steadfast and save the live status on every order.
  async function syncCourier(list, silent, full) {
    if (syncingRef.current) return;
    const targets = (Array.isArray(list) ? list : [list]).filter(o => o && isSteadfast(o) && sfIds(o).length);
    if (!targets.length) { if (!silent) notify("Sync korar moto Steadfast parcel nai. Order e Tracking / parcel ID boshao.", true); return; }
    syncingRef.current = true;
    setSync(s => ({ ...s, busy: true, done: 0, total: targets.length }));
    let ok = 0, bad = 0, changed = 0;
    try {
      const db = getDb();
      for (let i = 0; i < targets.length; i += 10) {
        const chunk = targets.slice(i, i + 10);
        const res = await callSteadfast("status", { items: chunk.map(o => ({ key: o.id, ids: sfIds(o) })) });
        await Promise.all(chunk.map(async o => {
          const r = res.results?.[o.id] || { error: "No response from Steadfast" };
          const out = buildSyncPatch(o, r, new Date().toISOString());
          if (out.ok) { ok++; if (out.changed) changed++; } else bad++;
          const patch = out.patch;
          await update(ref(db, `${DB_ROOT}/orders/${o.id}`), patch);
        }));
        setSync(s => ({ ...s, done: Math.min(targets.length, i + chunk.length) }));
      }
      let gotCharges = 0;
      try { await new Promise(r => setTimeout(r, 1200)); gotCharges = await syncCharges(full); } catch (e) { console.warn("[steadfast] charge sync failed:", e); }
      setSync({ busy: false, done: targets.length, total: targets.length, at: new Date() });
      if (!silent || changed || bad || gotCharges) notify(`Steadfast sync done · ${ok} matched${changed ? `, ${changed} status changed` : ""}${gotCharges ? `, ${gotCharges} courier charge` : ""}${bad ? `, ${bad} ID problem` : ""}`, !!bad && !ok);
    } catch (e) {
      setSync(s => ({ ...s, busy: false }));
      notify("Steadfast sync error: " + e.message, true);
    } finally { syncingRef.current = false; }
  }

  // Real delivery charge per parcel, read quietly from Steadfast payments (after a parcel is delivered / returned).
  async function syncCharges(forceAll) {
    const need = ordersRef.current.filter(o => isSteadfast(o) && sfIds(o).length && ["delivered", "cancelled"].includes(sfGroup(o)) && (forceAll || o.steadfastCharge === undefined));
    if (!need.length) return 0;
    const keyMap = new Map();
    need.forEach(o => [o.courierId, o.steadfastTrackingCode, `3DBEE-${o.id}`].forEach(k => k && keyMap.set(String(k).toLowerCase(), o)));
    let doneIds = [];
    try { doneIds = forceAll ? [] : JSON.parse(localStorage.getItem("sf_paid_done") || "[]"); } catch {}
    const doneSet = new Set(doneIds.map(String));
    const pid = p => String(pick(p, ["id", "payment_id"]));
    const list = [], seen = new Set();
    for (let p = 1; p <= 10; p++) {
      const d = await callSteadfast("payments", { page: p });
      const fresh = (Array.isArray(d) ? d : d?.data || d?.payments || d?.results || []).filter(x => !seen.has(pid(x)));
      if (!fresh.length) break;
      fresh.forEach(x => seen.add(pid(x))); list.push(...fresh);
    }
    const todo = list.filter(p => !doneSet.has(pid(p)));
    const db = getDb(), failed = new Set();
    let matched = 0, logged = false;
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map(async p => {
        let d;
        try { d = await callSteadfast("payment", { id: pid(p) }); } catch { failed.add(pid(p)); return; }
        const pay = { ...p, ...(d.payment || (d.data && !Array.isArray(d.data) ? d.data : {}) || {}) };
        const cons = d.consignments || d.data?.consignments || pay.consignments || [];
        if (!logged) { logged = true; console.info("[steadfast] payment sample (send this if charges look wrong):", pay, cons[0]); }
        const given = pick(pay, ["charge", "total_charge", "delivery_charge"]);
        const a = pick(pay, ["amount"]), t = pick(pay, ["total"]);
        const payCharge = given !== undefined ? Math.abs(num(given)) : a !== undefined && t !== undefined ? Math.abs(num(a) - num(t)) : null;
        const cod = c => num(pick(c, ["cod_amount", "amount"]));
        const codSum = cons.reduce((s, c) => s + cod(c), 0);
        await Promise.all(cons.map(async c => {
          const key = [pick(c, ["consignment_id", "id"]), pick(c, ["tracking_code"]), pick(c, ["invoice"])].filter(Boolean).map(k => String(k).toLowerCase()).find(k => keyMap.has(k));
          if (!key) return;
          const own = pick(c, ["delivery_charge", "charge", "courier_charge", "total_charge"]);
          let amount, actual = true;
          if (own !== undefined) amount = Math.abs(num(own));
          else if (payCharge === null) return;
          else if (cons.length === 1) amount = payCharge;
          else { amount = Math.round(codSum ? (payCharge * cod(c)) / codSum : payCharge / cons.length); actual = false; }
          await update(ref(db, `${DB_ROOT}/orders/${keyMap.get(key).id}`), { steadfastCharge: amount, steadfastChargeActual: actual, steadfastPaymentId: pid(p) });
          matched++;
        }));
      }));
    }
    try { localStorage.setItem("sf_paid_done", JSON.stringify(list.map(pid).filter(x => !failed.has(x)))); } catch {}
    return matched;
  }

  // auto-sync: once after load, then every 5 minutes and whenever you come back to the tab (only parcels that are still on the way)
  useEffect(() => {
    if (!autoSync || !loaded || !REQUIRE_LOGIN) return undefined;
    let last = 0;
    const run = () => { last = Date.now(); syncCourier(ordersRef.current.filter(o => isSteadfast(o) && sfIds(o).length && !["delivered", "cancelled"].includes(sfGroup(o)) && !isDone(o.orderStatus)), true); };
    const onFocus = () => { if (document.visibilityState !== "hidden" && Date.now() - last > 2 * 60 * 1000) run(); };
    const first = window.setTimeout(run, 2500);
    const timer = window.setInterval(run, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", onFocus); window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync, loaded]);

  const stats = useMemo(() => {
    const live = orders.filter(o => !/cancel/i.test(o.orderStatus || "") && !isReturned(o));
    const returned = orders.filter(o => isReturned(o) && !/cancel/i.test(o.orderStatus || ""));
    const returnLossTotal = returned.reduce((s, o) => s + returnLoss(o), 0);
    return {
      count: orders.length,
      value: live.reduce((s, o) => s + Number(o.total || 0), 0),
      due: live.reduce((s, o) => s + getDue(o), 0),
      costs: live.reduce((s, o) => s + Number(o.productionCost || 0) + courierCost(o) + Number(o.otherCost || 0), 0),
      returnLoss: returnLossTotal, returned: returned.length,
      overhead: expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
      profit: live.reduce((s, o) => s + Number(o.total || 0) - Number(o.productionCost || 0) - courierCost(o) - Number(o.otherCost || 0), 0) - returnLossTotal - expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
      active: orders.filter(o => !isDone(o.orderStatus)).length,
      delivery: live.filter(o => !/delivered/i.test(o.deliveryStatus || "") && !/cancel/i.test(o.orderStatus || "")).length,
      withCourier: orders.filter(o => isSteadfast(o) && ["active", "hold"].includes(sfGroup(o))).length,
      toCollect: orders.reduce((a, o) => a + (codInfo(o)?.state === "collect" ? codInfo(o).amount : 0), 0),
      toCollectN: orders.filter(o => codInfo(o)?.state === "collect").length,
      collected: orders.reduce((a, o) => a + (codInfo(o)?.state === "collected" ? codInfo(o).amount : 0), 0)
    };
  }, [orders, expenses]);

  const statusCounts = useMemo(() => {
    const c = { All: orders.length };
    orders.forEach(o => { const s = o.orderStatus || "—"; c[s] = (c[s] || 0) + 1; });
    return c;
  }, [orders]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sv = SMART.find(x => x[0] === smart)?.[2];
    const from = dateFrom ? Date.parse(`${dateFrom}T00:00:00+06:00`) : NaN, to = dateTo ? Date.parse(`${dateTo}T23:59:59+06:00`) : NaN;
    const list = orders.filter(o => {
      if (sv && !sv(o)) return false;
      if (statuses.length && !statuses.includes(o.orderStatus || "—")) return false;
      if (pays.length && !pays.includes(o.paymentStatus)) return false;
      const hasTrack = !!(o.courierId || o.steadfastTrackingCode);
      if (courierF === "with" && !hasTrack) return false;
      if (courierF === "without" && hasTrack) return false;
      if (dueOnly && getDue(o) <= 0) return false;
      if (Number.isFinite(from) || Number.isFinite(to)) { const t = orderTime(o); if (!Number.isFinite(t) || (Number.isFinite(from) && t < from) || (Number.isFinite(to) && t > to)) return false; }
      return !q || (Object.values(o).filter(v => typeof v !== "object").join(" ") + " #" + (serials[o.id] ?? "") + " " + notesText(o)).toLowerCase().includes(q);
    });
    const key = o => String(o.createdAt || o.id);
    const sorters = {
      newest: (a, b) => key(b).localeCompare(key(a)),
      oldest: (a, b) => key(a).localeCompare(key(b)),
      highest: (a, b) => Number(b.total || 0) - Number(a.total || 0),
      due: (a, b) => getDue(b) - getDue(a),
      name: (a, b) => String(a.customerName || "").localeCompare(String(b.customerName || ""))
    };
    return list.sort(sorters[sort]);
  }, [orders, serials, search, statuses, pays, courierF, dueOnly, dateFrom, dateTo, sort, smart]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const curPage = Math.min(page, pageCount);
  const pageRows = useMemo(() => visible.slice((curPage - 1) * pageSize, curPage * pageSize), [visible, curPage, pageSize]);
  useEffect(() => { setPage(1); }, [search, statuses, pays, courierF, dueOnly, dateFrom, dateTo, sort, smart, pageSize]);
  // drop selections of orders that disappeared
  useEffect(() => { setPicked(p => { const ids = new Set(orders.map(o => o.id)); const n = new Set([...p].filter(id => ids.has(id))); return n.size === p.size ? p : n; }); }, [orders]);
  const alerts = useMemo(() => buildAlerts(orders, cfg, serials, now), [orders, cfg, serials, now]);
  const activeFilters = statuses.length + pays.length + (courierF !== "any") + dueOnly + !!dateFrom + !!dateTo + (smart !== "all");
  const clearFilters = () => { setStatuses([]); setPays([]); setCourierF("any"); setDueOnly(false); setDateFrom(""); setDateTo(""); setSmart("all"); setSearch(""); };
  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const smartCounts = useMemo(() => Object.fromEntries(SMART.map(([k, , f]) => [k, orders.filter(f).length])), [orders]);

  async function addExpense(e) {
    e.preventDefault();
    const amount = Number(expenseAmount);
    if (!expenseName.trim() || !Number.isFinite(amount) || amount <= 0) return notify("Enter an expense name and a valid amount.", true);
    try {
      const item = push(ref(getDb(), `${DB_ROOT}/expenses`));
      await set(item, { name: expenseName.trim(), category: expenseCategory, amount, createdAt: new Date().toISOString() });
      setExpenseName(""); setExpenseAmount(""); notify("Expense saved and synced");
    } catch (e) { notify("Could not save expense: " + e.message, true); }
  }

  async function deleteExpense(id) {
    if (!confirm("Delete this expense record?")) return;
    try { await remove(ref(getDb(), `${DB_ROOT}/expenses/${id}`)); notify("Expense deleted"); }
    catch (e) { notify("Could not delete expense: " + e.message, true); }
  }

  async function quick(id, field, value, silent) {
    try {
      const now = new Date().toISOString();
      const current = orders.find(o => o.id === id);
      const patch = { [field]: value, updatedAt: now };
      if (field === "paymentStatus" && /^paid full$/i.test(value)) { patch.paidAmount = Math.max(0, Number(current?.total || 0) - Number(current?.deliveryChargePaidAmount || 0)); patch.dueAmount = 0; }
      if (field === "paymentStatus" && /^delivery charge paid$/i.test(value)) {
        // choosing "Delivery Charge Paid" fills the delivery charge automatically and recalculates the due
        const fee = Number(current?.deliveryFee || 0), already = Number(current?.deliveryChargePaidAmount || 0);
        const due = Math.max(0, Number(current?.total || 0) - Number(current?.paidAmount || 0) - fee);
        patch.deliveryChargePaidAmount = fee; patch.dueAmount = due;
        if (fee > already) patch.paymentHistory = [...(Array.isArray(current?.paymentHistory) ? current.paymentHistory : []), { amount: fee - already, type: "Delivery charge paid separately", at: now }];
        if (due <= 0) patch.paymentStatus = "Paid Full";
      }
      if (field === "orderStatus" && current?.orderStatus !== value) {
        const timeline = Array.isArray(current?.timeline) ? current.timeline : [];
        patch.timeline = [...timeline, { status: value, note: "Order status changed", at: now }];
      }
      await update(ref(getDb(), `${DB_ROOT}/orders/${id}`), patch);
      if (!silent) notify(`${prettyKey(field)} updated to “${value}”`);
    } catch (e) { notify("Update failed: " + e.message, true); }
  }

  async function save(form) {
    setBusy(true);
    const items = (Array.isArray(form.items) ? form.items : []).filter(i => String(i.name || "").trim()).map(i => ({
      name: String(i.name).trim(), vehicle: VEHICLES.includes(i.vehicle) ? i.vehicle : "Bike", side: i.side, type: i.type, qty: Math.max(1, num(i.qty)), price: num(i.price)
    }));
    const qty = items.reduce((s, i) => s + i.qty, 0), subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
    const price = qty ? Math.round(subtotal / qty * 100) / 100 : 0;
    const payload = {
      ...form, items, bikeNumbers: itemsText(items), quantity: qty, unitPrice: price,
      total: subtotal + Number(form.deliveryFee || 0),
      itemsSubtotal: subtotal,
      productionCost: Number(form.productionCost || 0), deliveryFee: Number(form.deliveryFee || 0),
      otherCost: Number(form.otherCost || 0), paidAmount: Number(form.paidAmount || 0),
      deliveryChargePaidAmount: Math.min(Number(form.deliveryFee || 0), Number(form.deliveryChargePaidAmount || 0)),
      dueAmount: Math.max(0, subtotal + Number(form.deliveryFee || 0) - Number(form.paidAmount || 0) - Number(form.deliveryChargePaidAmount || 0)),
      updatedAt: new Date().toISOString()
    };
    try {
      if (modal?.id) {
        const old = orders.find(o => o.id === modal.id);
        const timeline = Array.isArray(old?.timeline) ? [...old.timeline] : [];
        if (old?.orderStatus !== payload.orderStatus) timeline.push({ status: payload.orderStatus, note: "Order status changed", at: new Date().toISOString() });
        await update(ref(getDb(), `${DB_ROOT}/orders/${modal.id}`), { ...payload, timeline });
        notify("Order updated");
      } else {
        const newRef = push(ref(getDb(), `${DB_ROOT}/orders`));
        await set(newRef, {
          ...payload, serial: nextSerial,
          orderDate: form.orderDate || new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" }),
          createdAt: new Date().toISOString(),
          timeline: [{ status: form.orderStatus || "Pending", note: "Order created", at: new Date().toISOString() }]
        });
        notify(`Order #${nextSerial} saved`);
      }
      setModal(null);
    } catch (e) { notify("Could not save: " + e.message, true); }
    finally { setBusy(false); }
  }

  async function recordPayment(id, rawAmount) {
    const amount = Number(rawAmount);
    const order = orders.find(o => o.id === id);
    if (!order || !Number.isFinite(amount) || amount <= 0 || amount > getDue(order)) return notify("Enter a valid payment not greater than the outstanding due.", true);
    const now = new Date().toISOString();
    const payment = { amount, type: "Customer payment", at: now };
    const history = Array.isArray(order.paymentHistory) ? order.paymentHistory : [];
    const paidAmount = Number(order.paidAmount || 0) + amount;
    const total = Number(order.total || 0);
    const due = Math.max(0, total - paidAmount - Number(order.deliveryChargePaidAmount || 0));
    try {
      await update(ref(getDb(), `${DB_ROOT}/orders/${id}`), {
        paidAmount, dueAmount: due, paymentStatus: due <= 0 ? "Paid Full" : "Paid Advance",
        paymentHistory: [...history, payment], updatedAt: now
      });
      notify(`Payment ${money(amount)} recorded. Remaining due: ${money(due)}`);
    } catch (e) { notify("Could not record payment: " + e.message, true); }
  }

  async function markDeliveryChargePaid(id) {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const fee = Number(order.deliveryFee || 0);
    const already = Number(order.deliveryChargePaidAmount || 0);
    const amount = Math.max(0, fee - already);
    if (!amount) return notify("Delivery charge is already marked as paid.");
    const now = new Date().toISOString();
    const history = Array.isArray(order.paymentHistory) ? order.paymentHistory : [];
    const deliveryChargePaidAmount = already + amount;
    const due = Math.max(0, Number(order.total || 0) - Number(order.paidAmount || 0) - deliveryChargePaidAmount);
    try {
      await update(ref(getDb(), `${DB_ROOT}/orders/${id}`), {
        deliveryChargePaidAmount, dueAmount: due,
        paymentHistory: [...history, { amount, type: "Delivery charge paid separately", at: now }],
        updatedAt: now
      });
      notify(`Delivery charge ${money(amount)} deducted from due. Remaining due: ${money(due)}`);
    } catch (e) { notify("Could not update delivery payment: " + e.message, true); }
  }

  async function createSteadfastOrder(order) {
    if (!order) return;
    if (creatingRef.current.has(order.id)) return;
    if (order.courierId && !confirm(`This order already has tracking ID ${order.courierId}. Create ANOTHER Steadfast parcel for it?`)) return;
    creatingRef.current.add(order.id);
    const phone = String(order.courierRecipientPhone || (String(order.customerDetails || "").match(/01[3-9]\d{8}/) || [""])[0]).trim();
    const address = String(order.courierRecipientAddress || order.customerDetails || "").trim();
    if (!phone || !address) return notify("Add the recipient phone and full courier address in Edit order first.", true);
    const cod = getDue(order);
    setCourierBusy(true);
    try {
      const currentUser = getAuthInstance().currentUser;
      if (!currentUser) throw new Error("Please sign in before creating a Steadfast shipment.");
      const idToken = await currentUser.getIdToken();
      const response = await fetch(`${FN_BASE}/steadfast`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          invoice: `3DBEE-${order.id}`, recipient_name: order.customerName || "Customer",
          recipient_phone: phone, recipient_address: address, cod_amount: cod,
          note: order.instructions || ""
        })
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409 && result.duplicate) {
        // Steadfast already has this invoice: link the order to it instead of creating a second parcel
        await update(ref(getDb(), `${DB_ROOT}/orders/${order.id}`), { courierName: "Steadfast", steadfastInvoiceLinked: true, ...(result.delivery_status ? { steadfastStatus: result.delivery_status } : {}), updatedAt: new Date().toISOString() });
        notify(`${result.error} Linked by invoice - add its tracking ID from the Steadfast panel.`, true);
        return;
      }
      if (!response.ok || result.status === 400 || result.status === 401) throw new Error(result.message || result.error || `Steadfast request failed (${response.status})`);
      const consignment = result.consignment || result.data || result;
      const consignmentId = consignment.consignment_id || consignment.id || consignment.tracking_code || "";
      const trackingCode = consignment.tracking_code || consignment.consignment_id || "";
      await update(ref(getDb(), `${DB_ROOT}/orders/${order.id}`), {
        courierName: "Steadfast", ...(consignmentId ? { courierId: String(consignmentId) } : {}),
        ...(trackingCode ? { steadfastTrackingCode: String(trackingCode) } : {}),
        steadfastResponse: result, steadfastCodAmount: cod,
        ...(["Pending", "Processing", "Printing", ""].includes(order.orderStatus || "") ? { orderStatus: "Ready to ship", timeline: [...(Array.isArray(order.timeline) ? order.timeline : []), { status: "Ready to ship", note: "Auto: Steadfast shipment created", at: new Date().toISOString() }] } : {}),
        ...(!order.trackingUrl && /^https?:\/\//i.test(String(consignment.tracking_link || result.tracking_link || "")) ? { trackingUrl: String(consignment.tracking_link || result.tracking_link) } : {}),
        deliveryStatus: "Ready for pickup", steadfastCreatedAt: new Date().toISOString(), steadfastStatus: "in_review", steadfastSyncedAt: new Date().toISOString(), steadfastSyncError: null, updatedAt: new Date().toISOString()
      });
      notify(`Steadfast shipment created${consignmentId ? ` · ID ${consignmentId}` : ""}. COD: ${money(cod)}`);
    } catch (e) { notify("Steadfast error: " + e.message, true); }
    finally { setCourierBusy(false); creatingRef.current.delete(order.id); }
  }

  async function removeOrder(id) {
    if (!confirm("Delete this order? This cannot be undone.")) return;
    try {
      await remove(ref(getDb(), `${DB_ROOT}/orders/${id}`));
      setSelected(null); notify("Order deleted");
    } catch (e) { notify("Delete failed: " + e.message, true); }
  }

  function openEdit(o) {
    const values = { ...EMPTY };
    Object.keys(EMPTY).forEach(k => { if (o[k] !== undefined && o[k] !== null) values[k] = String(o[k]); });
    values.items = itemsOfOrder(o);
    setSelected(null); setModal({ id: o.id, values });
  }

  // CSV (all fields) - kept for full backups
  function exportCsv(list = visible) {
    const keys = [...KNOWN_ORDER, ...[...new Set(orders.flatMap(o => Object.keys(o)))].filter(k => !KNOWN_ORDER.includes(k))];
    const csv = toCsv(keys.map(prettyKey), list.map(o => keys.map(k => k === "items" ? o.bikeNumbers : typeof o[k] === "object" && o[k] !== null ? JSON.stringify(o[k]) : o[k])));
    download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `3d-bee-orders-full-${stamp()}.csv`);
  }
  // readable CSV / real Excel file of the selected orders (or everything that matches the filters)
  function exportRows(fmt) {
    const list = picked.size ? visible.filter(o => picked.has(o.id)) : visible;
    if (!list.length) return notify("Nothing to export", true);
    const head = ORDER_COLUMNS.map(c => c[0]), rows = list.map(o => ORDER_COLUMNS.map(c => c[1](o, serials[o.id])));
    if (fmt === "xlsx") download(toXlsx(head, rows, "Orders"), `3d-bee-orders-${stamp()}.xlsx`);
    else if (fmt === "full") exportCsv(list);
    else download(new Blob([toCsv(head, rows)], { type: "text/csv;charset=utf-8" }), `3d-bee-orders-${stamp()}.csv`);
    setExportOpen(false); notify(`Exported ${list.length} order${list.length > 1 ? "s" : ""}`);
  }
  async function bulkSet(field, value) {
    const ids = [...picked]; if (!ids.length || !value) return;
    if (!confirm(`Set ${prettyKey(field)} to “${value}” for ${ids.length} order${ids.length > 1 ? "s" : ""}?`)) return;
    for (const id of ids) await quick(id, field, value, true);
    notify(`${ids.length} order${ids.length > 1 ? "s" : ""} updated`);
  }
  async function bulkDelete() {
    const ids = [...picked]; if (!ids.length || !confirm(`Delete ${ids.length} order${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    try { for (const id of ids) await remove(ref(getDb(), `${DB_ROOT}/orders/${id}`)); setPicked(new Set()); notify(`${ids.length} deleted`); } catch (e) { notify("Delete failed: " + e.message, true); }
  }
  async function setFollowUp(id, p) {
    try { await update(ref(getDb(), `${DB_ROOT}/orders/${id}`), { ...p, updatedAt: new Date().toISOString() }); notify(p.followUpDone ? "Follow-up marked done" : p.followUpAt ? "Follow-up saved" : "Follow-up removed"); }
    catch (e) { notify("Could not save follow-up: " + e.message, true); }
  }
  async function changeNote(id, op, val) {
    const cur = orders.find(o => o.id === id); const list = Array.isArray(cur?.internalNotes) ? [...cur.internalNotes] : [];
    if (op === "add") list.push({ text: String(val).slice(0, 500), at: new Date().toISOString(), by: user?.email || "" }); else list.splice(val, 1);
    try { await update(ref(getDb(), `${DB_ROOT}/orders/${id}`), { internalNotes: list.length ? list : null, updatedAt: new Date().toISOString() }); }
    catch (e) { notify("Could not save note: " + e.message, true); }
  }
  async function saveCfg(c) {
    try { await set(ref(getDb(), `${DB_ROOT}/settings/monitor`), c); notify("Settings saved"); } catch (e) { notify("Could not save settings: " + e.message, true); }
  }
  const viewState = () => ({ search, statuses, pays, courierF, dateFrom, dateTo, dueOnly, smart, sort });
  async function saveView() {
    const name = (prompt("Name this view (e.g. “COD to collect this week”)") || "").trim().slice(0, 40);
    if (!name) return;
    try { await push(ref(getDb(), `${DB_ROOT}/settings/views`), { name, f: viewState(), createdAt: new Date().toISOString() }); notify(`View “${name}” saved`); } catch (e) { notify("Could not save view: " + e.message, true); }
  }
  function applyView(id) {
    const f = views[id]?.f; if (!f) return;
    setSearch(f.search || ""); setStatuses(f.statuses || []); setPays(f.pays || []); setCourierF(f.courierF || "any"); setDateFrom(f.dateFrom || ""); setDateTo(f.dateTo || ""); setDueOnly(!!f.dueOnly); setSmart(f.smart || "all"); setSort(f.sort || "newest");
  }
  async function deleteView(id) { if (confirm(`Delete view “${views[id]?.name}”?`)) try { await remove(ref(getDb(), `${DB_ROOT}/settings/views/${id}`)); } catch (e) { notify("Could not delete view: " + e.message, true); } }
  function go(v, opts = {}) {
    if (opts.smart) { clearFilters(); setSmart(opts.smart); }
    if (v === "monitor") setMonPreset({ tab: opts.tab, tier: opts.tier, k: Date.now() });
    setView(v);
  }

  const quickSelect = (o, field, list, tone) => <select className={`pillselect ${tone(o[field])}`} value={o[field] || ""}
    onClick={e => e.stopPropagation()} onChange={e => quick(o.id, field, e.target.value)}>
    {o[field] && !list.includes(o[field]) && <option>{o[field]}</option>}
    {!o[field] && <option value="">—</option>}
    {list.map(x => <option key={x}>{x}</option>)}
  </select>;

  const NAV = [["dashboard", "🏠", "Dashboard"], ["orders", "📋", "Orders"], ["monitor", "🛰", "Monitor"], ["courier", "🚚", "Courier"], ["analytics", "📊", "Analytics"], ["settings", "⚙️", "Settings"]];
  const navBadge = k => k === "monitor" ? alerts.filter(a => a.level === "red" || a.level === "orange").length : 0;
  const title = NAV.find(n => n[0] === view)?.[2] || "";
  const allOnPage = pageRows.length > 0 && pageRows.every(o => picked.has(o.id));
  const togglePage = () => setPicked(p => { const n = new Set(p); if (allOnPage) pageRows.forEach(o => n.delete(o.id)); else pageRows.forEach(o => n.add(o.id)); return n; });
  const pick1 = (id, e) => { e.stopPropagation(); setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const miOf = o => monitorInfo(o, cfg, now);

  return <div className="app">
    <aside className="side" aria-label="Main navigation">
      <div className="brand"><div className="logo sm">🐝</div><div><div className="eyebrow">3D BEE</div><strong className="brandname">Order Desk</strong></div></div>
      <nav className="sidenav">{NAV.map(([k, icon, label]) => <button key={k} className={`navitem ${view === k ? "active" : ""}`} onClick={() => go(k)} aria-current={view === k ? "page" : undefined}><span className="ni">{icon}</span><span>{label}</span>{navBadge(k) > 0 && <b className="navbadge">{navBadge(k)}</b>}</button>)}</nav>
      <div className="sidefoot">
        <span className={`live ${online ? "on" : ""}`}><i />{online ? "Live" : "Offline"}</span>
        {REQUIRE_LOGIN && <><small className="who" title={user?.email}>{user?.email}</small><button className="btn ghost sm" onClick={() => signOut(getAuthInstance())}>Sign out</button></>}
      </div>
    </aside>

    <div className="main">
      <header className="topbar">
        <h1>{title}</h1>
        <div className="row wrap topactions">
          <Notifications alerts={alerts} onOpen={id => setSelected(id)} />
          <div className="menuwrap">
            <button className="btn" onClick={() => setExportOpen(o => !o)} disabled={!orders.length} aria-expanded={exportOpen}>⬇ Export ▾</button>
            {exportOpen && <><div className="scrim" onClick={() => setExportOpen(false)} /><div className="menu" role="menu">
              <small>{picked.size ? `${picked.size} selected` : `${visible.length} filtered`} order{(picked.size || visible.length) === 1 ? "" : "s"}</small>
              <button role="menuitem" onClick={() => exportRows("xlsx")}>📗 Excel (.xlsx)</button><button role="menuitem" onClick={() => exportRows("csv")}>📄 CSV (readable)</button><button role="menuitem" onClick={() => exportRows("full")}>🗂 CSV (all fields)</button></div></>}
          </div>
          <button className="btn primary" onClick={() => setModal({ values: EMPTY })}>＋ New order</button>
        </div>
      </header>

      {!online && loaded && <div className="alert offline" role="status">You are offline. Changes will sync when the connection returns.</div>}
    {firebaseError && <div className="alert firebase-alert" role="alert"><strong>Database connection problem:</strong> {firebaseError}<br />Check your Firebase Realtime Database URL, authentication, and database rules. Your existing cloud data has not been deleted.</div>}

      <main className="content" key={view}>
      {view === "dashboard" && <Overview orders={orders} serials={serials} cfg={cfg} now={now} stats={stats} onGo={go} onOpen={id => setSelected(id)}>
    <section className="stats">
      <div className="stat"><span>Total orders</span><strong>{stats.count}</strong></div>
      <div className="stat"><span>Sales / order value</span><strong>{money(stats.value)}</strong></div>
      <div className="stat"><span>Estimated profit</span><strong>{money(stats.profit)}</strong><small>After costs, returns & expenses</small></div>
      <div className="stat warn"><span>Payment due</span><strong>{money(stats.due)}</strong></div>
      <div className="stat"><span>Active orders</span><strong>{stats.active}</strong></div>
      <div className="stat"><span>Order-level costs</span><strong>{money(stats.costs)}</strong></div>
      <div className="stat"><span>Business expenses</span><strong>{money(stats.overhead)}</strong></div>
      <div className="stat"><span>Awaiting delivery</span><strong>{stats.delivery}</strong></div>
      <div className="stat"><span>Return loss</span><strong className={stats.returnLoss > 0 ? "due-highlight" : ""}>{money(stats.returnLoss)}</strong><small>{stats.returned} returned parcels</small></div>
      <div className="stat collectstat"><span>💰 COD to collect</span><strong>{money(stats.toCollect)}</strong><small>{stats.toCollectN} parcel with courier</small></div>
      <div className="stat"><span>✅ COD collected</span><strong>{money(stats.collected)}</strong><small>Steadfast delivered</small></div>
      <div className="stat"><span>With courier now</span><strong>{stats.withCourier}</strong><small>Steadfast on the way</small></div>
    </section>
    <section className="panel expensepanel">
      <div className="expensehead"><div><h2>Business expenses</h2><p>Log filament, electricity, packaging, tools, rent or other overheads. These are deducted from estimated profit.</p></div><strong>{money(stats.overhead)}</strong></div>
      <form className="expenseform" onSubmit={addExpense}>
        <input value={expenseName} onChange={e => setExpenseName(e.target.value)} placeholder="Expense description" required />
        <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)}>{["Materials", "Electricity", "Packaging", "Delivery", "Tools / maintenance", "Rent", "Marketing", "Other"].map(x => <option key={x}>{x}</option>)}</select>
        <input type="number" min="0.01" step="0.01" value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} placeholder="Amount (৳)" required />
        <button className="btn primary">＋ Add expense</button>
      </form>
      {expenses.length > 0 && <div className="expenseitems">{[...expenses].sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0,8).map(x => <div key={x.id}><span><strong>{x.name}</strong><small>{x.category} · {fmtDate(x.createdAt)}</small></span><b>{money(x.amount)}</b><button className="icon" onClick={() => deleteExpense(x.id)} aria-label="Delete expense">✕</button></div>)}</div>}
    </section>
      </Overview>}
      {view === "monitor" && <Monitor key={monPreset?.k || 0} orders={orders} cfg={cfg} serials={serials} now={now} sync={sync} onSync={list => syncCourier(list)} onOpen={id => setSelected(id)} onFollowUp={setFollowUp} preset={monPreset} />}
      {view === "courier" && <Courier orders={orders} sync={sync} onSync={syncCourier} autoSync={autoSync} setAutoSync={setAutoSync} onOpen={id => setSelected(id)} />}
      {view === "analytics" && <Analytics orders={orders} expenses={expenses} />}
      {view === "settings" && <Settings cfg={cfg} onSave={saveCfg} notify={notify} now={now} />}

      {view === "orders" && <section className="panel">
        <div className="toolbar">
          <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎  Search name, bike number, #serial, tracking ID, notes…" aria-label="Search orders" />
          <button className={`btn ${filtersOpen || activeFilters ? "on" : ""}`} onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}>⚙ Filters{activeFilters > 0 && <b className="countdot">{activeFilters}</b>}</button>
          <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest total</option><option value="due">Highest due</option><option value="name">Customer A–Z</option></select>
          <select aria-label="Saved views" value="" onChange={e => { const v = e.target.value; if (v === "__save") saveView(); else if (v.startsWith("__del:")) deleteView(v.slice(6)); else if (v) applyView(v); }}>
            <option value="">⭐ Views</option>{Object.entries(views).map(([id, v]) => <option key={id} value={id}>{v.name}</option>)}
            <option value="__save">＋ Save current view…</option>{Object.entries(views).map(([id, v]) => <option key={"d" + id} value={"__del:" + id}>🗑 Delete “{v.name}”</option>)}</select>
        </div>
        {filtersOpen && <div className="filterpanel">
          <fieldset><legend>Status</legend><div className="chips">{STATUSES.map(x => <button key={x} className={`chip ${statuses.includes(x) ? "active" : ""}`} onClick={() => toggle(statuses, setStatuses, x)}>{x} <b>{statusCounts[x] || 0}</b></button>)}</div></fieldset>
          <fieldset><legend>Payment</legend><div className="chips">{PAYMENTS.map(x => <button key={x} className={`chip ${pays.includes(x) ? "active" : ""}`} onClick={() => toggle(pays, setPays, x)}>{x}</button>)}</div></fieldset>
          <fieldset><legend>Courier & dates</legend><div className="row wrap">
            <select value={courierF} onChange={e => setCourierF(e.target.value)} aria-label="Tracking filter"><option value="any">Any tracking</option><option value="with">Has tracking ID</option><option value="without">No tracking ID</option></select>
            <label className="inl">From <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
            <label className="inl">To <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
            <label className="inl"><input type="checkbox" checked={dueOnly} onChange={e => setDueOnly(e.target.checked)} /> Has due only</label></div></fieldset>
          <div className="row"><button className="btn sm" onClick={clearFilters}>Clear all filters</button></div>
        </div>}
        <div className="chips smartchips">
          <button className={`chip ${smart === "all" ? "active" : ""}`} onClick={() => setSmart("all")}>All orders</button>
          {SMART.map(([k, label]) => <button key={k} className={`chip ${smart === k ? "active" : ""} ${k === "collect" ? "gold" : ""}`} onClick={() => setSmart(smart === k ? "all" : k)}>{label} <b>{smartCounts[k] || 0}</b></button>)}
        </div>

        {picked.size > 0 && <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
          <b>{picked.size} selected</b>
          <select aria-label="Bulk status" value="" onChange={e => { bulkSet("orderStatus", e.target.value); e.target.value = ""; }}><option value="">Set status…</option>{STATUSES.map(x => <option key={x}>{x}</option>)}</select>
          <select aria-label="Bulk payment" value="" onChange={e => { bulkSet("paymentStatus", e.target.value); e.target.value = ""; }}><option value="">Set payment…</option>{PAYMENTS.map(x => <option key={x}>{x}</option>)}</select>
          <button className="btn sm" disabled={sync.busy} onClick={() => syncCourier(orders.filter(o => picked.has(o.id)))}>🔄 Sync courier</button>
          <button className="btn sm" onClick={() => exportRows("xlsx")}>📗 Excel</button><button className="btn sm" onClick={() => exportRows("csv")}>📄 CSV</button>
          <button className="btn sm danger" onClick={bulkDelete}>🗑 Delete</button><button className="btn sm ghost" onClick={() => setPicked(new Set())}>Clear</button>
        </div>}

        {!loaded ? <div className="empty">Loading orders…</div> : !visible.length ?
          <div className="empty">{orders.length ? <>No orders match your filters. <button className="btn sm" onClick={clearFilters}>Clear filters</button></> : <>No orders found at <code>/{DB_ROOT}/orders</code>. Add one or check the database path and rules.</>}</div> : <>
          <div className="tablewrap"><table>
            <thead><tr><th className="chk"><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select all on this page" /></th><th>#</th><th>Customer</th><th>Items</th><th className="colx">Customization</th><th>Bill / Paid / Due</th><th>Payment</th><th>Status</th><th>Courier</th><th className="colx">Created</th><th /></tr></thead>
            <tbody>{pageRows.map(o => { const m = miOf(o); return <tr key={o.id} className={picked.has(o.id) ? "picked" : ""} onClick={() => setSelected(o.id)}>
              <td className="chk" onClick={e => pick1(o.id, e)}><input type="checkbox" checked={picked.has(o.id)} readOnly aria-label={`Select order ${serials[o.id]}`} /></td>
              <td className="nowrap"><span className="serialtag">#{serials[o.id]}</span></td>
              <td><strong>{o.customerName || "—"}</strong>{o.customerDetails && <small className="pre">{o.customerDetails}</small>}<small>{o.orderDate}</small></td>
              <td><ItemChips o={o} /></td>
              <td className="pre colx">{o.instructions}</td>
              <td><BillCell o={o} /></td>
              <td>{quickSelect(o, "paymentStatus", PAYMENTS, payTone)}</td>
              <td>{quickSelect(o, "orderStatus", STATUSES, statusTone)}<CollectTag o={o} /><ChargeTag o={o} /></td>
              <td>{o.courierId}{o.courierId && <small><SfPill o={o} /></small>}<small><TrackLink o={o} cfg={cfg} /></small>{m && m.active && Number.isFinite(m.hours) && <small><span className={`tierbadge ${m.tierMeta.tone}`}>⏱ {fmtDuration(m.hours)}{m.tier ? ` · ${m.tierMeta.label}` : ""}</span></small>}{followUpDue(o, now) && <small><span className="tierbadge blue">📞 Follow up</span></small>}<small>{o.deliveryStatus}</small></td>
              <td className="nowrap colx">{fmtDate(o.createdAt)}</td>
              <td className="nowrap"><button className="btn sm" title="Print sticker" onClick={e => { e.stopPropagation(); printLabel(o, serials[o.id]); }}>🖨️</button> <button className="btn sm" onClick={e => { e.stopPropagation(); openEdit(o); }}>Edit</button></td>
            </tr>; })}</tbody></table></div>

          <div className="cards">{pageRows.map(o => { const m = miOf(o); return <article key={o.id} className={`card ${picked.has(o.id) ? "picked" : ""}`} onClick={() => setSelected(o.id)}>
            <div className="cardtop"><input type="checkbox" checked={picked.has(o.id)} readOnly onClick={e => pick1(o.id, e)} aria-label={`Select order ${serials[o.id]}`} /><span className="serialtag">#{serials[o.id]}</span><strong>{o.customerName || "—"}</strong><small>{o.orderDate}</small></div>
            <ItemChips o={o} />
            <BillCell o={o} />
            {o.customerDetails && <p className="clip">{o.customerDetails}</p>}
            <div className="row wrap"><span className={`pill ${payTone(o.paymentStatus)}`}>{o.paymentStatus || "—"}</span>
              <span className={`pill ${statusTone(o.orderStatus)}`}>{o.orderStatus || "—"}</span>{o.courierId && <><SfPill o={o} /><CollectTag o={o} /><ChargeTag o={o} /></>}
              {m && m.active && Number.isFinite(m.hours) && <span className={`tierbadge ${m.tierMeta.tone}`}>⏱ {fmtDuration(m.hours)}</span>}</div>
            <div className="row wrap"><TrackLink o={o} cfg={cfg} /><button className="btn sm" onClick={e => { e.stopPropagation(); printLabel(o, serials[o.id]); }}>🖨️ Print</button></div>
          </article>; })}</div>

          <div className="pager">
            <span>{(curPage - 1) * pageSize + 1}–{Math.min(curPage * pageSize, visible.length)} of {visible.length}{visible.length !== orders.length ? ` (filtered from ${orders.length})` : ""}</span>
            <div className="row"><button className="btn sm" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} aria-label="Previous page">‹ Prev</button><span>Page {curPage} / {pageCount}</span><button className="btn sm" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)} aria-label="Next page">Next ›</button>
              <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} aria-label="Rows per page">{[25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}</select></div>
          </div></>}
      </section>}
      </main>
      <footer>3D Bee Order Desk · live Firebase sync · times in Asia/Dhaka · {lastSynced ? `Last data update ${lastSynced.toLocaleTimeString("en-GB", { timeZone: TZ })}` : "Waiting for sync"}</footer>
    </div>

    <nav className="bottomnav" aria-label="Sections">{NAV.map(([k, icon, label]) => <button key={k} className={view === k ? "active" : ""} onClick={() => go(k)}><span>{icon}</span><small>{label}</small>{navBadge(k) > 0 && <b className="navbadge">{navBadge(k)}</b>}</button>)}</nav>

    {modal && <OrderModal initial={modal.values} editing={!!modal.id} editingId={modal.id} orders={orders} serials={serials} serialNo={modal.id ? serials[modal.id] : nextSerial} prices={prices} onSavePrices={savePrices} busy={busy} onClose={() => setModal(null)} onSave={save} />}
    {selectedOrder && <Drawer order={selectedOrder} serial={serials[selectedOrder.id]} cfg={cfg} now={now} orders={orders} serials={serials} onOpen={setSelected} onNote={changeNote} onFollowUp={setFollowUp} onClose={() => setSelected(null)} onEdit={openEdit} onDelete={removeOrder} onQuick={quick} onRecordPayment={recordPayment} onDeliveryChargePaid={markDeliveryChargePaid} onCreateCourier={createSteadfastOrder} courierBusy={courierBusy} onSync={o => syncCourier([o])} syncBusy={sync.busy} />}
    {toast && <div className={`toast ${toast.bad ? "bad" : ""}`} role="status">{toast.text}</div>}
  </div>;
}

/* ───────────── Root with auth gate ───────────── */
export default function Home() {
  const [user, setUser] = useState(undefined);
  const [authError, setAuthError] = useState("");
  const configError = getFirebaseConfigError();
  useEffect(() => {
    if (configError) { setAuthError(configError); setUser(null); return undefined; }
    if (!REQUIRE_LOGIN) { setUser(null); return undefined; }
    try {
      return onAuthStateChanged(getAuthInstance(), u => setUser(u), err => {
        setAuthError(err.message || "Firebase Authentication could not start.");
        setUser(null);
      });
    } catch (err) {
      setAuthError(err.message || "Firebase Authentication could not start.");
      setUser(null);
      return undefined;
    }
  }, [configError]);
  if (authError) return <main className="loginwrap"><section className="logincard"><div className="logo">🐝</div><h1>3D Bee setup needed</h1><p className="alert">{authError}</p><p>In Netlify, open <strong>Site configuration → Environment variables</strong>, add the missing values, then choose <strong>Deploys → Trigger deploy → Clear cache and deploy site</strong>.</p></section></main>;
  if (user === undefined) return <div className="boot">Loading…</div>;
  if (REQUIRE_LOGIN && !user) return <Login />;
  return <Desk user={user} />;
}
