"""Offline mobile-viewport task-plan smoke test (not physical Android validation)."""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'SolZero_Chat_Offline.html').read_text(encoding='utf-8')

def main():
    with sync_playwright() as pw:
        chromium=which('chromium') or which('chromium-browser')
        browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],
                                   **({'executable_path':chromium} if chromium else {}))
        page=browser.new_page(viewport={'width':390,'height':844},accept_downloads=True)
        errors=[]
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.evaluate("""() => {const store=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{
           getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()}});
           Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});} """)
        page.set_content(HTML,wait_until='load')
        expect(page.locator('#agentBtn')).to_be_visible()
        page.locator('#agentBtn').click()
        expect(page.locator('#panelTitle')).to_have_text('タスク工房 v0.15')
        page.get_by_role('button',name='計画の検証').click()
        expect(page.locator('#panelBody .listentry').last).to_contain_text('形式と参照関係は有効')
        page.get_by_role('button',name='計画を実行').click()
        expect(page.locator('#panelBody .listentry').last).to_contain_text('A,2,220',timeout=12000)
        with page.expect_download() as d:
            page.get_by_role('button',name='実行記録を保存').click()
        assert d.value.suggested_filename=='solzero_agent_report.json'
        # Reject a forbidden operation rather than performing it.
        page.locator('#panelBody textarea').fill('{"version":1,"steps":[{"id":"bad","op":"system.exec","args":{}}]}')
        page.get_by_role('button',name='計画を実行').click()
        expect(page.locator('#panelBody .listentry').last).to_contain_text('計画拒否')
        # Actual multi-step media output occurs only after an explicit user confirmation.
        page.locator('#panelBody select').first.select_option(label='画像・音声の生成')
        page.on('dialog',lambda dialog:dialog.accept())
        page.get_by_role('button',name='計画を実行').click()
        expect(page.locator('#panelBody .listentry').last).to_contain_text('2工程実行',timeout=20000)
        page.locator('#closePanel').click()
        page.locator('#studioBtn').click()
        expect(page.locator('#panelTitle')).to_have_text('メディア工房')
        expect(page.locator('#panelBody')).to_contain_text('2件',timeout=10000)
        page.locator('#closePanel').click()
        page.locator('#input').fill('/agent help')
        page.locator('#send').click()
        expect(page.locator('.message.assistant .bubble').last).to_contain_text('タスク工房 v0.15')
        assert not errors, errors
        print('PASS: task JSON planning/trace, CSV workflow, forbidden op rejection, explicit media consent, chat help, no JS page errors')
        browser.close()

if __name__=='__main__':
    main()