import qrcode from "qrcode-generator";
import { getDue, num, phoneOf, addressOf } from "./shared.js";
import { trackingLinkOf } from "./monitor.js";
import { DEFAULT_BRAND } from "./brand.js";

// ── Sticker size (mm). Default 50×30. The JP-PT265 prints at most 384 dots (48 mm) wide: wider stickers are centred automatically. ──
export const SIZES = ["50x30", "40x30", "50x25", "40x25", "30x20"];
const SIZE_KEY = "bee_label_size_v2";   // v2: a size saved before the 50x30 roll is ignored
export const getSizeKey = () => { try { const v = localStorage.getItem(SIZE_KEY); return SIZES.includes(v) ? v : "50x30"; } catch { return "50x30"; } };
export const setSizeKey = v => { try { localStorage.setItem(SIZE_KEY, v); } catch {} };
export const getSize = () => getSizeKey().split("x").map(Number);

const DOTS_PER_MM = 8;       // 200 dpi
const MAX_DOTS = 384;        // printable width of the JP-PT265

// brand + tracking-link settings, pushed in by the app (settings/brand, settings/monitor)
let ctx = { brand: DEFAULT_BRAND, cfg: null };
export const setLabelContext = c => { ctx = { ...ctx, ...c }; };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// parcel tracking id only (no serial fallback) - a sticker is never printed without it
export const trackingOf = o => String(o?.courierId || o?.steadfastTrackingCode || "").trim();
const NO_TRACKING = "Tracking ID nai! Age order-e Tracking / parcel ID boshao, tarpor print koro.";

export const PRINTER_MODES = { tspl: "Label printer (TSPL)", escpos: "Receipt printer (ESC/POS)" };
export const getMode = () => { try { return localStorage.getItem("bee_printer_mode") || "tspl"; } catch { return "tspl"; } };
export const setMode = m => { try { localStorage.setItem("bee_printer_mode", m); } catch {} };

function toast(msg, err) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("bee-print-toast");
  if (!el) { el = document.createElement("div"); el.id = "bee-print-toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.cssText = `position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;max-width:90vw;padding:11px 16px;border-radius:12px;font:600 13px system-ui,sans-serif;color:#fff;background:${err ? "#c62828" : "#17171a"};box-shadow:0 6px 24px #0004;text-align:center`;
  clearTimeout(el._t); el._t = setTimeout(() => el.remove(), err ? 6000 : 3200);
}

// ───────────── drawing ─────────────
const FONT = '"Noto Sans Bengali","Nirmala UI","Kalpurush","Segoe UI",Arial,sans-serif';

function newCanvas(scale) {
  const [LW, LH] = getSize();
  const W = LW * DOTS_PER_MM, H = LH * DOTS_PER_MM;
  const c = document.createElement("canvas"); c.width = W * scale; c.height = H * scale;
  const g = c.getContext("2d"); g.scale(scale, scale);
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.fillStyle = "#000"; g.strokeStyle = "#000"; g.textBaseline = "top";
  const printW = Math.min(W, MAX_DOTS), x0 = Math.floor((W - printW) / 2);     // the part the printer can actually reach
  const pad = 10, left = x0 + pad, right = x0 + printW - pad;
  const fit = (txt, maxW, px, weight = 700, min = 11) => { let sz = px; g.font = `${weight} ${sz}px ${FONT}`; while (g.measureText(txt).width > maxW && sz > min) { sz -= 1; g.font = `${weight} ${sz}px ${FONT}`; } return sz; };
  // one line that always fits: shrink first, then cut with "…" (never runs off the sticker)
  const text = (txt, x, y, px, { w = right - left, weight = 700, align = "left" } = {}) => {
    fit(txt, w, px, weight); let t = String(txt);
    if (g.measureText(t).width > w) { while (t.length > 1 && g.measureText(t + "…").width > w) t = t.slice(0, -1); t += "…"; }
    g.textAlign = align; g.textBaseline = "top"; g.fillText(t, x, y);
  };
  // up to `max` wrapped lines in a box
  const wrap = (txt, x, y, w, px, max, weight = 600) => {
    g.font = `${weight} ${px}px ${FONT}`; g.textAlign = "left"; g.textBaseline = "top";
    const words = String(txt).split(/\s+/).filter(Boolean); let line = "", n = 0;
    for (let i = 0; i < words.length; i++) {
      const next = line ? line + " " + words[i] : words[i];
      if (g.measureText(next).width <= w || !line) { line = next; continue; }
      if (++n >= max) { while (line.length > 1 && g.measureText(line + "…").width > w) line = line.slice(0, -1); g.fillText(line + "…", x, y); return y + px + 3; }
      g.fillText(line, x, y); y += px + 3; line = words[i];
    }
    if (line) { while (g.measureText(line).width > w && line.length > 1) line = line.slice(0, -1); g.fillText(line, x, y); y += px + 3; }
    return y;
  };
  return { c, g, W, H, x0, printW, left, right, fit, text, wrap };
}

