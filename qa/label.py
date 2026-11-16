"""Renders real sticker PDFs from the UI (the same canvas that is sent to the printer), converts them to images and DECODES the barcode.
Usage: python3 qa/label.py   (needs the QA bundle: sh qa/build.sh)"""
import sys, json, base64
sys.path.insert(0, "qa")
from lib import *
import pypdfium2 as pdfium, cv2, numpy as np, zxingcpp

srv = serve(); fake = Fake(); fails = []
ORDER = {"customerName": "Label Test", "courierRecipientPhone": "01712345678", "courierRecipientAddress": "House 5, Mirpur", "customerDetails": "01712345678 · House 5, Mirpur",
         "items": [{"name": "DHAKA-METRO-HA 11-2233", "vehicle": "Scooter", "side": "Back Side", "type": "BRTA", "qty": 2, "price": 500}], "bikeNumbers": "DHAKA-METRO-HA 11-2233 · Scooter · Back · BRTA ×2",
         "total": 1080, "paidAmount": 500, "dueAmount": 580, "paymentStatus": "Paid Advance", "orderStatus": "Ready to ship", "courierName": "Steadfast", "createdAt": "2026-11-14T10:00:00.000Z", "orderDate": "2026-11-14", "serial": 99}

def decode_img(img):
    return sorted({x.text for x in zxingcpp.read_barcodes(img)})

def decode_variants(pg, png):
    """(a) hi-res render, (b) printer's real 200 dpi, (c) 200 dpi + mild blur (normal thermal dot gain) = must decode.
    (d) 200 dpi + heavy blur = informational only (worst-case print/scan)."""
    out = {}
    hi = cv2.imread(png); out["hi-res"] = decode_img(hi)
    pr = cv2.cvtColor(np.array(pg.render(scale=200 / 72).to_pil().convert("RGB")), cv2.COLOR_RGB2BGR)
    out["200dpi"] = decode_img(pr)
    out["200dpi+mild"] = decode_img(cv2.GaussianBlur(pr, (3, 3), 0.6))
    out["(heavy blur)"] = decode_img(cv2.GaussianBlur(pr, (3, 3), 0.9))
    return out
def must(res, tid): return all(v == [tid] for k, v in res.items() if not k.startswith("("))
LONG = dict(ORDER, customerName="Mohammad Abdur Rahman Chowdhury", items=[{"name": "DHAKA-METRO-HA 11-2233", "vehicle": "Scooter", "side": "Back Side", "type": "Custom", "qty": 2, "price": 500}, {"name": "CHATTA-METRO-GA 12-3456", "vehicle": "Bike", "side": "Front Side", "type": "BRTA", "qty": 1, "price": 250}], total=1550, paidAmount=0, dueAmount=1550, paymentStatus="Unpaid")
with sync_playwright() as p:
    b, ctx, page, errs = new_page(p, fake)
    page.goto(f"http://127.0.0.1:{PORT}/"); page.wait_for_selector(".app"); page.wait_for_timeout(500)
    page.evaluate("() => { window.__pdfs = []; window.open = u => { window.__pdfs.push(u); return { close() {} }; }; }")
    page.locator(".sidenav").get_by_text("Orders", exact=True).click()
    for size in ["40x30", "50x30", "50x25"]:
        page.evaluate("s => localStorage.setItem('bee_label_size', s)", size)
        for tid in ["12345678", "1234567", "15BAEB8A", "9000123456", "TRKQA1"]:
            page.evaluate("([o, t]) => window.__qa.write('3dbee/orders/labtest', { ...o, courierId: t })", [ORDER, tid])
            page.locator(".search").fill("Label Test"); page.wait_for_timeout(200)
            page.locator(".tablewrap tbody tr").first.click(); page.wait_for_selector(".drawer")
            page.get_by_role("button", name="📄 PDF preview").click(); page.wait_for_timeout(250)
            data = page.evaluate("""async () => { const r = await fetch(window.__pdfs.at(-1)); return Array.from(new Uint8Array(await r.arrayBuffer())); }""")
            pdf = pdfium.PdfDocument(bytes(data)); pg = pdf[0]
            w_mm = pg.get_width() / 72 * 25.4; h_mm = pg.get_height() / 72 * 25.4
            png = f"/tmp/label-{size}-{tid}.png"; pg.render(scale=12).to_pil().save(png)
            res = decode_variants(pg, png)
            ok = must(res, tid)
            exp_w = min(48.0, float(size.split("x")[0]))
            ok_size = abs(w_mm - exp_w) < 0.2 and abs(h_mm - float(size.split("x")[1])) < 0.2
            print(("PASS" if ok and ok_size else "FAIL"), size, tid, "page %.1fx%.1fmm" % (w_mm, h_mm), {k: (v[0] if v else None) for k, v in res.items()})
            if not (ok and ok_size): fails.append((size, tid, res, w_mm, h_mm))
            page.keyboard.press("Escape"); page.wait_for_timeout(100)
    # long names / several items must stay inside the sticker and the barcode must still decode
    page.evaluate("s => localStorage.setItem('bee_label_size', s)", "40x30")
    page.evaluate("([o, t]) => window.__qa.write('3dbee/orders/labtest', { ...o, courierId: t })", [LONG, "15BAEB8A"])
    page.locator(".search").fill("Mohammad Abdur"); page.wait_for_timeout(200); page.locator(".tablewrap tbody tr").first.click(); page.wait_for_selector(".drawer")
    page.get_by_role("button", name="📄 PDF preview").click(); page.wait_for_timeout(250)
    data = page.evaluate("""async () => { const r = await fetch(window.__pdfs.at(-1)); return Array.from(new Uint8Array(await r.arrayBuffer())); }""")
    pg = pdfium.PdfDocument(bytes(data))[0]; pg.render(scale=12).to_pil().save("/tmp/label-long.png")
    res = decode_variants(pg, "/tmp/label-long.png"); okl = must(res, "15BAEB8A")
    print(("PASS" if okl else "FAIL"), "long name + 2 items", {k: (v[0] if v else None) for k, v in res.items()})
    if not okl: fails.append(("long", res))
    b.close()
print("barcode decode failures:", len(fails)); sys.exit(1 if fails else 0)
