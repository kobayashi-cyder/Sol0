# Sol0 — 完全オフラインAI実験基盤 (v0.16 開発版)

[元のSolZero](https://github.com/kobayashi-cyder/FFC-FlyFromCodex/tree/main/projects/sol-zero) を独立したアプリとして構築・改良するリポジトリです。ブラウザ向け単体HTMLと、ネットワーク権限なしのAndroid WebView APKを生成できます。

**重要：** 現時点では汎用LLM/AGIではありません。未知質問を自由に推論する能力、自由なコード生成、高品質な学習型画像・音声・動画生成は未実装です。実装済みの機能と未検証の機能を区別します。

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
| チャット | ローカル履歴、教示、検索、計算、タスク管理 | 汎用LLMではない |
| WSP | 数値グラフ、独自重み学習・復元、推論、Python/JS出力 | 数値処理中心 |
| タスク工房 | 許可済みの操作をJSON計画で実行、明示承認 | 自由なOS/ブラウザ操作は未実装 |
| メディア | PNG、WAV、GIF、WebM、ZIP | 手続き型で学習生成ではない |
| 認知計画 | BANC由来の有限探索・予測 | 実世界の副作用は実行しない |
| Android | オフラインWebView・ネイティブダウンロード | デバッグ版、実機互換性未保証 |

## WSP材質画像生成（開発実験）

「メディア工房」の下部で、手元のPNG/JPEG/WebPから肌・石・木・金属・ガラス・水・布・植物の材質を端末内学習し、重みと画像小領域の記憶から平面・球面の表面画像をPNG合成できます。Kimi-VL/K2.5の視覚専門処理を**設計参考**にした独自コードで、外部API・事前学習重みは用いません。**文章からの自由な写実画像生成・人物/風景の意味理解・高品質画像生成は依然未実装**です。学習重みJSONは作品ZIPと別に保管してください。仕組み・制約・評価計画は [WSP材質学習・生成核](docs/WSP_MATERIAL_LAB.md) を参照。

## 移行時の重要修正

- Enterは改行、Ctrl+Enter / Cmd+Enterと送信ボタンが送信。日本語IME変換中は誤送信しない。
- GIFの直接APIにも8秒の時間上限を適用。
- WSPコード出力など長いassistant履歴の復元時切り詰めを修正。assistant本文最大20万文字、user本文3200文字、保存JSON約340万文字の容量制限を維持。
- package.jsonのバージョンを0.16.0へ整合。

## 構造と次の作業

`chat_web/`（UI・JSエンジン）、`solzero/`・`training/`（Python数値モデル）、`scripts/`・`tools/`（ビルド・評価）、`tests/`（回帰試験）、`android/`（APK）。

詳細は[設計](docs/ARCHITECTURE.md)、[ロードマップ](docs/ROADMAP.md)、[テスト基準](docs/TEST_MATRIX.md)、[移行記録](docs/MIGRATION.md)を参照してください。

**保存の注意：** チャットJSONとメディア作品ZIPを別々にバックアップしてください。Androidのデバッグ署名はビルド間で変わり、上書きインストールに失敗する場合があります。新リポジトリのCI・Android17実機試験・品質評価の結果が出るまでは、出荷品質や万能知能の完成を主張しません。
