"""Browser integration regression for explicit, mock-only LLM routing.

Uses a stubbed fetch. No actual model traffic or credentials are involved.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

HTML = (Path(__file__).resolve().parents[1] / "SolZero_Chat_Offline.html").read_text(encoding="utf-8")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_content(HTML, wait_until="load")
    page.evaluate("""() => {
      window.__modelFetchCalls = [];
      window.fetch = async (url, options) => {
        window.__modelFetchCalls.push({
          url, body: JSON.parse(options.body),
          credentials: options.credentials,
          redirect: options.redirect
        });
        return new Response(
          JSON.stringify({choices:[{message:{content:'模擬モデル応答'}}]}),
          {status:200,headers:{'Content-Type':'application/json'}}
        );
      };
    }""")

    editor = page.locator("#input")
    assert page.locator("#inferenceMode").input_value() == "local"
    assert "未設定" in page.locator("#modelStatus").inner_text()
    editor.fill("以前のWSP履歴")
    page.locator("#send").click()
    page.locator(".message.assistant").last.wait_for()
    assert "以前のWSP履歴" in page.locator(".message.user").last.inner_text()
    assert page.evaluate("window.__modelFetchCalls.length") == 0

    # Configuring does not itself contact a server or persist credentials.
    page.locator("#modelSettings").click()
    settings = page.locator("#panelBody input")
    assert settings.count() == 4
    settings.nth(0).fill("http://127.0.0.1:1234/v1/chat/completions")
    settings.nth(1).fill("mock-model")
    settings.nth(2).fill("user-managed")
    settings.nth(3).fill("license-checked-by-user")
    page.get_by_role("button", name="接続設定を有効にする").click()
    assert page.locator("#inferenceMode").input_value() == "remote"
    assert "通信未検証" in page.locator("#modelStatus").inner_text()
    page.locator("#closePanel").click()
    assert page.evaluate("window.__modelFetchCalls.length") == 0

    confirmation = {"accept": False, "count": 0, "message": ""}
    def on_dialog(dialog):
        confirmation["count"] += 1
        confirmation["message"] = dialog.message
        if confirmation["accept"]:
            dialog.accept()
        else:
            dialog.dismiss()
    page.on("dialog", on_dialog)

    # Cancelling consent retains the draft and makes zero HTTP requests.
    editor.fill("モデルへの質問")
    page.locator("#send").click()
    assert confirmation["count"] == 1
    assert "127.0.0.1" in confirmation["message"]
    assert editor.input_value() == "モデルへの質問"
    assert page.evaluate("window.__modelFetchCalls.length") == 0

    confirmation["accept"] = True
    page.locator("#send").click()
    page.wait_for_function("document.querySelector('#send').disabled === false")
    page.get_by_text("模擬モデル応答", exact=False).wait_for()
    calls = page.evaluate("window.__modelFetchCalls")
    assert len(calls) == 1, calls
    assert calls[0]["url"] == "http://127.0.0.1:1234/v1/chat/completions"
    assert calls[0]["credentials"] == "omit"
    assert calls[0]["redirect"] == "error"
    assert calls[0]["body"]["messages"] == [{"role":"user","content":"モデルへの質問"}]
    assert "以前のWSP履歴" not in str(calls[0]["body"])
    assert "模擬モデル応答" in page.locator(".message.assistant").last.inner_text()

    # Slash commands still go to the local deterministic command handler.
    editor.fill("/help")
    page.locator("#send").click()
    page.locator(".message.assistant").last.wait_for()
    assert page.evaluate("window.__modelFetchCalls.length") == 1

    # Returning to WSP needs no server and must preserve old input semantics.
    page.locator("#inferenceMode").select_option("local")
    editor.fill("ローカルへ戻す")
    editor.press("Enter")
    assert "\n" in editor.input_value()
    editor.fill("ローカルへ戻す")
    page.locator("#send").click()
    assert page.evaluate("window.__modelFetchCalls.length") == 1

    # A fresh page has no remembered model endpoint or remote selection.
    page.set_content(HTML, wait_until="load")
    assert page.locator("#inferenceMode").input_value() == "local"
    assert "LLM未設定" in page.locator("#modelStatus").inner_text()
    assert not errors, errors
    browser.close()

print("PASS: model setup is opt-in, every remote send needs consent, and WSP stays default")
