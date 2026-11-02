"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { ref, onValue, push, set, update, remove } from "firebase/database";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDb, getAuthInstance, getFirebaseConfigError, DB_ROOT, REQUIRE_LOGIN } from "./lib/firebase";

const STATUSES = ["Pending", "Processing", "Printing", "Ready to ship", "Shipped", "Delivered", "Completed", "Cancelled"];
const PAYMENTS = ["Unpaid", "Pending", "Paid Advance", "Paid Full", "Cash On Delivery"];

const LABELS = {
  customerName: "Customer", bikeNumbers: "Bike number(s)", customerDetails: "Contact / address", deliveryArea: "Delivery area",
  paymentStatus: "Payment", courierId: "Tracking / parcel ID", courierName: "Courier", trackingUrl: "Tracking URL", deliveryStatus: "Delivery", productionCost: "Production cost", deliveryFee: "Delivery fee", otherCost: "Other cost", paidAmount: "Paid amount", instructions: "Customization",
  reference1: "Extra field 1", reference2: "Extra field 2", quantity: "Quantity",
  unitPrice: "Unit price", total: "Total", dueAmount: "Due amount", orderStatus: "Status", orderDate: "Order date",
  createdAt: "Created", updatedAt: "Last updated", id: "Order ID"
};
const KNOWN_ORDER = Object.keys(LABELS);
const MONEY_KEYS = ["unitPrice", "total", "dueAmount", "productionCost", "deliveryFee", "otherCost", "paidAmount"];

const EMPTY = {
  customerName: "", bikeNumbers: "", customerDetails: "", paymentStatus: "Unpaid",
  courierId: "", courierName: "", trackingUrl: "", deliveryStatus: "Not shipped",
  instructions: "", reference1: "", reference2: "", quantity: "1",
  unitPrice: "250", total: "330", deliveryArea: "Inside Dhaka", productionCost: "0", deliveryFee: "80", otherCost: "0",
  paidAmount: "0", orderStatus: "Pending", orderDate: ""
};

const money = n => `৳${Number(n || 0).toLocaleString("en-BD")}`;
const prettyKey = k => LABELS[k] || k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
const fmtDate = v => {
  const d = new Date(v);
  if (!v || isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(String(v))) return v || "—";
  return d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });
};
const statusTone = s => /deliver|complet/i.test(s) ? "green" : /cancel/i.test(s) ? "red" : /ship|ready/i.test(s) ? "violet" : /process|print/i.test(s) ? "blue" : "amber";
const payTone = s => /^unpaid/i.test(s) ? "red" : /^paid/i.test(s) ? "green" : /cash/i.test(s) ? "blue" : "amber";
const isPaid = s => /^paid/i.test(s || "");
const orderDue = o => Math.max(0, Number(o.total || 0) - (o.paidAmount !== undefined && o.paidAmount !== null && o.paidAmount !== "" ? Number(o.paidAmount) : (isPaid(o.paymentStatus) ? Number(o.total || 0) : 0)));
const isDone = s => /deliver|complet|cancel/i.test(s || "");
const display = (k, v) => v === undefined || v === null || v === "" ? "—" : MONEY_KEYS.includes(k) ? money(v) : ["createdAt", "updatedAt"].includes(k) ? fmtDate(v) : typeof v === "object" ? JSON.stringify(v) : String(v);
const safeTrackingUrl = value => {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
};

/* ───────────── Login ───────────── */
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
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

