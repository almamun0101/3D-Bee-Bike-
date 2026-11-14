// Export helpers: CSV (UTF-8 with BOM so Excel shows Bengali correctly) and a real .xlsx file written without any dependency.
import { dhakaDay } from "./shared.js";

const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
export const toCsv = (head, rows) => "\ufeff" + [head, ...rows].map(r => r.map(esc).join(",")).join("\r\n");

// ── tiny ZIP (store, no compression) + CRC32 ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const te = new TextEncoder();
export function zip(files) { // files: [[name, string]]
  const parts = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of files) {
    const nb = te.encode(name), data = te.encode(text), crc = crc32(data);
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0]);
    parts.push(local, nb, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off)]), nb);
    off += local.length + nb.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), 0, 0]);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

const colName = i => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const xml = s => String(s).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export function toXlsx(head, rows, sheet = "Orders") {
  const cell = (v, r, c) => {
    const ref = colName(c) + (r + 1);
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(v ?? "")}</t></is></c>`;
  };
  const data = [head, ...rows].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join("")}</row>`).join("");
  const cols = head.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(10, String(h).length + 4))}" customWidth="1"/>`).join("");
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheet).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>`]
  ]);
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const stamp = () => dhakaDay(Date.now()); // yyyy-mm-dd in Asia/Dhaka

// Order rows used by both exports (readable columns, numbers stay numbers in Excel)
export const ORDER_COLUMNS = [
  ["Serial", (o, s) => s ?? ""], ["Order date", o => o.orderDate || ""], ["Customer", o => o.customerName || ""], ["Phone", o => o.courierRecipientPhone || ""],
  ["Items", o => o.bikeNumbers || ""], ["Total", o => Number(o.total || 0)], ["Paid", o => Number(o.paidAmount || 0)], ["Due", o => Number(o.dueAmount ?? 0)],
  ["Payment", o => o.paymentStatus || ""], ["Status", o => o.orderStatus || ""], ["Courier", o => o.courierName || ""], ["Tracking ID", o => o.courierId || ""],
  ["Tracking code", o => o.steadfastTrackingCode || ""], ["Courier status", o => o.steadfastStatus || ""], ["Delivery", o => o.deliveryStatus || ""],
  ["Created", o => o.createdAt || ""], ["Notes", o => (Array.isArray(o.internalNotes) ? o.internalNotes.map(n => n.text).join(" | ") : "")]
];