// QR code with a 4-module quiet zone, drawn with whole-dot modules so it stays sharp on a 200 dpi printer. Returns the size used (0 = nothing drawn).
function drawQr(g, data, x, y, maxSize) {
  if (!data || maxSize < 40) return 0;
  let q; try { q = qrcode(0, "M"); q.addData(String(data), "Byte"); q.make(); } catch { try { q = qrcode(0, "L"); q.addData(String(data), "Byte"); q.make(); } catch { return 0; } }
  const n = q.getModuleCount(), m = Math.floor(maxSize / (n + 8));
  if (m < 2) return 0;                                      // too dense to scan at this size
  const size = (n + 8) * m;
  g.fillStyle = "#fff"; g.fillRect(x, y, size, size); g.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect(x + (c + 4) * m, y + (r + 4) * m, m, m);
  return size;
}

// black rounded box with white text (the tracking number / brand name)
function pill(d, txt, x, y, w, h, px) {
  const { g } = d; g.fillStyle = "#000"; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, Math.min(10, h / 2)); else g.rect(x, y, w, h); g.fill();
  g.fillStyle = "#fff"; g.textBaseline = "middle"; g.textAlign = "center";
  const sp = "letterSpacing" in g ? 2 : 0;
  d.fit(txt, w - 20 - String(txt).length * sp, px, 900, 12);
  if (sp) g.letterSpacing = `${sp}px`;
  g.fillText(txt, x + w / 2 + sp / 2, y + h / 2 + 1);
  if (sp) g.letterSpacing = "0px";
  g.fillStyle = "#000"; g.textBaseline = "top";
}

// QR placed against the right edge (decides its own size from the data), returns the size used (0 = none)
function drawQrAt(g, data, rightEdge, y, maxSize) {
  let q; try { q = qrcode(0, "M"); q.addData(String(data), "Byte"); q.make(); } catch { return 0; }
  const n = q.getModuleCount(), m = Math.floor(maxSize / (n + 8)); if (m < 2) return 0;
  const size = (n + 8) * m;
  return drawQr(g, data, rightEdge - size, y, size);
}

// LABEL 1: customer info on the left, QR on the right, tracking number underneath
export function renderTracking(o, serial, scale = 1) {
  const d = newCanvas(scale), { g, H, left, right, text, wrap } = d;
  const tid = trackingOf(o), due = getDue(o), tk = n => "Tk " + Number(n).toLocaleString("en-US");
  const pillH = Math.min(66, Math.max(44, Math.round(H * 0.27))), pillY = H - pillH - 6;
  const topH = pillY - 10, areaW = right - left;             // free height above the tracking pill
  const used = drawQrAt(g, trackingLinkOf(o, ctx.cfg) || tid, right, 6, Math.min(topH - 6, Math.floor(areaW * 0.44)));
  const colW = areaW - (used ? used + 10 : 0);

  let y = 7;
  const name = String(o?.customerName || "—");
  g.font = `700 24px ${FONT}`;
  if (g.measureText(name).width > colW) y = wrap(name, left, y, colW, 20, 2, 700) + 1;     // long names wrap instead of shrinking to tiny text
  else { text(name, left, y, 24, { w: colW }); y += 28; }
  const phone = phoneOf(o); if (phone) { text(phone, left, y, 19, { w: colW, weight: 600 }); y += 23; }
  text(due > 0 ? `DUE ${tk(due)}` : "PAID", left, y, 24, { w: serial ? colW - 52 : colW, weight: 900 });
  if (serial) text(`#${serial}`, left + colW, y + 7, 15, { w: 50, align: "right", weight: 700 });
  y += 28;
  const list = Array.isArray(o?.items) ? o.items.filter(i => i?.name) : [];
  const short = i => [i.name, i.vehicle === "Scooter" ? "Scooter" : "", i.side === "Back Side" ? "Back" : "Front", i.type === "Custom" ? "Custom" : ""].filter(Boolean).join(" · ") + (num(i.qty) > 1 ? ` ×${num(i.qty)}` : "");
  const items = list.length > 1 ? `${list.length} plates: ${list.map(i => i.name).join(", ")}` : list.length ? short(list[0]) : String(o?.bikeNumbers || "");
  if (items && y + 18 <= topH) y = wrap(items, left, y, colW, 16, 2, 600) + 2;          // plate · vehicle · side wraps to 2 lines
  const addr = addressOf(o), rows = Math.floor((topH + 4 - y) / 18);
  if (addr && rows >= 1) wrap(addr, left, y, colW, 15, Math.min(2, rows));

  pill(d, tid, left, pillY, areaW, pillH, Math.round(pillH * 0.9));
  return d.c;
}

