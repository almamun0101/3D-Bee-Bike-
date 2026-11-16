import { getDue, money, shortDate, num } from "./shared.js";

// ── Thermal sticker size (mm). Change here if your roll is different. ──
export const SIZES = ["40x30", "50x30", "50x25", "40x25", "30x20"];
export const getSizeKey = () => { try { const v = localStorage.getItem("bee_label_size"); return SIZES.includes(v) ? v : "40x30"; } catch { return "40x30"; } };
export const setSizeKey = v => { try { localStorage.setItem("bee_label_size", v); } catch {} };
export const getSize = () => getSizeKey().split("x").map(Number);

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// parcel tracking id only (no serial fallback) - a sticker is never printed without it
export const trackingOf = o => String(o?.courierId || o?.steadfastTrackingCode || "").trim();
const NO_TRACKING = "Tracking ID nai! Age order-e Tracking / parcel ID boshao, tarpor print koro.";

// Opens the browser print dialog with the same label image that Bluetooth sends.
export function browserPrint(o, serial) {
  const tid = trackingOf(o);
  if (!tid) return toast(NO_TRACKING, true);
  const img = drawLabel(o, serial), cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height; cv.getContext("2d").putImageData(img, 0, 0);
  const wmm = img.width / DPI_DOTS_PER_MM, hmm = img.height / DPI_DOTS_PER_MM;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Label ${esc(tid)}</title><style>
@page{size:${wmm}mm ${hmm}mm;margin:0}*{margin:0;padding:0}html,body{width:${wmm}mm;height:${hmm}mm;background:#fff}
img{display:block;width:${wmm}mm;height:${hmm}mm;image-rendering:pixelated;page-break-after:avoid}
</style></head><body><img src="${cv.toDataURL("image/png")}"></body></html>`;

  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const w = f.contentWindow;
  w.document.open(); w.document.write(html); w.document.close();
  const go = () => { try { w.focus(); w.print(); } finally { setTimeout(() => f.remove(), 2000); } };
  setTimeout(go, 250);
}


// ───────────── Bluetooth thermal printing (Web Bluetooth: Chrome on Android / desktop; not iOS Safari) ─────────────
const DPI_DOTS_PER_MM = 8; // 200 dpi label printers
const MAX_DOTS = 384; // JP-PT265 printable width (48mm)
export const PRINTER_MODES = { tspl: "Label printer (TSPL)", escpos: "Receipt printer (ESC/POS)" };
export const getMode = () => { try { return localStorage.getItem("bee_printer_mode") || "tspl"; } catch { return "tspl"; } };
export const setMode = m => { try { localStorage.setItem("bee_printer_mode", m); } catch {} };

// common BLE serial-over-GATT services used by cheap thermal / label printers
const SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", "0000ff00-0000-1000-8000-00805f9b34fb", "0000fff0-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb", "0000fee7-0000-1000-8000-00805f9b34fb", "0000ae30-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "0000180a-0000-1000-8000-00805f9b34fb",
  "00001800-0000-1000-8000-00805f9b34fb", "0000fe59-0000-1000-8000-00805f9b34fb"
];

let conn = { device: null, char: null };

function toast(msg, err) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("bee-print-toast");
  if (!el) { el = document.createElement("div"); el.id = "bee-print-toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.cssText = `position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;max-width:90vw;padding:11px 16px;border-radius:12px;font:600 13px system-ui,sans-serif;color:#fff;background:${err ? "#c0392b" : "#17171a"};box-shadow:0 6px 24px #0004;text-align:center`;
  clearTimeout(el._t); el._t = setTimeout(() => el.remove(), err ? 6000 : 2800);
}

// ── Code 128 barcode (Code C for even digit-only ids, otherwise Code B) ──
const C128 = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
export function code128Bits(text) {
  const t = String(text);
  const codes = [];
  if (/^\d{4,}$/.test(t)) {                       // numeric id: two digits per symbol (Code C), odd last digit via Code B
    codes.push(105);
    for (let i = 0; i + 1 < t.length; i += 2) codes.push(Number(t.slice(i, i + 2)));
    if (t.length % 2) codes.push(100, t.charCodeAt(t.length - 1) - 32);
  } else { codes.push(104); for (const ch of t) { const c = ch.charCodeAt(0); codes.push(c >= 32 && c <= 126 ? c - 32 : 0); } }
  let sum = codes[0]; for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  let bits = "", bar = true;
  for (const c of codes) { for (const w of C128[c]) { bits += (bar ? "1" : "0").repeat(Number(w)); bar = !bar; } bar = true; }
  return bits;
}

// draw the label on a canvas at printer resolution.
// Hero = barcode + tracking number (framed, as big as the sticker allows); name / items / due / phone are small lines above it.
function renderLabel(o, serial, scale = 1) {
  const [LW, LH] = getSize();
  const PX_W = Math.min(MAX_DOTS, Math.floor(LW * DPI_DOTS_PER_MM / 8) * 8), PX_H = LH * DPI_DOTS_PER_MM;
  const tid = trackingOf(o);
  const total = Number(o?.total || 0), due = getDue(o);
  const tk = n => "Tk " + Number(n).toLocaleString("en-US");
  const c = document.createElement("canvas"); c.width = PX_W * scale; c.height = PX_H * scale;
  const g = c.getContext("2d"); g.scale(scale, scale);
  g.fillStyle = "#fff"; g.fillRect(0, 0, PX_W, PX_H); g.fillStyle = "#000"; g.strokeStyle = "#000"; g.textBaseline = "top";
  const F = '"Noto Sans Bengali","Segoe UI",Arial,sans-serif';
  const pad = 10, W = PX_W - pad * 2;
  const fit = (txt, maxW, px, weight = 700, min = 12) => { let sz = px; g.font = `${weight} ${sz}px ${F}`; while (g.measureText(txt).width > maxW && sz > min) { sz -= 1; g.font = `${weight} ${sz}px ${F}`; } return sz; };
  // text that always fits: shrinks first, then cuts with "…" instead of running off the sticker
  const text = (txt, x, y, px, { w = W, weight = 700, align = "left" } = {}) => {
    fit(txt, w, px, weight); let t = String(txt);
    if (g.measureText(t).width > w) { while (t.length > 1 && g.measureText(t + "…").width > w) t = t.slice(0, -1); t += "…"; }
    g.textAlign = align; g.fillText(t, x, y);
  };
  const tall = PX_H >= 240, mid = PX_H >= 200;

  // ── compact info (small) ──
  // short wording for the sticker: plate · Scooter · Back · Custom ×2  (Bike / Front / BRTA are the defaults and stay unwritten)
  const short = i => [i.name, i.vehicle === "Scooter" ? "Scooter" : "", i.side === "Back Side" ? "Back" : "Front", i.type === "Custom" ? "Custom" : ""].filter(Boolean).join(" · ") + (num(i.qty) > 1 ? ` ×${num(i.qty)}` : "");
  const list = Array.isArray(o?.items) ? o.items.filter(i => i?.name) : [];
  const items = list.length > 1 ? `${list.length} plates: ${list.map(i => i.name).join(", ")}` : list.length ? short(list[0]) : String(o?.bikeNumbers || "");
  const phone = String(o?.courierRecipientPhone || "").trim();
  let y = 6;
  const nameSz = tall ? 24 : 21;
  text(String(o?.customerName || "—"), pad, y, nameSz, { w: serial ? W * 0.8 : W });
  if (serial) text(`#${serial}`, PX_W - pad, y + 3, 17, { w: W * 0.18, align: "right" });
  y += nameSz + 5;
  if (items && mid) { text(items, pad, y, 17, { weight: 600 }); y += 21; }
  const dueTxt = due > 0 ? `DUE ${tk(due)}` : "PAID";
  text(dueTxt, pad, y, 22, { w: phone && tall ? W * 0.52 : W, weight: 900 });
  if (phone && tall) text(phone, PX_W - pad, y + 5, 17, { w: W * 0.46, align: "right", weight: 600 });
  y += 27;

  // ── hero block: barcode + tracking number, in a frame ──
  const top = y + 2, blockH = PX_H - top - 5, fx = 4, fw = PX_W - 8, inner = 8;
  g.lineWidth = 3; const r = 10;
  g.beginPath(); if (g.roundRect) g.roundRect(fx + 1.5, top + 1.5, fw - 3, blockH - 3, r); else g.rect(fx + 1.5, top + 1.5, fw - 3, blockH - 3); g.stroke();
  const room = blockH - inner * 2 - 4, barH = Math.max(18, Math.round(room * 0.5)), pillH = room - barH;
  const ax = fx + inner + 4, aw = fw - (inner + 4) * 2;               // area inside the frame
  const bits = code128Bits(tid), mod = Math.max(1, Math.floor(aw / (bits.length + 20)));   // widest bars that still leave a 10-module quiet zone
  const bx = Math.round(ax + (aw - bits.length * mod) / 2), by = top + inner;
  for (let i = 0; i < bits.length;) { if (bits[i] === "1") { let j = i; while (bits[j] === "1") j++; g.fillRect(bx + i * mod, by, (j - i) * mod, barH); i = j; } else i++; }
  const py = by + barH + 4;
  g.beginPath(); if (g.roundRect) g.roundRect(ax, py, aw, pillH, Math.min(10, pillH / 2)); else g.rect(ax, py, aw, pillH); g.fill();
  g.fillStyle = "#fff"; g.textBaseline = "middle"; g.textAlign = "center";
  const sp = "letterSpacing" in g ? 2 : 0;
  fit(tid, aw - 20 - tid.length * sp, Math.max(14, Math.round(pillH * 0.9)), 900, 12);
  if (sp) g.letterSpacing = `${sp}px`;
  g.fillText(tid, PX_W / 2 + sp / 2, py + pillH / 2 + 1);
  if (sp) g.letterSpacing = "0px";
  g.fillStyle = "#000";
  return c;
}
function drawLabel(o, serial) { const c = renderLabel(o, serial, 1); return c.getContext("2d").getImageData(0, 0, c.width, c.height); }

// 1-bit packing; black=1 for ESC/POS, black=0 for TSPL
function pack(img, blackIsOne) {
  const PX_W = img.width, PX_H = img.height;
  const bpr = PX_W / 8, out = new Uint8Array(bpr * PX_H);
  for (let y = 0; y < PX_H; y++) for (let x = 0; x < PX_W; x++) {
    const i = (y * PX_W + x) * 4, lum = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11;
    const black = lum < 160;
    if (black === blackIsOne) out[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return out;
}

const enc = s => new TextEncoder().encode(s);
const cat = (...a) => { const n = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { n.set(x, p); p += x.length; } return n; };

function buildJob(img, mode) {
  const PX_W = img.width, PX_H = img.height, [LABEL_W, LABEL_H] = getSize();
  if (mode === "escpos") {
    const bpr = PX_W / 8;
    return cat(Uint8Array.of(0x1b, 0x40), Uint8Array.of(0x1d, 0x76, 0x30, 0, bpr & 255, bpr >> 8, PX_H & 255, PX_H >> 8), pack(img, true), Uint8Array.of(0x0a, 0x0a));
  }
  return cat(enc(`SIZE ${LABEL_W} mm,${LABEL_H} mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,${PX_W / 8},${PX_H},0,`), pack(img, false), enc("\r\nPRINT 1,1\r\n"));
}

async function connect(forcePick) {
  if (!forcePick && conn.char && conn.device?.gatt?.connected) return conn.char;
  if (!forcePick && conn.device) { // reconnect to the same printer without asking again
    try { conn.char = await findChar(await conn.device.gatt.connect()); return conn.char; } catch { conn = { device: null, char: null }; }
  }
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  device.addEventListener("gattserverdisconnected", () => { conn.char = null; });
  toast(`Connecting to ${device.name || "printer"}…`);
  const char = await findChar(await device.gatt.connect());
  conn = { device, char };
  return char;
}

async function findChar(server) {
  const services = await server.getPrimaryServices();
  let best = null;
  for (const sv of services) {
    let chars = []; try { chars = await sv.getCharacteristics(); } catch {}
    for (const ch of chars) {
      const p = ch.properties;
      if (p.writeWithoutResponse || p.write) { if (!best || (p.writeWithoutResponse && !best.properties.writeWithoutResponse)) best = ch; }
    }
  }
  if (!best) throw new Error("No writable printer channel found on this device");
  return best;
}

async function send(ch, data, chunk) {
  for (let i = 0; i < data.length; i += chunk) {
    const part = data.slice(i, i + chunk);
    if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(part); else await ch.writeValue(part);
    if ((i / chunk) % 8 === 7) await new Promise(r => setTimeout(r, 15));
  }
}

// Tap print → pick / reuse Bluetooth printer → send the label. Falls back to the browser print dialog if Bluetooth is not available.
export async function printLabel(o, serial) {
  if (!trackingOf(o)) return toast(NO_TRACKING, true);
  if (typeof navigator === "undefined" || !navigator.bluetooth) {
    toast("Bluetooth printing needs Chrome on Android. Opening normal print…", true);
    return browserPrint(o, serial);
  }
  try {
    const job = buildJob(drawLabel(o, serial), getMode());
    let ch = await connect(false);
    try { await send(ch, job, 100); } catch { ch = await connect(false); await send(ch, job, 20); }
    toast("Sent to printer ✓");
  } catch (e) {
    if (e?.name === "NotFoundError") return toast("No printer selected", true); // user closed the picker
    conn = { device: null, char: null };
    toast(`Print failed: ${e?.message || e}`, true);
  }
}

// choose a different printer next time
export async function changePrinter() { conn = { device: null, char: null }; toast("Tap Print to pick a printer"); }

// ───────────── PDF preview (check the sticker without wasting a sticker) ─────────────
function makePdf(jpeg, pw, ph, wmm, hmm) {
  const W = +(wmm * 72 / 25.4).toFixed(2), H = +(hmm * 72 / 25.4).toFixed(2), parts = [], offs = [];
  let len = 0; const add = x => { const u = typeof x === "string" ? enc(x) : x; parts.push(u); len += u.length; };
  const obj = (n, head, stream) => { offs[n] = len; add(`${n} 0 obj\n${head}`); if (stream) { add("\nstream\n"); add(stream); add("\nendstream"); } add("\nendobj\n"); };
  add("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`);
  const cs = enc(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
  obj(4, `<< /Length ${cs.length} >>`, cs);
  obj(5, `<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  const xr = len; let x = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, "0") + " 00000 n \n";
  add(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
  return cat(...parts);
}

export function pdfPreview(o, serial) {
  if (!trackingOf(o)) return toast(NO_TRACKING, true);
  const [LW, LH] = getSize(), c = renderLabel(o, serial, 4);
  const b64 = c.toDataURL("image/jpeg", 0.95).split(",")[1], bin = atob(b64), jpeg = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
  const wmm = c.width / 4 / DPI_DOTS_PER_MM, url = URL.createObjectURL(new Blob([makePdf(jpeg, c.width, c.height, wmm, LH)], { type: "application/pdf" }));
  const w = window.open(url, "_blank");
  if (!w) { const a = document.createElement("a"); a.href = url; a.download = `sticker-${trackingOf(o)}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
