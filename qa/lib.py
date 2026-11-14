import http.server, socketserver, threading, json, functools, os
from playwright.sync_api import sync_playwright

PORT = 8765
def serve(root="/tmp/qa-out"):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    class Q(h.func):
        def log_message(self, *a): pass
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Q, directory=root))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

class Fake:
    """Fake Steadfast Netlify functions (what the browser talks to)."""
    def __init__(self):
        self.status = {}          # courierId -> delivery_status
        self.created = []         # create_order bodies
        self.calls = []
        self.dup = set()
    def handle(self, route, request):
        url = request.url
        body = json.loads(request.post_data or "{}")
        if url.endswith("/steadfast-api"):
            a = body.get("action"); self.calls.append(a)
            if a == "status":
                res = {}
                for it in body["items"]:
                    st = next((self.status[i] for i in it["ids"] if i in self.status), None)
                    res[it["key"]] = {"status": st, "matchedBy": "status_by_cid"} if st else {"error": "Steadfast e ei ID pawa jayni"}
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({"results": res}))
            if a == "health": return route.fulfill(status=200, content_type="application/json", body=json.dumps({"credentialsSet": True, "serverSyncReady": True, "webhookReady": False, "meta": {"lastRunAt": "2026-11-14T10:00:00.000Z", "lastResult": {"checked": 4, "changed": 1, "failed": 0}}}))
            if a == "serverSync": return route.fulfill(status=200, content_type="application/json", body=json.dumps({"checked": 3, "changed": 2, "failed": 0}))
            if a == "payments": return route.fulfill(status=200, content_type="application/json", body="[]")
            return route.fulfill(status=400, content_type="application/json", body=json.dumps({"error": "Unknown action"}))
        if url.endswith("/steadfast"):
            inv = body.get("invoice")
            if inv in self.dup:
                return route.fulfill(status=409, content_type="application/json", body=json.dumps({"error": f"Steadfast already has a parcel for {inv} (status: in_review). No second parcel was created.", "duplicate": True, "delivery_status": "in_review"}))
            self.dup.add(inv); self.created.append(body)
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"status": 200, "consignment": {"consignment_id": 5550001, "tracking_code": "TRKQA1", "tracking_link": "https://tracking.example.test/TRKQA1"}}))
        return route.continue_()

def new_page(p, fake, w=1440, h=900, scheme="light", mobile=False):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, timezone_id="Asia/Dhaka", accept_downloads=True, has_touch=mobile, is_mobile=mobile)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    page.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.route("**/.netlify/functions/**", fake.handle)
    return b, ctx, page, errs