/* ───────────── Order form (modal) ───────────── */
function OrderModal({ initial, editing, onClose, onSave, busy }) {
  const [form, setForm] = useState(() => ({
    ...initial,
    orderDate: initial.orderDate || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }),
    quantity: initial.quantity || "1",
    unitPrice: initial.unitPrice || "250",
    total: initial.total || String((Number(initial.quantity || 1) || 1) * (Number(initial.unitPrice || 250) || 0)),
    deliveryArea: initial.deliveryArea || (Number(initial.deliveryFee || 0) === 130 ? "Outside Dhaka" : Number(initial.deliveryFee || 0) === 80 ? "Inside Dhaka" : "No delivery"),
    deliveryFee: initial.deliveryFee ?? "80",
    paymentStatus: initial.paymentStatus || "Unpaid",
    orderStatus: initial.orderStatus || "Pending"
  }));
  const [showMore, setShowMore] = useState(false);
  function change(e) {
    const { name, value } = e.target;
    const next = { ...form, [name]: value };
    if (name === "quantity" || name === "unitPrice") next.total = String((Number(next.quantity) || 0) * (Number(next.unitPrice) || 0) + Number(next.deliveryFee || 0));
    if (name === "deliveryArea") {
      next.deliveryFee = value === "Inside Dhaka" ? "80" : value === "Outside Dhaka" ? "130" : "0";
      next.total = String((Number(next.quantity) || 0) * (Number(next.unitPrice) || 0) + Number(next.deliveryFee || 0));
    }
    if (name === "paymentStatus") {
      if (/^paid full$/i.test(value)) {
        next.paidAmount = String((Number(next.quantity) || 0) * (Number(next.unitPrice) || 0) + Number(next.deliveryFee || 0));
      } else if (/^unpaid$/i.test(value)) {
        next.paidAmount = "0";
      }
    }
    setForm(next);
  }
  const f = (name, props = {}) => ({ name, value: form[name] ?? "", onChange: change, ...props });
  const itemSubtotal = (Number(form.quantity) || 0) * (Number(form.unitPrice) || 0);
  const total = itemSubtotal + Number(form.deliveryFee || 0);
  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <form className="modal ordermodal" onSubmit={e => { e.preventDefault(); onSave(form); }}>
      <div className="modalhead">
        <div><h2>{editing ? "Edit order" : "New order"}</h2><p>{editing ? "Update the order details." : "Add the essentials now. You can fill in the rest later."}</p></div>
        <button type="button" className="icon" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="grid ordergrid">
        <label>Customer name *<input {...f("customerName", { required: true, autoFocus: true, placeholder: "Customer name" })} /></label>
        <label>Phone / address<textarea {...f("customerDetails", { rows: 2, placeholder: "Phone number and delivery address" })} /></label>
        <label>Tracking / parcel ID<input {...f("courierId", { placeholder: "Tracking ID" })} /></label>
        <label className="wide">Item / order details<input {...f("bikeNumbers", { placeholder: "e.g. Custom keychain, lithophane, model…" })} /></label>
        <label className="wide note-field">Customization notes<textarea {...f("instructions", { rows: 3, placeholder: "✍️ Add important notes: color, size, text, design, customer requests…" })} /></label>
        <label>Quantity<input {...f("quantity", { type: "number", min: 1, required: true })} /></label>
        <label>Price per item (৳)<input {...f("unitPrice", { type: "number", min: 0, required: true })} /></label>
        <label>Items total (৳)<input value={money(itemSubtotal)} readOnly /></label>
        <label>Delivery area<select {...f("deliveryArea")}><option>Inside Dhaka</option><option>Outside Dhaka</option><option>No delivery</option></select></label>
        <label>Delivery cost (৳)<input value={money(form.deliveryFee)} readOnly /></label>
        <label>Total incl. delivery (৳)<input value={money(total)} readOnly /></label>
        <label>Amount paid (৳)<input {...f("paidAmount", { type: "number", min: 0, step: "0.01" })} /></label>
        <label>Due amount (৳)<input value={money(Math.max(0, total - Number(form.paidAmount || 0)))} readOnly /></label>
        <label>Payment<select {...f("paymentStatus")}>{PAYMENTS.map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Order status<select {...f("orderStatus")}>{STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Order date<input {...f("orderDate", { type: "date" })} /></label>
      </div>
      <button type="button" className="more-toggle" onClick={() => setShowMore(v => !v)}>
        <span>{showMore ? "−" : "+"} More details</span><small>Courier, tracking link, delivery & costs</small>
      </button>
      {showMore && <div className="grid ordergrid moregrid">
        <label>Production cost (৳)<input {...f("productionCost", { type: "number", min: 0 })} /></label>
        <label>Other cost (৳)<input {...f("otherCost", { type: "number", min: 0 })} /></label>
        <label>Courier<input {...f("courierName", { placeholder: "Pathao, Steadfast…" })} /></label>
        <label className="wide">Tracking URL<input {...f("trackingUrl", { type: "url", placeholder: "https://…" })} /></label>
        <label>Delivery status<select {...f("deliveryStatus")}>{["Not shipped", "Ready for pickup", "Picked up", "In transit", "Out for delivery", "Delivered", "Delivery failed", "Returned"].map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Extra field 1<input {...f("reference1")} /></label>
        <label>Extra field 2<input {...f("reference2")} /></label>
      </div>}
      <div className="modalfoot orderfoot">
        <span className="hint">Total including delivery <strong>{money(total)}</strong></span>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "＋ Add order"}</button>
        </div>
      </div>
    </form>
  </div>;
}

/* ───────────── Detail drawer: shows EVERY field ───────────── */
function Drawer({ order, onClose, onEdit, onDelete, onQuick }) {
  const keys = [...KNOWN_ORDER.filter(k => k === "id" || k in order), ...Object.keys(order).filter(k => !KNOWN_ORDER.includes(k)).sort()];
  return <div className="overlay right" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <aside className="drawer">
      <div className="modalhead">
        <div><h2>{order.customerName || "Unnamed order"}</h2><p>{fmtDate(order.createdAt || order.orderDate)}</p></div>
        <button className="icon" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="drawertags">
        <span className={`pill ${statusTone(order.orderStatus)}`}>{order.orderStatus || "—"}</span>
        <span className={`pill ${payTone(order.paymentStatus)}`}>{order.paymentStatus || "—"}</span>
        <strong className="big">{money(orderDue(order))} due</strong>
      </div>
      <div className="quick">
        <label>Status<select value={order.orderStatus || ""} onChange={e => onQuick(order.id, "orderStatus", e.target.value)}>
          {!STATUSES.includes(order.orderStatus) && order.orderStatus && <option>{order.orderStatus}</option>}{STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Payment<select value={order.paymentStatus || ""} onChange={e => onQuick(order.id, "paymentStatus", e.target.value)}>
          {!PAYMENTS.includes(order.paymentStatus) && order.paymentStatus && <option>{order.paymentStatus}</option>}{PAYMENTS.map(x => <option key={x}>{x}</option>)}</select></label>
      </div>
      {safeTrackingUrl(order.trackingUrl) && <a className="btn" href={safeTrackingUrl(order.trackingUrl)} target="_blank" rel="noopener noreferrer">Track parcel ↗</a>}
      {order.instructions && <section className="drawer-note"><strong>✍️ Important customization note</strong><p>{order.instructions}</p></section>}
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
function Dashboard({ user }) {
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [expenseName, setExpenseName] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Materials");
  const [lastSynced, setLastSynced] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(false);
  const [firebaseError, setFirebaseError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [payFilter, setPayFilter] = useState("All");
  const [sort, setSort] = useState("newest");
  const [modal, setModal] = useState(null);   // null | { id?, values }
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState("system");
  const searchRef = useRef(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("3dbee-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* Keep the system theme when browser storage is unavailable. */ }
  }, []);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    if (theme !== "system") {
      try { window.localStorage.setItem("3dbee-theme", theme); } catch { /* Theme still applies for this session. */ }
    }
  }, [theme]);

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
    const offConn = onValue(ref(db, ".info/connected"), s => setOnline(!!s.val()));
    return () => { offOrders(); offExpenses(); offConn(); };
  }, [notify]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === "Escape") { setModal(null); setSelected(null); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedOrder = selected && orders.find(o => o.id === selected);

  const stats = useMemo(() => {
    const live = orders.filter(o => !/cancel/i.test(o.orderStatus || ""));
    return {
      count: orders.length,
      value: live.reduce((s, o) => s + Number(o.total || 0), 0),
      due: live.reduce((s, o) => s + orderDue(o), 0),
      costs: live.reduce((s, o) => s + Number(o.productionCost || 0) + Number(o.deliveryFee || 0) + Number(o.otherCost || 0), 0),
      overhead: expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
      profit: live.reduce((s, o) => s + Number(o.total || 0) - Number(o.productionCost || 0) - Number(o.deliveryFee || 0) - Number(o.otherCost || 0), 0) - expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
      active: orders.filter(o => !isDone(o.orderStatus)).length,
      delivery: live.filter(o => !/delivered/i.test(o.deliveryStatus || "") && !/cancel/i.test(o.orderStatus || "")).length,
      collected: live.reduce((s, o) => s + Math.min(Number(o.total || 0), Math.max(0, Number(o.total || 0) - orderDue(o))), 0),
      average: live.length ? live.reduce((s, o) => s + Number(o.total || 0), 0) / live.length : 0,
      overdue: live.filter(o => orderDue(o) > 0 && o.orderDate && (Date.now() - new Date(o.orderDate).getTime()) > 7 * 86400000).length
    };
  }, [orders, expenses]);

  const statusCounts = useMemo(() => {
    const c = { All: orders.length };
    orders.forEach(o => { const s = o.orderStatus || "—"; c[s] = (c[s] || 0) + 1; });
    return c;
  }, [orders]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = orders.filter(o =>
      (statusFilter === "All" || (o.orderStatus || "—") === statusFilter) &&
      (payFilter === "All" || o.paymentStatus === payFilter) &&
      (!q || Object.values(o).join(" ").toLowerCase().includes(q)));
    const key = o => String(o.createdAt || o.id);
    const sorters = {
      newest: (a, b) => key(b).localeCompare(key(a)),
      oldest: (a, b) => key(a).localeCompare(key(b)),
      highest: (a, b) => Number(b.total || 0) - Number(a.total || 0),
      name: (a, b) => String(a.customerName || "").localeCompare(String(b.customerName || ""))
    };
    return list.sort(sorters[sort]);
  }, [orders, search, statusFilter, payFilter, sort]);

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

  async function quick(id, field, value) {
    try {
      const now = new Date().toISOString();
      const current = orders.find(o => o.id === id);
      const patch = { [field]: value, updatedAt: now };
      if (field === "paymentStatus") {
        const paid = /^paid full$/i.test(value) ? Number(current?.total || 0)
          : /^unpaid$/i.test(value) ? 0 : Number(current?.paidAmount || 0);
        patch.paidAmount = paid;
        patch.dueAmount = Math.max(0, Number(current?.total || 0) - paid);
      }
      if (field === "orderStatus" && current?.orderStatus !== value) {
        const timeline = Array.isArray(current?.timeline) ? current.timeline : [];
        patch.timeline = [...timeline, { status: value, note: "Order status changed", at: now }];
      }
      await update(ref(getDb(), `${DB_ROOT}/orders/${id}`), patch);
      notify(`${prettyKey(field)} updated to “${value}”`);
    } catch (e) { notify("Update failed: " + e.message, true); }
  }

  async function save(form) {
    setBusy(true);
    const qty = Number(form.quantity || 0), price = Number(form.unitPrice || 0);
    const deliveryFee = Number(form.deliveryFee || 0);
    const receivedInput = Number(form.paidAmount || 0);
    const costValues = [form.productionCost, form.otherCost].map(v => Number(v || 0));
    if (!Number.isInteger(qty) || qty < 1 || ![price, deliveryFee, receivedInput, ...costValues].every(v => Number.isFinite(v) && v >= 0)) {
      notify("Check quantity and amounts. They must be valid non-negative numbers.", true);
      setBusy(false);
      return;
    }
    const calculatedTotal = qty * price + deliveryFee;
    const receivedAmount = /^paid full$/i.test(form.paymentStatus || "") ? calculatedTotal : receivedInput;
    const payload = {
      ...form, quantity: qty, unitPrice: price,
      total: calculatedTotal,
      itemsSubtotal: qty * price,
      productionCost: Number(form.productionCost || 0), deliveryFee: Number(form.deliveryFee || 0),
      otherCost: Number(form.otherCost || 0), paidAmount: receivedAmount,
      dueAmount: Math.max(0, calculatedTotal - receivedAmount),
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
          ...payload,
          orderDate: form.orderDate || new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" }),
          createdAt: new Date().toISOString(),
          timeline: [{ status: form.orderStatus || "Pending", note: "Order created", at: new Date().toISOString() }]
        });
        notify("Order saved");
      }
      setModal(null);
    } catch (e) { notify("Could not save: " + e.message, true); }
    finally { setBusy(false); }
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
    setSelected(null); setModal({ id: o.id, values });
  }

  function exportCsv() {
    const keys = [...KNOWN_ORDER, ...[...new Set(orders.flatMap(o => Object.keys(o)))].filter(k => !KNOWN_ORDER.includes(k))];
    const esc = v => {
      const value = String(v ?? "");
      // Prefix formula-like values so exported CSVs are safer to open in spreadsheets.
      const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [keys.map(prettyKey).map(esc).join(","), ...visible.map(o => keys.map(k => esc(o[k])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `3d-bee-orders-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); URL.revokeObjectURL(url);
  }

  const quickSelect = (o, field, list, tone) => <select className={`pillselect ${tone(o[field])}`} value={o[field] || ""}
    onClick={e => e.stopPropagation()} onChange={e => quick(o.id, field, e.target.value)}>
    {o[field] && !list.includes(o[field]) && <option>{o[field]}</option>}
    {!o[field] && <option value="">—</option>}
    {list.map(x => <option key={x}>{x}</option>)}
  </select>;

  return <div className="shell">
    <header className="top">
      <div className="brand"><div className="logo sm">🐝</div>
        <div><div className="eyebrow">3D BEE</div><h1>Order Desk</h1></div></div>
      <div className="row wrap">
        <span className={`live ${online ? "on" : ""}`}><i />{online ? "Live" : "Offline"}</span>
        <button className="btn" onClick={() => setTheme(current => current === "dark" ? "light" : "dark")} aria-label="Toggle color theme" title="Toggle light / dark theme">{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
        <button className="btn" onClick={exportCsv} disabled={!orders.length}>⬇ Export CSV</button>
        <button className="btn primary" onClick={() => setModal({ values: EMPTY })}>＋ New order</button>
        {REQUIRE_LOGIN && <button className="btn ghost" onClick={() => signOut(getAuthInstance())} title={user?.email}>Sign out</button>}
      </div>
    </header>

    {firebaseError && <div className="alert firebase-alert" role="alert"><strong>Database connection problem:</strong> {firebaseError}<br />Check your Firebase Realtime Database URL, authentication, and database rules. Your existing cloud data has not been deleted.</div>}

    <section className="stats">
      <div className="stat"><span>Total orders</span><strong>{stats.count}</strong></div>
      <div className="stat"><span>Collected payments</span><strong>{money(stats.collected)}</strong><small>Money received</small></div>
      <div className="stat"><span>Estimated profit</span><strong>{money(stats.profit)}</strong><small>After recorded costs</small></div>
      <div className="stat warn"><span>Payment due</span><strong>{money(stats.due)}</strong></div>
      <div className="stat"><span>Active orders</span><strong>{stats.active}</strong></div>
      <div className="stat"><span>Average order value</span><strong>{money(stats.average)}</strong><small>Per non-cancelled order</small></div>\n      <div className="stat"><span>Over 7 days with due</span><strong>{stats.overdue}</strong><small>Follow-up recommended</small></div>
      <div className="stat"><span>Order-level costs</span><strong>{money(stats.costs)}</strong></div>
      <div className="stat"><span>Business expenses</span><strong>{money(stats.overhead)}</strong></div>
      <div className="stat"><span>Awaiting delivery</span><strong>{stats.delivery}</strong></div>
    </section>

    <section className="business-strip">
      <div><span className="business-mark">🐝</span><div><strong>3D Bee · Custom 3D Printing</strong><small>Old Dhaka, Bangladesh · Personalized gifts · Prototypes · Educational & architectural models</small></div></div>
      <div className="business-meta"><span>📦 {stats.count} orders</span><span>💰 {money(stats.due)} outstanding</span><span>🚚 {stats.delivery} awaiting delivery</span></div>
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

    <section className="panel">
      <div className="toolbar">
        <input ref={searchRef} className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎  Search any field — name, bike, phone, courier, notes…" aria-label="Search orders" />
        <select value={payFilter} onChange={e => setPayFilter(e.target.value)} aria-label="Payment filter">
          <option value="All">All payments</option>{PAYMENTS.map(p => <option key={p}>{p}</option>)}</select>
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          <option value="highest">Highest total</option><option value="name">Customer A–Z</option></select>
      </div>
      <div className="chips">
        {["All", ...Object.keys(statusCounts).filter(k => k !== "All")].map(s =>
          <button key={s} className={`chip ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>{s} <b>{statusCounts[s] || 0}</b></button>)}
      </div>

      {!loaded ? <div className="empty">Loading orders…</div> : !visible.length ?
        <div className="empty">{orders.length ? "No orders match your filters." : <>No orders found at <code>/{DB_ROOT}/orders</code>. Add one or check the database path and rules.</>}</div> : <>
        <div className="tablewrap"><table>
          <thead><tr><th>Customer</th><th>Bike no.</th><th>Contact / address</th><th>Customization</th><th>Qty</th><th>Total</th><th>Payment</th><th>Status</th><th>Courier</th><th>Extra 1</th><th>Extra 2</th><th>Created</th><th>Updated</th><th /></tr></thead>
          <tbody>{visible.map(o => <tr key={o.id} onClick={() => setSelected(o.id)}>
            <td><strong>{o.customerName || "—"}</strong><small>{o.orderDate}</small></td>
            <td className="pre">{o.bikeNumbers}</td>
            <td className="pre">{o.customerDetails}</td>
            <td className="pre">{o.instructions}</td>
            <td>{o.quantity}</td>
            <td><strong className="due-cell">{money(orderDue(o))} due</strong><small>Bill {money(o.total)}</small></td>
            <td>{quickSelect(o, "paymentStatus", PAYMENTS, payTone)}</td>
            <td>{quickSelect(o, "orderStatus", STATUSES, statusTone)}</td>
            <td>{o.courierId}{safeTrackingUrl(o.trackingUrl) && <small><a href={safeTrackingUrl(o.trackingUrl)} target="_blank" rel="noopener noreferrer">Track parcel ↗</a></small>}<small>{o.deliveryStatus}</small></td><td className="pre">{o.reference1}</td><td className="pre">{o.reference2}</td>
            <td className="nowrap">{fmtDate(o.createdAt)}</td><td className="nowrap">{fmtDate(o.updatedAt)}</td>
            <td><button className="btn sm" onClick={e => { e.stopPropagation(); openEdit(o); }}>Edit</button></td>
          </tr>)}</tbody></table></div>

        <div className="cards">{visible.map(o => <article key={o.id} className="card" onClick={() => setSelected(o.id)}>
          <div className="cardtop"><strong>{o.customerName || "—"}</strong><b className="due-cell">{money(orderDue(o))} due</b></div>
          <p>{o.bikeNumbers || "No bike number"} · Qty {o.quantity ?? "—"}</p>
          <p className="clip">{o.customerDetails}</p>{o.instructions && <div className="card-note"><strong>✍️ Important note</strong><p>{o.instructions}</p></div>}
          {safeTrackingUrl(o.trackingUrl) && <a href={safeTrackingUrl(o.trackingUrl)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>Track delivery ↗</a>}
          <div className="row wrap"><span className={`pill ${payTone(o.paymentStatus)}`}>{o.paymentStatus || "—"}</span>
            <span className={`pill ${statusTone(o.orderStatus)}`}>{o.orderStatus || "—"}</span></div>
        </article>)}</div></>}
    </section>
    <footer>3D Bee Order Desk · live Firebase sync · {visible.length} of {orders.length} orders shown · {lastSynced ? `Last sync ${lastSynced.toLocaleTimeString()}` : "Waiting for sync"}</footer>

    {modal && <OrderModal initial={modal.values} editing={!!modal.id} busy={busy} onClose={() => setModal(null)} onSave={save} />}
    {selectedOrder && <Drawer order={selectedOrder} onClose={() => setSelected(null)} onEdit={openEdit} onDelete={removeOrder} onQuick={quick} />}
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
  return <Dashboard user={user} />;
}
