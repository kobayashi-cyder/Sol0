# Sol0 Android Offline Lab

Sol0の `SolZero_Chat_Offline.html` を内蔵したオフラインWebView APKです。外部LLM/APIを利用せず、INTERNET権限を要求しません。

## ビルド方法

JDK17、Gradle8.9、Android SDK Platform 35とBuild Tools 35.0.0が必要です。

```bash
python scripts/build_standalone.py
gradle --no-daemon -p android :app:testDebugUnitTest :app:assembleDebug
```

ビルドしたAPK：`android/app/build/outputs/apk/debug/app-debug.apk`。

## CI / 配布

GitHub Actions `.github/workflows/android.yml` でAndroid単体テスト、APK生成、署名とZIP整列、パッケージIDの検証、INTERNET権限不在、内蔵HTMLのSHA256一致、Android15エミュレータでの操作を検証します。成功したビルドの `Artifacts` から検証用APKを取得します。

## 利用上の注意

- 固定パッケージID：`jp.solzero.offline`、Android10（API29）以上を想定。
- Android17の実機確認、アクセシビリティ、WebView録画やダウンロードの端末互換は別途試験してください。
- debug APKの署名鍵は実行環境によって変わります。上書き更新が失敗する可能性があります。
- アプリ削除の前にチャット履歴JSONとメディア作品ZIPを保存してください。
- 他アプリの自動操作、外部ネット検索、汎用LLM、実写級メディア生成は実装していません。