// LABEL 2: thank you + follow our page + marketing line, QR to the page on the right
export function renderThanks(o, scale = 1) {
  const d = newCanvas(scale), { g, H, left, right, text, wrap } = d, b = ctx.brand || DEFAULT_BRAND;
  const pillH = Math.min(58, Math.max(40, Math.round(H * 0.24))), pillY = H - pillH - 6;
  const topH = pillY - 12, areaW = right - left;
  const hasQr = !!b.pageUrl;
  const want = Math.min(topH - 14, Math.floor(areaW * 0.42));
  const used = hasQr ? drawQrAt(g, b.pageUrl, right, 4, want) : 0;
  if (used) text("SCAN & FOLLOW", right - used / 2, 4 + used + 1, 12, { w: used + 10, weight: 800, align: "center" });
  const colW = areaW - (used ? used + 12 : 0);
  const first = String(o?.customerName || "").trim().split(/\s+/)[0];
  let y = 6;
  text("THANK YOU!", left, y, 38, { w: colW, weight: 900 }); y += 42;
  text(first ? `for your order, ${first}` : "for your order", left, y, 19, { w: colW, weight: 700 }); y += 24;
  if (b.banglaLine) { text("ধন্যবাদ! আমাদের পেজ ফলো করুন", left, y, 18, { w: colW, weight: 700 }); y += 23; }
  text(hasQr ? "Follow our page" : `Follow our page: ${b.pageName}`, left, y, 18, { w: colW, weight: 800 }); y += 22;
  if (b.tagline && y + 16 < topH + 6) wrap(b.tagline, left, y, colW, 16, 2, 600);
  pill(d, String(b.pageName || "3D Bee").toUpperCase(), left, pillY, areaW, pillH, Math.round(pillH * 0.78));
  return d.c;
}

// which stickers belong to one print: tracking sticker + (optional) thank-you sticker
export function labelsFor(o, serial, which = "auto", scale = 1) {
  const list = [];
  const wantThanks = which === "thanks" || which === "both" || (which === "auto" && (ctx.brand?.thankYou ?? true));
  const wantTrack = which !== "thanks";
  if (wantTrack) list.push(renderTracking(o, serial, scale));
  if (wantThanks) list.push(renderThanks(o, scale));
  return list;
}

