# Sol0 アーキテクチャ

## 実行系

- `chat_web/index.html` と `chat_web/app.js`：画面、会話、バックアップ、入力、localStorage保存。
- `chat_web/engine.js`・`learned_router.js`・`bigram.js`：ルールと独自分類器に基づく応答。
- `chat_web/inference_gateway.js`：ブラウザに任意接続するOpenAI互換LLMアダプター、ユーザー同意、送信先オリジン制限、入力/出力サイズ制限。既定はWSPで通信なし。
- `wsp_graph.js`・`wsp_induction.js`・`wsp_neural.js`・`wsp_codegen.js`：数値WSPの実行・独立評価・重み学習・コード変換。
- `task_agent.js`：許可済み処理だけを実行する検証型タスク工房。
- `media_studio.js`・`media_ui.js`：手続き的なPNG/WAV/GIF/WebM/ZIP作成。
- `banc_cognition.js`：BANC由来の有限探索計画を副作用なしで検証。
- `solzero/`・`training/`：Python数値モデルと学習/評価。
- `scripts/build_standalone.py`：ソースを1ファイルHTMLへ結合。
- `android/`：ローカルHTMLをアセットに含むAndroid WebViewとダウンロード橋渡し。

## 制限・セキュリティ境界

- AndroidはINTERNET権限なし。モデルや外部APIに依存しない実験基盤。ブラウザだけで明示的に選べるLLM接続はAndroidから利用できない。
- 履歴読み込み: スキーマ1/2/3を許可。会話40件/会話400メッセージ、入力JSON上限400万文字、保存JSONは約340万文字上限。
- 個々の復元上限: user本文3200文字、assistant本文20万文字。大きなコード出力を復元する一方、総保存容量の制限は維持。
- メディア生成はJavaScriptで制限付き実行、GIFは最大8秒。タスク工房のメディア生成には明示承認が必要。
- Android APKは検証用デバッグ署名。秘密鍵や認証情報を公開リポジトリに置かない。

## ビルドの流れ

`chat_web/` → `scripts/build_standalone.py` → `SolZero_Chat_Offline.html` → Androidアセット `index.html` → APK。CIはHTMLの再生成一致・JavaScript・Python・ブラウザ・Androidの各段階を独立検査します。

## 責務の区別

この構成は任意質問の自由推論を保証しません。数値WSP学習は大規模言語モデルではなく、有限探索計画はOS自律操作ではなく、手続きメディア作成は学習済み画像/音声/動画生成モデルではありません。
