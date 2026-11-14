import sys; sys.path.insert(0, "qa")
from lib import *
srv = serve(); fake = Fake()
with sync_playwright() as p:
    b, ctx, page, errs = new_page(p, fake)
    page.goto(f"http://127.0.0.1:{PORT}/"); page.wait_for_selector(".app", timeout=15000)
    print("title:", page.locator(".topbar h1").inner_text())
    for name in ["Dashboard","Orders","Monitor","Courier","Analytics","Settings"]:
        page.locator(".sidenav").get_by_text(name, exact=True).click(); page.wait_for_timeout(500)
        print(name, "->", page.locator(".topbar h1").inner_text(), "| text len", len(page.locator(".content").inner_text()))
        page.screenshot(path=f"/tmp/shot-{name}.png", full_page=False)
    print("ERRORS:", errs)
    b.close()
