"""No-network browser smoke test. Uses page.set_content because sandbox blocks file: navigation.
The mocked storage tests the app's persistence wiring; it is not proof of every browser's file: storage policy.
"""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'SolZero_Chat_Offline.html').read_text(encoding='utf-8')
INIT_STORAGE = """() => {
  const store = {};
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    getItem(k){ return Object.hasOwn(store,k)?store[k]:null; },
    setItem(k,v){ store[k]=String(v); },
    removeItem(k){ delete store[k]; },
    clear(){ for(const k of Object.keys(store))delete store[k]; }
  }});
  return true;
}"""

def main():
  with sync_playwright() as pw:
    system_chromium=which('chromium') or which('chromium-browser')
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],
                               **({'executable_path':system_chromium} if system_chromium else {}))
    page=browser.new_page(viewport={'width':390,'height':844},accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda err: errors.append(str(err)))
    assert page.evaluate(INIT_STORAGE)
    old={'schema':3,'chats':[{'id':'carry','title':'以前の会話','created':'2026-11-06T00:00:00Z','messages':[{'role':'user','text':'旧データは残ります','at':'2026-11-06T00:00:00Z'}]}], 'current':'carry','knowledge':[],'documents':[],'theme':'light'}
    page.evaluate('x=>localStorage.setItem("solzero_chat_v010_local",JSON.stringify(x))',old)
    page.set_content(HTML,wait_until='load')
    assert 'Sol-Zero' in page.title()
    expect(page.get_by_text('旧データは残ります')).to_have_count(1,timeout=12000)
    page.get_by_role('button',name='帰納WSP',exact=True).click()
    page.get_by_role('button',name='① 候補回路を合成して独立検証').click()
    report=page.locator('#panelBody .listentry').last.inner_text()
    assert '未使用評価 5/5' in report,report
    page.get_by_role('button',name='② 合格回路だけ採用').click()
    applied=page.locator('#panelBody .listentry').last.inner_text()
    assert '端末へ保存済み' in applied,applied
    page.get_by_role('button',name='現在の回路を実行').click()
    assert '"out":[13]' in page.locator('#panelBody .listentry').last.inner_text()
    # Re-render in the same controlled-origin page to verify state is rehydrated.
    page.set_content(HTML,wait_until='load')
    page.locator('#input').fill('/induce 2,3')
    page.locator('#chatForm button[type="submit"]').click()
    assert '数値出力：13' in page.locator('.message.assistant .bubble').last.inner_text()
    assert page.get_by_text('旧データは残ります').count()==1
    page.get_by_role('button',name='帰納WSP',exact=True).click()
    page.get_by_role('button',name='採用前の回路へ戻す').click()
    result=page.locator('#panelBody .listentry').last.inner_text()
    assert '前の回路へ復元' in result,result
    page.get_by_role('button',name='閉じる').click()
    page.locator('#input').fill('/induce 1,0')
    page.locator('#chatForm button[type="submit"]').click()
    assert '数値出力：1' in page.locator('.message.assistant .bubble').last.inner_text()
    # WSP trained from scratch must remain usable after a real UI reload,
    # then be callable through the same weights from the task workbench.
    page.locator('#input').fill('/net demo')
    page.locator('#chatForm button[type="submit"]').click()
    expect(page.locator('.message.assistant .bubble').last).to_contain_text(
        'WSP重み学習・採用完了',timeout=30000)
    saved=page.evaluate("""() => JSON.parse(
      localStorage.getItem('solzero_chat_v012_local')).neural""")
    assert saved and len(saved['w1'])>0 and len(saved['w2'])>0
    page.set_content(HTML,wait_until='load')
    page.locator('#input').fill('/net run [1.3]')
    page.locator('#chatForm button[type="submit"]').click()
    expect(page.locator('.message.assistant .bubble').last).to_contain_text(
        'WSP重み行列の推論出力',timeout=12000)
    page.get_by_role('button',name='タスク工房').first.click()
    page.locator('#panelBody select').select_option(label='学習WSP推論（/net demo後）')
    page.get_by_role('button',name='計画を実行').click()
    expect(page.locator('#panelBody .listentry').last).to_contain_text(
        '完了：2工程実行',timeout=12000)
    # BANC888 cognition is a preview-only optional layer: no hidden tool call.
    page.get_by_role('button',name='閉じる').click()
    page.locator('#input').fill('/cognition demo')
    page.locator('#chatForm button[type="submit"]').click()
    expect(page.locator('.message.assistant .bubble').last).to_contain_text('"schema": 1')
    page.locator('#input').fill('/cognition {"schema":1,"facts":{"state":"new"},"goal":{"state":"ready"},"actions":[{"id":"prepare","tool":"task.value","requires":{"state":"new"},"effects":{"state":"ready"},"args":{}}]}')
    page.locator('#chatForm button[type="submit"]').click()
    expect(page.locator('.message.assistant .bubble').last).to_contain_text(
        'BANC888認知計画（予測のみ、未実行）')
    expect(page.locator('.message.assistant .bubble').last).to_contain_text('"status":"planned"')
    page.get_by_role('button',name='タスク工房').first.click()
    page.locator('#panelBody select').select_option(label='BANC認知計画（実行せず検証）')
    page.get_by_role('button',name='計画を実行').click()
    expect(page.locator('#panelBody .listentry').last).to_contain_text(
        '完了：1工程実行',timeout=12000)
    assert '予測のみ・未実行' in page.locator('#panelBody .listentry').last.inner_text()
    assert not errors,errors
    print('PASS: migration, WSP training/persistence/task reuse, BANC cognition preview, no JS errors')
    browser.close()

if __name__=='__main__':
  main()
