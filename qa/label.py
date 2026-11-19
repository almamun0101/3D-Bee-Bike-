"""Renders the real sticker PDFs from the UI (the same canvases that go to the printer), converts them to images and DECODES the QR codes.
Checks: 2 stickers per print (tracking + thank-you), sizes, QR content, scan-ability at the printer's real 200 dpi (+ blur).
Usage: python3 qa/label.py   (needs the QA bundle: sh qa/build.sh)"""
import sys
sys.path.insert(0, "qa")
from lib import *
import pypdfium2 as pdfium, cv2, numpy as np, zxingcpp

srv = serve(); fake = Fake(); fails = []
BRAND = {"pageName": "3D Bee", "pageUrl": "https://www.facebook.com/3dbee.test", "tagline": "Share a photo & tag us!", "banglaLine": True, "thankYou": True}
ORDER = {"customerName": "Label Test", "courierRecipientPhone": "01712345678", "courierRecipientAddress": "House 5, Road 3, Mirpur 10, Dhaka", "customerDetails": "01712345678 · House 5, Mirpur",
         "items": [{"name": "DHAKA-METRO-HA 11-2233", "vehicle": "Scooter", "side": "Back Side", "type": "BRTA", "qty": 2, "price": 500}], "bikeNumbers": "DHAKA-METRO-HA 11-2233 · Scooter · Back · BRTA ×2",
         "total": 1080, "paidAmount": 500, "dueAmount": 580, "paymentStatus": "Paid Advance", "orderStatus": "Ready to ship", "courierName": "Steadfast", "createdAt": "2026-11-14T10:00:00.000Z", "orderDate": "2026-11-14", "serial": 99}
LONG = dict(ORDER, customerName="Mohammad Abdur Rahman Chowdhury", courierRecipientAddress="Flat 7B, Green Valley Apartments, Road 12, Block C, Bashundhara R/A, Dhaka 1229",
            items=[{"name": "DHAKA-METRO-HA 11-2233", "vehicle": "Scooter", "side": "Back Side", "type": "Custom", "qty": 2, "price": 500}, {"name": "CHATTA-METRO-GA 12-3456", "vehicle": "Bike", "side": "Front Side", "type": "BRTA", "qty": 1, "price": 250}], total=1550, paidAmount=0, dueAmount=1550, paymentStatus="Unpaid")

def texts(img): return sorted({x.text for x in zxingcpp.read_barcodes(img, formats=zxingcpp.BarcodeFormat.QRCode)})
def variants(pg):
    hi = cv2.cvtColor(np.array(pg.render(scale=12).to_pil().convert("RGB")), cv2.COLOR_RGB2BGR)
    pr = cv2.cvtColor(np.array(pg.render(scale=200 / 72).to_pil().convert("RGB")), cv2.COLOR_RGB2BGR)
    return {"hi-res": texts(hi), "200dpi": texts(pr), "200dpi+mild": texts(cv2.GaussianBlur(pr, (3, 3), 0.6)), "(heavy blur)": texts(cv2.GaussianBlur(pr, (3, 3), 0.9))}, hi
def must(res, want):
    return all(v == want for k, v in res.items() if not k.startswith("("))
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  <- {detail}"))
    if not ok: fails.append(name)

with sync_playwright() as p:
    b, ctx, page, errs = new_page(p, fake)
    page.goto(f"http://127.0.0.1:{PORT}/"); page.wait_for_selector(".app"); page.wait_for_timeout(500)
    page.evaluate("() => { window.__pdfs = []; window.open = u => { window.__pdfs.push(u); return { close() {} }; }; }")
    page.locator(".sidenav").get_by_text("Orders", exact=True).click()
    def pdf_for(order, tid, size, which=None):
        page.evaluate("s => localStorage.setItem('bee_label_size_v2', s)", size)
        page.evaluate("([o, t]) => window.__qa.write('3dbee/orders/labtest', { ...o, courierId: t })", [order, tid])
        page.locator(".search").fill(order["customerName"][:12]); page.wait_for_timeout(200)
        page.locator(".tablewrap tbody tr").first.click(); page.wait_for_selector(".drawer")
        if which: page.get_by_role("button", name=which).click()
        else: page.get_by_role("button", name="📄 PDF preview").click()
        page.wait_for_timeout(300)
        data = page.evaluate("""async () => { const r = await fetch(window.__pdfs.at(-1)); return Array.from(new Uint8Array(await r.arrayBuffer())); }""")
        page.keyboard.press("Escape"); page.wait_for_timeout(100)
        return pdfium.PdfDocument(bytes(data))

    print("== brand page link set: tracking sticker + thank-you sticker ==")
    page.evaluate("b => window.__qa.write('3dbee/settings/brand', b)", BRAND)
    for size in ["50x30", "40x30", "50x25"]:
        for tid in ["12345678", "1234567", "15BAEB8A", "9000123456"]:
            pdf = pdf_for(ORDER, tid, size)
            lw, lh = [float(x) for x in size.split("x")]
            sizes_ok = len(pdf) == 2 and all(abs(pg.get_width() / 72 * 25.4 - lw) < 0.2 and abs(pg.get_height() / 72 * 25.4 - lh) < 0.2 for pg in pdf)
            r1, im1 = variants(pdf[0]); r2, im2 = variants(pdf[1])
            cv2.imwrite(f"/tmp/label-{size}-{tid}-p1.png", im1); cv2.imwrite(f"/tmp/label-{size}-{tid}-p2.png", im2)
            check(f"{size} {tid}: 2 pages of {lw:g}x{lh:g}mm", sizes_ok, (len(pdf), [(pg.get_width() / 72 * 25.4, pg.get_height() / 72 * 25.4) for pg in pdf]))
            check(f"{size} {tid}: tracking sticker QR decodes to the tracking id", must(r1, [tid]), r1)
            check(f"{size} {tid}: thank-you sticker QR decodes to the page link", must(r2, [BRAND["pageUrl"]]), r2)
    print("== long name + 2 plates + long address stay inside the sticker ==")
    pdf = pdf_for(LONG, "15BAEB8A", "50x30"); r1, im1 = variants(pdf[0]); cv2.imwrite("/tmp/label-long.png", im1)
    check("long order: QR still decodes", must(r1, ["15BAEB8A"]), r1)
    print("== tracking link configured: QR carries the link ==")
    page.evaluate("() => window.__qa.write('3dbee/settings/monitor', { tiers: [24,48,72,96], stuckHours: 24, trackingUrlTemplate: 'https://track.example.test/t/{code}' })")
    pdf = pdf_for(ORDER, "1234567", "50x30"); r1, _ = variants(pdf[0])
    check("QR = tracking link built from the configured template", must(r1, ["https://track.example.test/t/1234567"]), r1)
    print("== no page link: thank-you sticker prints without QR (no crash, no invented link) ==")
    page.evaluate("b => window.__qa.write('3dbee/settings/brand', b)", dict(BRAND, pageUrl=""))
    pdf = pdf_for(ORDER, "1234567", "50x30"); r2, im2 = variants(pdf[1]); cv2.imwrite("/tmp/label-noqr-p2.png", im2)
    check("2 pages, thank-you has no QR", len(pdf) == 2 and r2["hi-res"] == [], r2)
    print("== thank-you disabled: one sticker only ==")
    page.evaluate("b => window.__qa.write('3dbee/settings/brand', b)", dict(BRAND, thankYou=False))
    check("thankYou=false -> 1 page", len(pdf_for(ORDER, "1234567", "50x30")) == 1)
    b.close()
print("\nlabel failures:", len(fails)); sys.exit(1 if fails else 0)
