"""Mobile Chromium media UI smoke on real local origin, including IndexedDB and ZIP."""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright, expect
from browser_server import serve_root

ROOT=Path(__file__).resolve().parents[1]

def run():
    with serve_root(ROOT) as origin, sync_playwright() as playwright:
        system_chromium=which('chromium') or which('chromium-browser')
        browser=playwright.chromium.launch(
            headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'],
            **({'executable_path':system_chromium} if system_chromium else {}))
        context=browser.new_context(viewport={'width':390,'height':820},is_mobile=True,has_touch=True,accept_downloads=True)
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.goto(origin+'SolZero_Chat_Offline.html',wait_until='load')
        page.locator('#studioBtn').click(force=True)
        page.wait_for_timeout(250)
        assert page.locator('#panelTitle').inner_text()=='メディア工房'
        for label in ['画像 PNG','音声 WAV','動画 GIF','音声付き動画 WebM']:
            page.get_by_role('button',name=label,exact=True).click()
            page.wait_for_function("() => document.querySelector('#panelBody .listentry')?.textContent.includes('生成完了：')",timeout=15000)
            page.wait_for_timeout(50)
        assert page.get_by_role('button',name='重みを設定').count()==1
        assert page.locator('#panelBody .listentry').count()>=5
        with page.expect_download() as pending:
            page.get_by_role('button',name='全素材をZIPで書き出し').click()
        assert pending.value.suggested_filename=='SolZero_media_project.zip'
        # A forged central-directory checksum must be refused without deleting
        # previously created media; a verified archive must roundtrip on reload.
        from tempfile import TemporaryDirectory
        from pathlib import Path
        archive_bytes=Path(pending.value.path()).read_bytes()
        before=page.locator('#panelBody .listentry').count()
        with TemporaryDirectory() as temp:
            good=Path(temp)/'good.zip'
            bad=Path(temp)/'corrupt.zip'
            good.write_bytes(archive_bytes)
            forged=bytearray(archive_bytes)
            central=forged.rfind(b'PK\x01\x02')
            assert central!=-1
            forged[central+16]^=1
            bad.write_bytes(forged)
            page.on('dialog',lambda dialog:dialog.accept())
            picker=page.locator('#panelBody input[accept=".zip,application/zip"]')
            picker.set_input_files(str(bad))
            page.wait_for_function("() => document.querySelector('#panelBody .listentry')?.textContent.includes('ZIP復元拒否：')",timeout=10000)
            assert page.locator('#panelBody .listentry').count()==before
            picker.set_input_files(str(good))
            page.wait_for_function("() => document.querySelector('#panelBody .listentry')?.textContent.includes('作品復元完了：')",timeout=10000)
            assert page.locator('#panelBody .listentry').count()==before
        page.reload(wait_until='load')
        page.locator('#studioBtn').click(force=True)
        page.wait_for_function("() => document.querySelector('#panelBody .listentry')?.textContent.includes('準備完了')",timeout=10000)
        assert page.locator('#panelBody .listentry').count()==before

        page.locator('#closePanel').click()
        page.locator('#input').fill('/image 海')
        page.locator('#send').click()
        page.wait_for_function("() => Array.from(document.querySelectorAll('.message.assistant .bubble')).some(e=>e.textContent.includes('生成しました'))",timeout=15000)
        assert '生成しました' in page.locator('.message.assistant .bubble').last.inner_text()
        send_box=page.locator('#send').bounding_box()
        assert send_box and send_box['height']>=44,send_box
        # Recover all offline-only assets once storage becomes available.
        temporary=browser.new_context(viewport={'width':390,'height':820},is_mobile=True,has_touch=True)
        temporary.add_init_script("""(() => {
          if(localStorage.getItem('__idb_available')!=='1'){
            window.__savedIDB=window.indexedDB;
            Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});
          }
        })();""")
        session_page=temporary.new_page()
        session_page.on('pageerror',lambda error:errors.append(str(error)))
        session_page.goto(origin+'SolZero_Chat_Offline.html',wait_until='load')
        session_page.locator('#studioBtn').click(force=True)
        expect(session_page.locator('#panelBody')).to_contain_text('一時保存',timeout=12000)
        for label in ['画像 PNG','音声 WAV']:
            session_page.get_by_role('button',name=label,exact=True).click()
            session_page.wait_for_function("() => document.querySelector('#panelBody .listentry')?.textContent.includes('生成完了：')",timeout=15000)
        assert session_page.locator('#panelBody .listentry b').count()==2
        session_page.evaluate("""() => {
          localStorage.setItem('__idb_available','1');
          Object.defineProperty(window,'indexedDB',{configurable:true,value:window.__savedIDB});
        }""")
        session_page.get_by_role('button',name='動画 GIF',exact=True).click()
        session_page.wait_for_function("() => document.querySelector('#panelBody .listentry')?.textContent.includes('生成完了：')",timeout=15000)
        assert session_page.locator('#panelBody .listentry b').count()==3
        session_page.reload(wait_until='load')
        session_page.locator('#studioBtn').click(force=True)
        session_page.wait_for_function("() => document.querySelectorAll('#panelBody .listentry b').length===3",timeout=15000)
        assert 'IndexedDB' in session_page.locator('#panelBody').inner_text()
        # Invalid localStorage recipes must be ignored, not crash the whole studio.
        session_page.evaluate("""() => localStorage.setItem('solzero_studio_v012_recipe',
          JSON.stringify({theme:'not-a-theme',frames:9999999,kind:'robot'}))""")
        session_page.reload(wait_until='load')
        session_page.locator('#studioBtn').click(force=True)
        assert session_page.locator('#panelBody .listentry b').count()==3
        session_page.get_by_role('button',name='指定からプレビュー').click()
        temporary.close()
        assert not errors,errors
        print('PASS: local-origin PNG/WAV/GIF/WebM + ZIP + WSP controls + mobile touch UI')
        browser.close()

if __name__=='__main__':
    run()
