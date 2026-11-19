"""Scans every screen (light + dark, normal + hover states) and lists text that is hard to read (contrast below WCAG AA)."""
import sys, json, re
sys.path.insert(0, "qa")
from lib import *

SCAN = """(opts) => {
  const parse = c => { const m = (c.match(/[\\d.]+/g) || [0,0,0]).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const out = [];
  const root = opts.root ? document.querySelector(opts.root) : document.body;
  if (!root) return out;
  const els = [root, ...root.querySelectorAll('*')];
  for (const el of els) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    const isField = ['INPUT','SELECT','TEXTAREA'].includes(el.tagName);
    if (!own && !isField) continue;
    if (own && !/[A-Za-z0-9\u0980-\u09FF]/.test(own)) continue;   // emoji / symbol only
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3) continue;
    // effective opacity from ancestors
    let op = 1, n = el; while (n) { op *= Number(getComputedStyle(n).opacity); n = n.parentElement; }
    if (op < 0.3) continue;
    let fg = parse(cs.color); if (isField && !el.value && el.placeholder) fg = parse(getComputedStyle(el, '::placeholder').color);
    let bg = null; n = el; let grad = false;
    while (n && !bg) { const c = getComputedStyle(n); const col = parse(c.backgroundColor); if (c.backgroundImage && c.backgroundImage !== 'none' && c.backgroundImage.includes('gradient') && col.a < 0.9) { grad = true; } if (col.a > 0.9) bg = col; n = n.parentElement; }
    if (!bg) bg = { r: 255, g: 255, b: 255 };
    if (grad) continue;   // gradient backgrounds are checked by eye
    const a = L(fg), b = L(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700, large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      let path = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
      let p = el.parentElement, d = 0; while (p && d < 2) { path = p.tagName.toLowerCase() + (p.className && typeof p.className === 'string' && p.className.trim() ? '.' + p.className.trim().split(/\\s+/)[0] : '') + ' > ' + path; p = p.parentElement; d++; }
      out.push({ path, text: (own || el.value || el.placeholder || '').slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, fg: cs.color, bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})` });
    }
  }
  return out;
}"""

findings = {}
def add(scheme, where, items):
    for it in items:
        key = (it["path"], it["fg"], it["bg"])
        findings.setdefault(key, {"scheme": set(), "where": set(), "text": it["text"], "ratio": it["ratio"], "need": it["need"]})
        findings[key]["scheme"].add(scheme); findings[key]["where"].add(where); findings[key]["ratio"] = min(findings[key]["ratio"], it["ratio"])

HOVER = [".btn", ".chip", ".segbtn", ".navitem", ".subtab", ".tiercard", ".kpi", ".monrow", ".tablewrap tbody tr", ".attnrow", ".menu button", ".alerts li button", ".trackbtn", ".history button", ".card", ".pricehint", ".pairbtn", ".stepper button", ".bottomnav button", ".iconbtn", ".linkbtn", ".more-toggle", ".feed li", ".bulkbar .btn"]

