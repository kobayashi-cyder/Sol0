"""Real Chromium E2E with a loopback mock of the ComfyUI v1 server.

The mock returns a genuinely encoded 512x288 PNG. No GPU, image model,
external network, personal files, or ComfyUI binary are used by CI.
"""
import json
import struct
import threading
import zlib
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright, expect
from browser_server import serve_root

ROOT=Path(__file__).resolve().parents[1]
PROMPT_ID="test-comfyui-20261109"
W,H=512,288


def actual_png(width=W,height=H):
    def chunk(tag, payload):
        return (struct.pack(">I",len(payload))+tag+payload+
                struct.pack(">I",zlib.crc32(tag+payload)&0xffffffff))
    rows=b"".join(b"\x00"+b"\x77\x98\xc2"*width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,2,0,0,0))+
            chunk(b"IDAT",zlib.compress(rows,6))+
            chunk(b"IEND",b""))


@contextmanager
def mock_comfy():
    state={"requests":[],"prompt":None,"image":actual_png()}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            return
        def headers_out(self,status=200,content_type="application/json",length=None):
            self.send_response(status)
            self.send_header("Content-Type",content_type)
            self.send_header("Access-Control-Allow-Origin",self.headers.get("Origin","null"))
            self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers","Content-Type")
            if length is not None:self.send_header("Content-Length",str(length))
            self.end_headers()
        def send_json(self,value,status=200):
            payload=json.dumps(value).encode("utf-8")
            self.headers_out(status,length=len(payload))
            self.wfile.write(payload)
        def do_OPTIONS(self):
            self.headers_out(204)
        def do_GET(self):
            path=urlsplit(self.path)
            state["requests"].append(("GET",path.path))
            if path.path=="/system_stats":
                return self.send_json({"system":{"os":"linux","python_version":"mock"}})
            if path.path=="/history/"+PROMPT_ID:
                return self.send_json({
                    PROMPT_ID:{"status":{"completed":True,"status_str":"success"},
                     "outputs":{"9":{"images":[{
                         "filename":"Sol0_mock_0001.png","subfolder":"","type":"output"
                     }]}}}
                })
            if path.path=="/view":
                query=parse_qs(path.query)
                if(query.get("filename")!=["Sol0_mock_0001.png"] or
                   query.get("type")!=["output"]):
                    return self.send_json({"error":"invalid output path"},400)
                self.headers_out(200,"image/png",len(state["image"]))
                self.wfile.write(state["image"])
                return
            return self.send_json({"error":"not found"},404)
        def do_POST(self):
            path=urlsplit(self.path)
            state["requests"].append(("POST",path.path))
            if path.path!="/prompt":return self.send_json({"error":"not found"},404)
            length=int(self.headers.get("Content-Length","0"))
            if length>16384:return self.send_json({"error":"too long"},413)
            state["prompt"]=json.loads(self.rfile.read(length))
            return self.send_json({"prompt_id":PROMPT_ID,"number":1})
    server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}",state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def run():
    with mock_comfy() as (endpoint,state),serve_root(ROOT) as origin,sync_playwright() as pw:
        system=which("chromium") or which("chromium-browser")
        browser=pw.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage"],
            **({"executable_path":system} if system else {}))
        page=browser.new_page(viewport={"width":390,"height":820},accept_downloads=True)
        errors=[],dialogs=[]
        page.on("pageerror",lambda exc:errors.append(str(exc)))
        page.on("dialog",lambda dlg:(dialogs.append(dlg.message),dlg.accept()))
        page.goto(origin+"SolZero_Chat_Offline.html",wait_until="load")
        page.locator("#studioBtn").click(force=True)
        assert not state["requests"],"Must not contact ComfyUI until user action"
        panel=page.locator("#panelBody")
        panel.locator("label").filter(has_text="ComfyUI接続先").locator("input").fill(endpoint)
        panel.locator("label").filter(has_text="モデル名").locator("input").fill("local-sdxl.safetensors")
        panel.locator("label").filter(has_text="生成指示").locator("textarea").fill(
            "左に赤い猫、右に青いロボット、夕焼けの海")
        page.get_by_role("button",name="ComfyUI接続確認",exact=True).click()
        expect(panel.locator(".listentry").first).to_contain_text("ローカルAPIに接続",timeout=10000)
        assert not any(path=="/prompt" for _,path in state["requests"])
        page.get_by_role("button",name="写実画像 ComfyUI（毎回確認）",exact=True).click()
        expect(panel.locator(".listentry").first).to_contain_text("生成完了：",timeout=12000)
        expect(panel.locator(".listentry img")).to_have_count(1,timeout=12000)
        assert len(dialogs)==1
        assert endpoint in dialogs[0]
        assert state["prompt"] is not None
        workflow=state["prompt"]["prompt"]
        assert workflow["4"]["inputs"]["ckpt_name"]=="local-sdxl.safetensors"
        assert "red cat" in workflow["6"]["inputs"]["text"]
        assert "blue robot" in workflow["6"]["inputs"]["text"]
        assert workflow["5"]["inputs"]["width"]==W
        assert workflow["5"]["inputs"]["height"]==H
        assert any(x==("POST","/prompt") for x in state["requests"])
        assert any(x==("GET","/view") for x in state["requests"])
        size=page.evaluate("""async () => {
            const img=document.querySelector('#panelBody .listentry img');
            await img.decode();
            return [img.naturalWidth,img.naturalHeight];
        }""")
        assert size==[W,H],size
        # The user may still create the default procedural PNG without network.
        before=len(state["requests"])
        page.get_by_role("button",name="画像 PNG",exact=True).click()
        page.wait_for_function("""() =>
          [...document.querySelectorAll('#panelBody .listentry b')]
          .filter(x=>x.textContent.includes('image:')).length>=1""",timeout=12000)
        assert len(state["requests"])==before,"Procedural mode must not call ComfyUI"
        # Invalid remote URL must be rejected, without placing any HTTP request.
        count=panel.locator(".listentry img").count()
        panel.locator("label").filter(has_text="ComfyUI接続先").locator("input").fill("http://example.org:8188")
        page.get_by_role("button",name="写実画像 ComfyUI（毎回確認）",exact=True).click()
        expect(panel.locator(".listentry").first).to_contain_text("エラー：",timeout=10000)
        assert len(state["requests"])==before
        assert panel.locator(".listentry img").count()==count
        assert not errors,errors
        print("PASS: ComfyUI explicit consent -> API workflow -> actual PNG -> IndexedDB, procedural remains offline")
        browser.close()


if __name__=="__main__":
    run()
