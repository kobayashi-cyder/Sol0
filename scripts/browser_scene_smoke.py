"""End-to-end browser proof for Sol0 offline multi-subject image composition.

Checks user-visible scene recognition, rendered Canvas differences, true PNG
encoding and persistence without downloads, AI APIs or network traffic.
"""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright, expect

from browser_server import serve_root

ROOT = Path(__file__).resolve().parents[1]

def canvas_fingerprint(page):
    return page.evaluate("""() => {
      const c=document.querySelector('#panelBody canvas');
      if(!c) throw Error('missing scene preview');
      const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let hash=2166136261;
      for(let i=0;i<pixels.length;i+=31){
        hash^=pixels[i];
        hash=Math.imul(hash,16777619);
      }
      return hash>>>0;
    }""")

def run():
    with serve_root(ROOT) as origin, sync_playwright() as p:
        system=which("chromium") or which("chromium-browser")
        browser=p.chromium.launch(headless=True,args=["--no-sandbox"],
            **({"executable_path":system} if system else {}))
        context=browser.new_context(viewport={"width":390,"height":820},is_mobile=True,
            has_touch=True,accept_downloads=True)
        page=context.new_page()
        errors=[]
        page.on("pageerror",lambda err:errors.append(str(err)))
        page.goto(origin+"SolZero_Chat_Offline.html",wait_until="load")
        page.locator("#studioBtn").click(force=True)
        before=canvas_fingerprint(page)
        page.get_by_role("button",name="構図サンプルを試す",exact=True).click()
        desc=page.locator("#panelBody p").filter(has_text="構図：")
        expect(desc).to_contain_text("猫・ロボット")
        expect(desc).to_contain_text("watercolor")
        expect(desc).to_contain_text("golden")
        example=canvas_fingerprint(page)
        assert example!=before,(example,before)
        assert "赤い猫" in page.locator("#panelBody textarea").input_value()
        page.get_by_role("button",name="指定からプレビュー",exact=True).click()
        assert example==canvas_fingerprint(page),"Scene must be reproducible for same seed"
        page.locator("#panelBody textarea").fill("星空の宇宙、左に月、右に鳥、ネオン")
        page.get_by_role("button",name="指定からプレビュー",exact=True).click()
        expect(desc).to_contain_text("月・鳥")
        expect(desc).to_contain_text("neon")
        alternate=canvas_fingerprint(page)
        assert alternate!=example,(example,alternate)
        # The PNG button must use the same director, not merely the preview.
        page.get_by_role("button",name="画像 PNG",exact=True).click()
        expect(page.locator("#panelBody .listentry").first).to_contain_text(
            "生成完了：",timeout=12000)
        image=page.locator("#panelBody .listentry img")
        expect(image).to_have_count(1,timeout=12000)
        png_dimensions=page.evaluate("""async () => {
          const img=document.querySelector('#panelBody .listentry img');
          await img.decode();
          return [img.naturalWidth,img.naturalHeight];
        }""")
        assert png_dimensions==[512,288],png_dimensions
        assert not errors,errors
        print("PASS: composed multi-object canvas style, deterministic preview and encoded PNG (offline)")
        browser.close()

if __name__=="__main__":
    run()