srv = serve(); fake = Fake(); fake.status.update({"9000t1": "pending"})
with sync_playwright() as p:
    for scheme in ["light", "dark"]:
        b, ctx, page, errs = new_page(p, fake, 1440, 900, scheme=scheme)
        page.on("dialog", lambda d: d.accept("view"))
        page.goto(f"http://127.0.0.1:{PORT}/"); page.wait_for_selector(".app"); page.wait_for_timeout(700)
        def scan(where, root=None): add(scheme, where, page.evaluate(SCAN, {"root": root}))
        def hover_scan(where, root=None):
            for sel in HOVER:
                loc = page.locator(f"{root or 'body'} {sel}:visible")
                for i in range(min(loc.count(), 2)):
                    try: loc.nth(i).hover(timeout=1500)
                    except Exception: continue
                    page.wait_for_timeout(120)
                    box = loc.nth(i)
                    tag = "hov-" + str(i)
                    box.evaluate("(e, t) => e.setAttribute('data-scan', t)", tag)
                    add(scheme, f"{where} [hover {sel}]", page.evaluate(SCAN, {"root": f"[data-scan='{tag}']"}))
                    box.evaluate("e => e.removeAttribute('data-scan')")
            page.mouse.move(5, 5)
        for name in ["Dashboard", "Orders", "Monitor", "Courier", "Analytics", "Settings"]:
            page.locator(".sidenav").get_by_text(name, exact=True).click(); page.wait_for_timeout(500)
            if name == "Orders":
                page.get_by_role("button", name=re.compile("Filters")).click(); page.wait_for_timeout(150)
                page.locator(".tablewrap tbody tr .chk").nth(0).click(); page.locator(".tablewrap tbody tr .chk").nth(1).click(); page.wait_for_timeout(150)
            scan(name); hover_scan(name)
            if name == "Orders":
                page.locator("select[aria-label='Saved views']").focus(); scan("Orders (focus)")
                page.get_by_role("button", name="Clear", exact=True).click()
        # overlays
        page.locator(".sidenav").get_by_text("Orders", exact=True).click(); page.wait_for_timeout(300)
        page.locator(".iconbtn").click(); page.wait_for_timeout(200); scan("Notifications"); hover_scan("Notifications", ".bellpanel"); page.keyboard.press("Escape")
        page.get_by_role("button", name="Export ▾").click(); page.wait_for_timeout(150); scan("Export menu", ".menu"); hover_scan("Export menu", ".menu"); page.keyboard.press("Escape")
        page.locator(".tablewrap tbody tr").nth(3).click(); page.wait_for_selector(".drawer"); page.wait_for_timeout(300); scan("Drawer", ".drawer"); hover_scan("Drawer", ".drawer"); page.keyboard.press("Escape")
        page.locator(".search").fill("t3"); page.wait_for_timeout(200); page.locator(".tablewrap tbody tr").first.click(); page.wait_for_selector(".drawer"); page.wait_for_timeout(200); scan("Drawer (parcel)", ".drawer"); hover_scan("Drawer (parcel)", ".drawer"); page.keyboard.press("Escape"); page.locator(".search").fill("")
        page.locator(".search").fill("t3"); page.wait_for_timeout(200); page.locator(".tablewrap tbody tr").first.click(); page.wait_for_selector(".drawer")
        page.locator(".printset summary").click(); page.wait_for_timeout(100); scan("Drawer print settings", ".printbox"); hover_scan("Drawer print settings", ".printbox")
        page.get_by_role("button", name="💬 Bangla message").click(); page.wait_for_selector(".msgmodal"); page.wait_for_timeout(200); scan("Message window", ".msgmodal"); hover_scan("Message window", ".msgmodal"); page.keyboard.press("Escape"); page.keyboard.press("Escape"); page.locator(".search").fill("")
        page.get_by_role("button", name="＋ New order").click(); page.wait_for_selector(".ordermodal"); page.wait_for_timeout(200)
        page.get_by_role("button", name="⚙ Edit prices").click(); page.get_by_role("button", name="Half").click()
        page.get_by_label("Plate 1", exact=True).fill("X 1"); page.wait_for_timeout(100)
        scan("Order form", ".ordermodal"); hover_scan("Order form", ".ordermodal"); page.keyboard.press("Escape")
        page.locator(".sidenav").get_by_text("Monitor", exact=True).click(); page.wait_for_timeout(300)
        page.locator(".monrow").first.get_by_text("＋ Follow-up").click(); page.wait_for_timeout(150); scan("Follow-up editor", ".fuedit")
        ctx.close(); b.close()

rows = sorted(findings.items(), key=lambda kv: kv[1]["ratio"])
print(f"{len(rows)} distinct low-contrast text styles found")
for (path, fg, bg), v in rows[:60]:
    print(f"  {v['ratio']:>5} (need {v['need']})  {'/'.join(sorted(v['scheme'])):<10} {path[:90]}  text={v['text']!r}\n          fg={fg} bg={bg}  where={sorted(v['where'])[:3]}")
json.dump([{"path": k[0], "fg": k[1], "bg": k[2], "ratio": v["ratio"], "schemes": sorted(v["scheme"]), "where": sorted(v["where"]), "text": v["text"]} for k, v in rows], open("/tmp/contrast.json", "w"), indent=1)
sys.exit(1 if rows else 0)
