# Sol0 — オフライン優先AI実験基盤 (v0.16 開発版)

[元のSolZero](https://github.com/kobayashi-cyder/FFC-FlyFromCodex/tree/main/projects/sol-zero) を独立したアプリとして構築・改良するリポジトリです。ブラウザ向け単体HTMLと、ネットワーク権限なしのAndroid WebView APKを生成できます。ブラウザでは利用者が指定したOpenAI互換LLMへ、明示確認後の任意接続もできます（既定は完全オフライン）。

**重要：** 同梱エンジン自体は汎用LLM/AGIではありません。別途用意したLLMとの通信は可能ですが、モデル自体は含みません。未知質問を自由に推論する能力、自由なコード生成、高品質な学習型画像・音声・動画生成は未実装です。実装済みの機能と未検証の機能を区別します。

## 実行

- **今すぐ試す：** [SolZero_Chat_Offline.html](SolZero_Chat_Offline.html) をローカルブラウザで開く（端末の保存・録画対応に制限あり）。
- **開発用：** `python scripts/browser_server.py` でローカル配信。
- **Nodeテスト：** `npm test`（Node 22推奨）。
- **Pythonテスト：** `python -m pytest -q tests/test_weight_store.py`（pytestが必要）。
- **単体HTML生成：** `python scripts/build_standalone.py`。
- **Android APK：** JDK17 / Gradle8.9 / Android SDK35を用意し、`gradle --no-daemon -p android :app:testDebugUnitTest :app:assembleDebug`。
- **GitHub Actions：** [オフラインCI](.github/workflows/ci.yml) / [Android APK CI](.github/workflows/android.yml)。成功したAndroidビルドのArtifactsからデバッグAPKを取得できます。

## 主な実装

| 領域 | 実装内容 | 制約 |
|---|---|---|
| チャット | ローカル履歴、教示、検索、計算、タスク管理 | 同梱エンジンは汎用LLMではない |\n| 外部LLM（任意） | ブラウザUIからOpenAI互換推論サーバーに明示送信 | サーバーとモデルは利用者が別途準備、Android APKは非対応 |
| WSP | 数値グラフ、独自重み学習・復元、推論、Python/JS出力 | 数値処理中心 |
| タスク工房 | 許可済みの操作をJSON計画で実行、明示承認 | 自由なOS/ブラウザ操作は未実装 |
| メディア | PNG、WAV、GIF、WebM、ZIP | 手続き型で学習生成ではない |
| 認知計画 | BANC由来の有限探索・予測 | 実世界の副作用は実行しない |
| Android | オフラインWebView・ネイティブダウンロード | デバッグ版、実機互換性未保証 |

## ブラウザから任意のLLMを接続\n\n既定の「WSP（オフライン）」では通信しません。「LLM接続設定」で推論サーバーのURL、モデルID、入手元、ライセンスを指定し、「外部LLM（毎回確認）」に切り替えます。送信先を確認したときだけ現在の入力文を送信します。履歴・資料は自動送信せず、設定は再読込で消去。端末内モデルを自動インストールしたり、APIキーを保存したりしません。\n\n動作には利用者側のOpenAI互換LLMサーバーとブラウザCORS設定が必要です。詳しくは[推論接続と監査](docs/MODEL_INFERENCE.md)をご覧ください。\n\n## 移行時の重要修正

- Enterは改行、Ctrl+Enter / Cmd+Enterと送信ボタンが送信。日本語IME変換中は誤送信しない。
- GIFの直接APIにも8秒の時間上限を適用。
- WSPコード出力など長いassistant履歴の復元時切り詰めを修正。assistant本文最大20万文字、user本文3200文字、保存JSON約340万文字の容量制限を維持。
- package.jsonのバージョンを0.16.0へ整合。

## 構造と次の作業

`chat_web/`（UI・JSエンジン）、`solzero/`・`training/`（Python数値モデル）、`scripts/`・`tools/`（ビルド・評価）、`tests/`（回帰試験）、`android/`（APK）。

詳細は[設計](docs/ARCHITECTURE.md)、[ロードマップ](docs/ROADMAP.md)、[テスト基準](docs/TEST_MATRIX.md)、[移行記録](docs/MIGRATION.md)を参照してください。

**保存の注意：** チャットJSONとメディア作品ZIPを別々にバックアップしてください。Androidのデバッグ署名はビルド間で変わり、上書きインストールに失敗する場合があります。新リポジトリのCI・Android17実機試験・品質評価の結果が出るまでは、出荷品質や万能知能の完成を主張しません。
