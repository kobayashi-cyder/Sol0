"""Confirm multiline Enter editing and explicit send in the bundled app."""
from pathlib import Path
from playwright.sync_api import sync_playwright

HTML=(Path(__file__).resolve().parents[1]/'SolZero_Chat_Offline.html').read_text(encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':390,'height':844},accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda err: errors.append(str(err)))
    page.set_content(HTML,wait_until='load')
    editor=page.locator('#input')
    editor.fill('質問A')
    editor.press('Enter')
    editor.type('質問B')
    assert editor.input_value()=='質問A\n質問B',repr(editor.input_value())
    assert page.locator('.message.user').count()==0,'Enter must insert newline, not submit'
    editor.press('Control+Enter')
    page.locator('.message.user').last.wait_for()
    assert '質問A\n質問B' in page.locator('.message.user').last.inner_text()
    editor.fill('送信ボタン')
    page.locator('#send').click()
    assert '送信ボタン' in page.locator('.message.user').last.inner_text()
    assert not errors,errors
    browser.close()
print('PASS: Enter newline, Ctrl+Enter submit and button submit')
