# Sol0 — ComfyUIによる写実画像生成（PCブラウザ限定・明示同意）

## 概要

既定のSol0はオフラインの手続き型画像描画を維持する。今回追加したComfyUI経路は、ユーザーが同じPCで別途起動・モデルをロードしたComfyUIへ、明示的な承認後にのみ1枚のPNG生成を依頼する。生成モデルの重み・APIキーはSol0へ同梱しない。

Scene Directorは猫・ロボット・左右・色・光などを英語の補助プロンプトへ変換し、元の日本語指定とともにComfyUIへ送信する。写実品質や構図の正確さはインストール済みチェックポイントに依存する。

## 起動手順

ComfyUI本体と互換チェックポイントを利用者が自分で用意し、ComfyUI/models/checkpoints 内へ配置する。初期対応はSD1.5/SDXLなど単一チェックポイント型の標準ノードワークフロー。FLUX系など専用ノードが必要なモデルでは動かない場合がある。

ComfyUIとSol0を同じPCで別ターミナルから起動する。

~~~sh
cd /path/to/ComfyUI
python main.py --listen 127.0.0.1 --port 8188 \
  --enable-cors-header http://127.0.0.1:8765
~~~

~~~sh
cd /path/to/Sol0
python -m http.server 8765 --bind 127.0.0.1
~~~

http://127.0.0.1:8765/SolZero_Chat_Offline.html をブラウザで開く。file://で直接開く場合はブラウザoriginがnullになり、上記の制限付きCORSでは動かない。ComfyUIのCORS許可はSol0の正確なoriginのみを指定し、ワイルドカード*やLAN全体への公開を避ける。

メディア工房で以下を操作する。

1. ComfyUI接続先： http://127.0.0.1:8188
2. モデル名： ComfyUIのcheckpointsに設置した正確なファイル名（例：example.safetensors。モデルが実在するという意味ではない）
3. steps、CFG、sampler、scheduler、negative promptを設定し、接続確認をクリックする（推論成功の保証ではない）
4. プロンプトを記入し、写実画像 ComfyUI（毎回確認）を押す。表示されたURL・モデル名を確認して承認する
5. 成功したPNGは従来の作品一覧・保存ボタン・IndexedDB・ZIPへ入る。失敗時は元の作品を保持する

接続失敗時の通常描画への切替は、専用チェック欄を利用者が明示的に選んだ場合に限る。既定は無効で、問題がある場合は失敗理由を表示する。

## 保護と限界

- 接続先は127.0.0.1・localhostのみ。HTTPのループバック以外、認証情報付きURL、パスやクエリ付きURL、リダイレクトは拒否。CookieやAuthorizationは送らない
- GET /system_statsで接続を確認し、POST /prompt、GET /history/{prompt_id}、GET /view のComfyUI標準APIを使う
- SaveImageの1枚のPNGのみを取得する。22MB・幅高さ1024px以内、指定サイズとの一致をチェックしてからIndexedDBへ保存
- 生成待機は最大5分の構成上限（UIでは3分）。タイムアウトしたComfyUI側のキューをSol0から自動削除しない
- チェックポイント名・接続URL・負のプロンプト等のComfyUI設定はlocalStorageに保存しない。再起動で既定のローカル設定に戻る
- Android APKにはINTERNET権限がなく、本機能はPCのブラウザ専用。Android上の127.0.0.1はPCを指さない
- PNG/GIF/WebMは従来の手続き生成も引き続き動作し、GIFの最大8秒など上限に変更はない
- ComfyUI実モデル/GPUによる写真品質のE2Eは未検証。CIはローカルComfyUIモックAPIと本当にエンコードしたPNGによる経路試験であり、モデル品質評価ではない

ユーザーのプロンプトや生成画像はComfyUI側でキュー履歴・出力フォルダーに残る可能性がある。信頼できるモデル・カスタムノードのみを使用し、秘密情報を含む入力は避ける。
