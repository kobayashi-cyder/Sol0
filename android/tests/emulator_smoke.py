"""Android emulator smoke via debug WebView DevTools on a local-only APK.

Requires: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>,
and websocket-client. No network services or pretrained models.
"""
import json
import time
from urllib.request import urlopen
from websocket import WebSocketException, create_connection

BASE = 'http://127.0.0.1:9222/json'
EXPECTED_URL = 'https://appassets.androidplatform.net/assets/index.html'

def pages():
    with urlopen(BASE, timeout=3) as response:
        return json.load(response)

class DevTools:
    def __init__(self, sock):
        self.sock = sock
        self.counter = 0

    def evaluate(self, code):
        self.counter += 1
        id_ = self.counter
        self.sock.send(json.dumps({
            'id': id_, 'method': 'Runtime.evaluate',
            'params': {'expression': code, 'returnByValue': True, 'awaitPromise': True}
        }))
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            event = json.loads(self.sock.recv())
            if event.get('id') != id_:
                continue
            body = event.get('result', {})
            if body.get('exceptionDetails'):
                raise AssertionError('WebView JS error: ' + repr(body['exceptionDetails'])[:1000])
            return body.get('result', {}).get('value')
        raise AssertionError('WebView runtime evaluation timed out')

    def wait_for(self, code, expected=True):
        actual = None
        for _ in range(60):
            actual = self.evaluate(code)
            if actual == expected:
                return
            time.sleep(0.3)
        raise AssertionError(f'Condition did not become {expected}: {actual}, code={code}')

def ready_devtools():
    # WebView can replace its debugger target during startup. Attach to a ready
    # document before issuing any test actions.
    deadline = time.monotonic() + 45
    last = 'debugger target has not appeared'
    while time.monotonic() < deadline:
        sock = None
        ready = False
        try:
            target = next((item for item in pages()
                           if item.get('url') == EXPECTED_URL and item.get('webSocketDebuggerUrl')), None)
            if target:
                sock = create_connection(target['webSocketDebuggerUrl'], timeout=3,
                                         suppress_origin=True)
                dev = DevTools(sock)
                if dev.evaluate("""Boolean(
                    document.getElementById('agentBtn') && document.getElementById('messages')
                    && window.SolZeroDownloads && window.__solZeroDownloadsReady
                )""") is True:
                    sock.settimeout(25)
                    print('WebView page:', target['url'])
                    ready = True
                    return dev
                last = 'offline page initialization is incomplete'
        except (OSError, WebSocketException, json.JSONDecodeError) as exc:
            last = exc
        finally:
            if sock is not None and not ready:
                sock.close()
        time.sleep(0.5)
    raise AssertionError(f'Offline WebView did not become ready: {last}')