// ───────────── raw printer data (TSPL / ESC-POS) ─────────────
function printable(c) {                       // crop the centred 384-dot window the printer head can reach
  const w = Math.min(c.width, MAX_DOTS);
  if (c.width === w) return { img: c.getContext("2d").getImageData(0, 0, c.width, c.height), xoff: 0 };
  const t = document.createElement("canvas"); t.width = w; t.height = c.height;
  const x0 = Math.floor((c.width - w) / 2); t.getContext("2d").drawImage(c, -x0, 0);
  return { img: t.getContext("2d").getImageData(0, 0, w, c.height), xoff: x0 };
}
function pack(img, blackIsOne) {             // 1 bit per dot
  const W = img.width, H = img.height, bpr = W / 8, out = new Uint8Array(bpr * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, lum = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11;
    if ((lum < 160) === blackIsOne) out[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return out;
}
const enc = s => new TextEncoder().encode(s);
const cat = (...a) => { const n = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { n.set(x, p); p += x.length; } return n; };

function buildJob(canvases, mode) {
  const [LW, LH] = getSize();
  return cat(...canvases.map(c => {
    const { img, xoff } = printable(c), bpr = img.width / 8;
    if (mode === "escpos") return cat(Uint8Array.of(0x1b, 0x40), Uint8Array.of(0x1d, 0x76, 0x30, 0, bpr & 255, bpr >> 8, img.height & 255, img.height >> 8), pack(img, true), Uint8Array.of(0x0a, 0x0a));
    return cat(enc(`SIZE ${LW} mm,${LH} mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP ${xoff},0,${bpr},${img.height},0,`), pack(img, false), enc("\r\nPRINT 1,1\r\n"));
  }));
}

// ───────────── Bluetooth (Web Bluetooth: Chrome on Android / desktop; not iOS Safari) ─────────────
const SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", "0000ff00-0000-1000-8000-00805f9b34fb", "0000fff0-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb", "0000fee7-0000-1000-8000-00805f9b34fb", "0000ae30-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "0000180a-0000-1000-8000-00805f9b34fb",
  "00001800-0000-1000-8000-00805f9b34fb", "0000fe59-0000-1000-8000-00805f9b34fb"
];
let conn = { device: null, char: null };

async function connect(forcePick) {
  if (!forcePick && conn.char && conn.device?.gatt?.connected) return conn.char;
  if (!forcePick && conn.device) { try { conn.char = await findChar(await conn.device.gatt.connect()); return conn.char; } catch { conn = { device: null, char: null }; } }
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
    for (const ch of chars) { const p = ch.properties; if (p.writeWithoutResponse || p.write) { if (!best || (p.writeWithoutResponse && !best.properties.writeWithoutResponse)) best = ch; } }
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

// Tap print -> pick / reuse the Bluetooth printer -> send the sticker(s). `which`: "auto" (tracking + thank-you if enabled) | "tracking" | "thanks" | "both"
export async function printLabel(o, serial, which = "auto") {
  if (which !== "thanks" && !trackingOf(o)) return toast(NO_TRACKING, true);
  if (typeof navigator === "undefined" || !navigator.bluetooth) { toast("Bluetooth printing needs Chrome on Android. Opening normal print…", true); return browserPrint(o, serial, which); }
  try {
    const labels = labelsFor(o, serial, which, 1);
    const job = buildJob(labels, getMode());
    let ch = await connect(false);
    try { await send(ch, job, 100); } catch { ch = await connect(false); await send(ch, job, 20); }
    const noQr = labels.length > 1 && !ctx.brand?.pageUrl;
    toast(`Sent ${labels.length} sticker${labels.length > 1 ? "s" : ""} ✓${noQr ? " (thank-you sticker has no QR: Settings e page link dao)" : ""}`, false);
  } catch (e) {
    if (e?.name === "NotFoundError") return toast("No printer selected", true);
    conn = { device: null, char: null };
    toast(`Print failed: ${e?.message || e}`, true);
  }
}
export async function changePrinter() { conn = { device: null, char: null }; toast("Tap Print to pick a printer"); }

// ───────────── browser print + PDF preview (same images as the printer gets) ─────────────
export function browserPrint(o, serial, which = "auto") {
  if (which !== "thanks" && !trackingOf(o)) return toast(NO_TRACKING, true);
  const [LW, LH] = getSize();
  const imgs = labelsFor(o, serial, which, 3).map(c => c.toDataURL("image/png"));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Stickers ${esc(trackingOf(o))}</title><style>
@page{size:${LW}mm ${LH}mm;margin:0}*{margin:0;padding:0}html,body{background:#fff}
img{display:block;width:${LW}mm;height:${LH}mm;page-break-after:always;image-rendering:pixelated}img:last-child{page-break-after:avoid}
</style></head><body>${imgs.map(s => `<img src="${s}">`).join("")}</body></html>`;
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const w = f.contentWindow;
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } finally { setTimeout(() => f.remove(), 2000); } }, 400);
}

// minimal multi-page PDF (one JPEG per page) so you can check the stickers without wasting paper
function makePdf(pages, wmm, hmm) {
  const W = +(wmm * 72 / 25.4).toFixed(2), H = +(hmm * 72 / 25.4).toFixed(2), parts = [], offs = [];
  let len = 0; const add = x => { const u = typeof x === "string" ? enc(x) : x; parts.push(u); len += u.length; };
  const obj = (n, head, stream) => { offs[n] = len; add(`${n} 0 obj\n${head}`); if (stream) { add("\nstream\n"); add(stream); add("\nendstream"); } add("\nendobj\n"); };
  const N = pages.length, firstPage = 3, firstContent = firstPage + N, firstImg = firstContent + N, total = firstImg + N;
  add("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${firstPage + i} 0 R`).join(" ")}] /Count ${N} >>`);
  pages.forEach((_, i) => obj(firstPage + i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${firstContent + i} 0 R /Resources << /XObject << /Im0 ${firstImg + i} 0 R >> >> >>`));
  pages.forEach((_, i) => { const cs = enc(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`); obj(firstContent + i, `<< /Length ${cs.length} >>`, cs); });
  pages.forEach((p, i) => obj(firstImg + i, `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg));
  const xr = len; let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, "0") + " 00000 n \n";
  add(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
  return cat(...parts);
}

export function pdfPreview(o, serial, which = "auto") {
  if (which !== "thanks" && !trackingOf(o)) return toast(NO_TRACKING, true);
  const [LW, LH] = getSize();
  const pages = labelsFor(o, serial, which, 4).map(c => {
    const bin = atob(c.toDataURL("image/jpeg", 0.95).split(",")[1]), jpeg = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
    return { jpeg, w: c.width, h: c.height };
  });
  const url = URL.createObjectURL(new Blob([makePdf(pages, LW, LH)], { type: "application/pdf" }));
  const w = window.open(url, "_blank");
  if (!w) { const a = document.createElement("a"); a.href = url; a.download = `stickers-${trackingOf(o) || "thankyou"}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
