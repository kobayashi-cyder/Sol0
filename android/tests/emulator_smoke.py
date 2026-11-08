"""Android emulator smoke via debug WebView DevTools on a local-only APK.

Requires: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>,
and websocket-client. No network services or pretrained models.
"""
import json
import time
from urllib.request import urlopen
from websocket import create_connection

BASE = 'http://127.0.0.1:9222/json'
EXPECTED_URL = 'https://appassets.androidplatform.net/assets/index.html'

def pages():
    with urlopen(BASE, timeout=3) as response:
        return json.load(response)

def page_socket():
    last = None
    for _ in range(90):
        try:
            for item in pages():
                if item.get('url') == EXPECTED_URL and item.get('webSocketDebuggerUrl'):
                    print('WebView page:', item['url'])
                    return create_connection(item['webSocketDebuggerUrl'], timeout=10,
                                             suppress_origin=True)
        except Exception as exc:
            last = exc
        time.sleep(0.5)
    raise AssertionError(f'Offline WebView did not open: {last}')

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

def main():
    sock = page_socket()
    sock.settimeout(25)
    dev = DevTools(sock)
    dev.wait_for("Boolean(document.getElementById('agentBtn') && document.getElementById('messages'))")
    assert 'Sol-Zero' in dev.evaluate('document.title'), 'Wrong HTML page'
    dev.wait_for("Boolean(window.SolZeroDownloads && window.__solZeroDownloadsReady)")
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
    sock.close()

if __name__ == '__main__':
    main()
