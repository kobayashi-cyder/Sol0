"""Browser-level data-integrity regression: corrupt WSP and storage quota never replace chat.

No network requests are made. File Picker receives in-memory JSON bytes.
This is headless Chromium, not Android physical-device verification.
"""
import json
from pathlib import Path
from shutil import which

from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"SolZero_Chat_Offline.html").read_text(encoding="utf-8")
KEY="solzero_chat_v012_local"
INIT_STORAGE="""() => {
  const store={};
  const control={failWrites:false};
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    getItem(key){return Object.hasOwn(store,key)?store[key]:null;},
    setItem(key,value){if(control.failWrites)throw Error('QuotaExceededError');store[key]=String(value);},
    removeItem(key){delete store[key];},
    clear(){for(const key of Object.keys(store))delete store[key];}
  }});
  window.__sol0BackupTest={control,stored:()=>JSON.stringify(store)};
  return true;
}"""

def backup(role: str, text: str, *, wsp=None):
    return {
        "schema":3,
        "current":"in-chat",
        "chats":[{
            "id":"in-chat","title":"Imported Conversation","created":"2026-11-09T01:00:00Z",
            "messages":[{"role":role,"text":text,"at":"2026-11-09T01:00:00Z"}]
        }],
        "knowledge":[],"documents":[],"theme":"light","wsp":wsp
    }

def input_file(page, value):
    raw=json.dumps(value,ensure_ascii=False).encode("utf-8")
    page.locator("#jsonPicker").set_input_files({
        "name":"sol0_backup.json","mimeType":"application/json","buffer":raw
    })

def main():
    with sync_playwright() as pw:
        chromium=which("chromium") or which("chromium-browser")
        browser=pw.chromium.launch(
            headless=True,args=["--no-sandbox","--disable-dev-shm-usage"],
            **({"executable_path":chromium} if chromium else {})
        )
        page=browser.new_page(viewport={"width":390,"height":844})
        errors=[]
        dialogs=[]
        page.on("pageerror",lambda err:errors.append(str(err)))
        page.on("dialog",lambda dialog:(dialogs.append(dialog.message),dialog.accept()))
        assert page.evaluate(INIT_STORAGE)
        initial=backup("user","PRESERVE_MY_OLD_CHAT")
        page.evaluate("(data) => localStorage.setItem('"+KEY+"', JSON.stringify(data))",initial)
        page.set_content(HTML,wait_until="load")
        expect(page.get_by_text("PRESERVE_MY_OLD_CHAT")).to_have_count(1,timeout=12000)
        before=page.evaluate("() => localStorage.getItem('"+KEY+"')")
        # A syntactically valid backup with invalid WSP must not reach the
        # confirmation dialog, mutate the visible chat, or write storage.
        invalid=backup("assistant","NEVER_IMPORT_THIS_BROKEN_WSP",wsp={"weights":[[9999]]})
        input_file(page,invalid)
        expect(page.locator("#toast")).to_contain_text("破損",timeout=10000)
        assert len(dialogs)==0,dialogs
        assert page.evaluate("() => localStorage.getItem('"+KEY+"')")==before
        expect(page.get_by_text("PRESERVE_MY_OLD_CHAT")).to_have_count(1)
        assert page.get_by_text("NEVER_IMPORT_THIS_BROKEN_WSP").count()==0
        # Quota exception on a valid backup is a different failure. The
        # user confirms, but neither memory nor storage may be replaced.
        valid=backup("assistant","AFTER_QUOTA_IMPORT")
        page.evaluate("window.__sol0BackupTest.control.failWrites=true")
        input_file(page,valid)
        expect(page.locator("#toast")).to_contain_text("保存容量",timeout=10000)
        assert len(dialogs)==1
        assert page.evaluate("() => localStorage.getItem('"+KEY+"')")==before
        expect(page.get_by_text("PRESERVE_MY_OLD_CHAT")).to_have_count(1)
        assert page.get_by_text("AFTER_QUOTA_IMPORT").count()==0
        # A successful, explicit replacement must commit and survive UI reload.
        long_code="def wsp_predict(x):\n"+"    # WSP long-code import\n"*500
        valid=backup("assistant",long_code)
        page.evaluate("window.__sol0BackupTest.control.failWrites=false")
        input_file(page,valid)
        expect(page.locator("#toast")).to_contain_text("復元しました",timeout=10000)
        assert len(dialogs)==2
        expect(page.locator(".message.assistant .bubble").last).to_contain_text(
            "def wsp_predict(x):",timeout=12000
        )
        saved=json.loads(page.evaluate("() => localStorage.getItem('"+KEY+"')"))
        assert saved["chats"][0]["messages"][0]["text"]==long_code
        page.set_content(HTML,wait_until="load")
        expect(page.locator(".message.assistant .bubble").last).to_contain_text(
            "def wsp_predict(x):",timeout=12000
        )
        assert not errors,errors
        print("PASS: browser corrupt WSP, quota failure and long-code success; storage intact")
        browser.close()

if __name__=="__main__":
    main()