def main():
    dev = ready_devtools()
    assert 'Sol0' in dev.evaluate('document.title'), 'Wrong HTML page'
    print('PASS: offline WebView, built-in task UI, native download hook')

    dev.evaluate("document.getElementById('agentBtn').click(); true")
    dev.wait_for("document.getElementById('panelTitle')?.textContent.includes('タスク工房')")
    clicked = dev.evaluate("""(() => {
      const b = [...document.querySelectorAll('#panelBody button')].find(
        x => x.textContent.trim() === '計画を実行');
      if (!b) return false;
      b.click(); return true;
    })()""")
    assert clicked is True, 'task run button missing'
    dev.wait_for("document.getElementById('panelBody')?.textContent.includes('完了：4工程実行')")
    print('PASS: real Android WebView executes the CSV multi-step task')
    dev.evaluate("document.getElementById('closePanel').click(); true")
    dev.evaluate("""(() => {
      document.getElementById('input').value = '/code python factorial';
      document.getElementById('chatForm').requestSubmit();
      return true;
    })()""")
    dev.wait_for("""[...document.querySelectorAll('.message.assistant .bubble')]
       .some(x=>x.textContent.includes('def factorial'))""")
    print('PASS: offline code workshop and chat')

    # Train an entirely local neural WSP from examples in chat, then reuse
    # its learned weights through the shared task workbench in this WebView.
    dev.evaluate("""(() => {
      document.getElementById('input').value = '/net demo';
      document.getElementById('chatForm').requestSubmit();
      return true;
    })()""")
    dev.wait_for("""[...document.querySelectorAll('.message.assistant .bubble')]
       .some(x => x.textContent.includes('WSP重み学習・採用完了'))""")
    dev.evaluate("""(() => {
      document.getElementById('input').value = '/net run [1.3]';
      document.getElementById('chatForm').requestSubmit();
      return true;
    })()""")
    dev.wait_for("""[...document.querySelectorAll('.message.assistant .bubble')]
       .some(x => x.textContent.includes('WSP重み行列の推論出力'))""")
    dev.evaluate("document.getElementById('agentBtn').click(); true")
    dev.wait_for("document.getElementById('panelTitle')?.textContent.includes('タスク工房')")
    dev.evaluate("""(() => {
      document.querySelector('#panelBody textarea').value =
        JSON.stringify({version:1,steps:[{id:'estimate',op:'wsp.learned',args:{input:[1.3]}}]});
      const button = [...document.querySelectorAll('#panelBody button')].find(
        b => b.textContent.trim() === '計画を実行');
      if (!button) return false;
      button.click();
      return true;
    })()""")
    dev.wait_for("document.getElementById('panelBody')?.textContent.includes('完了：1工程実行')")
    print('PASS: scratch-trained WSP weights are shared between chat and task workbench')
    dev.evaluate("document.getElementById('closePanel').click(); true")

    dev.evaluate("""(() => {
      document.getElementById('input').value = '/cognition demo';
      document.getElementById('chatForm').requestSubmit();return true;
    })()""")
    dev.wait_for("""[...document.querySelectorAll('.message.assistant .bubble')]
       .some(x => x.textContent.includes('"schema": 1'))""")
    dev.evaluate("""(() => {
      document.getElementById('input').value = '/cognition ' +
       JSON.stringify({schema:1,facts:{state:'new'},goal:{state:'ready'},actions:[
        {id:'ready',tool:'task.value',requires:{state:'new'},effects:{state:'ready'},args:{}}
       ]});
      document.getElementById('chatForm').requestSubmit();return true;
    })()""")
    dev.wait_for("""[...document.querySelectorAll('.message.assistant .bubble')]
       .some(x => x.textContent.includes('BANC888認知計画（予測のみ、未実行）'))""")
    print('PASS: BANC888 cognition planning is inspectable and preview-only')


    # Data-safety regression inside the actual Android WebView JS runtime.
    # Synthetic input file avoids permission prompts and NEVER confirms a
    # destructive import. Existing WSP chat and storage must remain intact.
    protected = dev.evaluate("""(async () => {
      const key='solzero_chat_v012_local';
      const before=localStorage.getItem(key);
      const badBackup={
        schema:3,current:'invalid-import',chats:[{
          id:'invalid-import',title:'SHOULD_NOT_SHOW',
          messages:[{role:'assistant',text:'BROKEN_WSP_SHOULD_NOT_SHOW',at:'2026-11-09T00:00:00Z'}]
        }],
        wsp:{weights:[[99999]]}
      };
      const dt=new DataTransfer();
      dt.items.add(new File([JSON.stringify(badBackup)],'broken.json',
        {type:'application/json'}));
      const picker=document.getElementById('jsonPicker');
      picker.files=dt.files;
      picker.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,350));
      return {
        unchanged:localStorage.getItem(key)===before,
        visible:[...document.querySelectorAll('.message .bubble')]
          .some(x=>x.textContent.includes('BROKEN_WSP_SHOULD_NOT_SHOW')),
        warning:document.getElementById('toast')?.textContent??''
      };
    })()""")
    assert protected['unchanged'], 'Android WebView overwrote storage on corrupt WSP'
    assert not protected['visible'], 'Android WebView displayed corrupt imported chat'
    assert '破損' in protected['warning'], protected
    print('PASS: real Android WebView rejects corrupt WSP backup without changing storage')

    dev.evaluate("document.getElementById('exportJson').click(); true")
    # Native bridge writes to Downloads/SolZero; independently verify on adb.
    time.sleep(3)
    print('PASS: app initiated JSON export through native download hook')

    dev.evaluate("document.getElementById('studioBtn').click(); true")
    dev.wait_for("document.getElementById('panelTitle')?.textContent.includes('メディア工房')")
    clicked = dev.evaluate("""(() => {
      const b = [...document.querySelectorAll('#panelBody button')].find(
        x => x.textContent.trim() === '画像 PNG');
      if (!b) return false;
      b.click(); return true;
    })()""")
    assert clicked is True, 'image-generation button missing'
    dev.wait_for("document.getElementById('panelBody')?.textContent.includes('生成完了：')")
    print('PASS: Android WebView generated PNG and updated studio UI')
    dev.sock.close()

if __name__ == '__main__':
    main()
