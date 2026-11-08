package jp.solzero.offline;

import android.app.Activity;
import android.content.Intent;
import android.annotation.SuppressLint;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.LinearLayout;
import android.widget.Toast;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import java.io.ByteArrayInputStream;

public final class MainActivity extends Activity {
    private static final String LOCAL_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + LOCAL_HOST + "/assets/index.html";
    private WebView webView;
    private static final int FILE_REQUEST = 5162;
    private ValueCallback<Uri[]> pendingFiles;
    private long backRequestedAt = 0;

    // Attach only to the trusted bundled HTML. Do not grant Android file or
    // network permissions. The JS bridge is never exposed to remote pages.
    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(248, 250, 252));
        getWindow().setNavigationBarColor(Color.BLACK);

        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        container.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(container);

        if (Build.VERSION.SDK_INT >= 35) {
            container.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                container.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            container.requestApplyInsets();
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSafeBrowsingEnabled(true);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(LOCAL_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme()) && LOCAL_HOST.equals(url.getHost())) {
                    WebResourceResponse response = loader.shouldInterceptRequest(url);
                    return response != null ? response : denied();
                }
                return denied();
            }
            @Override public boolean shouldOverrideUrlLoading(
                    WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return !("https".equals(u.getScheme())
                        && LOCAL_HOST.equals(u.getHost())
                        && u.getPath() != null && u.getPath().startsWith("/assets/"));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (APP_URL.equals(url)) view.evaluateJavascript(NativeDownloadScript.CODE, null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(
                    WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_REQUEST);
                    return true;
                } catch (Exception error) {
                    pendingFiles.onReceiveValue(null);
                    pendingFiles = null;
                    Toast.makeText(MainActivity.this,
                            "ファイル選択ができません", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        webView.addJavascriptInterface(new DownloadBridge(this), "SolZeroDownloads");
        webView.loadUrl(APP_URL);
    }

    private static WebResourceResponse denied() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                java.util.Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream(new byte[0]));
    }

    @Override @Deprecated protected void onActivityResult(
            int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST && pendingFiles != null) {
            pendingFiles.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingFiles = null;
        }
    }

    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
    }

    @Override @Deprecated public void onBackPressed() {
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript(
                "(()=>{let p=document.getElementById('panel');" +
                "if(p&&!p.classList.contains('hidden')){" +
                "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;}" +
                "return false;})()", result -> {
                    if ("true".equals(result)) return;
                    if (webView.canGoBack()) { webView.goBack(); return; }
                    if (System.currentTimeMillis() - backRequestedAt < 2200) {
                        MainActivity.super.onBackPressed();
                    } else {
                        backRequestedAt = System.currentTimeMillis();
                        Toast.makeText(this, "もう一度戻ると終了します", Toast.LENGTH_SHORT).show();
                    }
                });
    }

    @Override protected void onDestroy() {
        if (pendingFiles != null) {
            pendingFiles.onReceiveValue(null);
            pendingFiles = null;
        }
        if (webView != null) {
            ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
