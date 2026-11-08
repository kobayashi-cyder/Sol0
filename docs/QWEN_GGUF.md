# Sol0: Qwen GGUFローカル推論（実験段階）

## 実装範囲

Sol0に追加したのは、**Qwen GGUFのバイト列を検査し、ローカルのQwen推論環境を起動し、Sol0チャットに接続する仕組み**です。

- Qwenの学習済み重みをソースに含めず、モデルダウンロードもしません。
- **LM Studioは不要**です。一方、Attention/トークナイザー/量子化テンソル演算などの実推論は、利用者が用意する[llama.cpp](https://github.com/ggml-org/llama.cpp)のllama-serverが担当します。Sol0独自の完全なテンソル推論エンジンは未実装です。
- 利用可能なのはモデルのテキスト能力（会話、翻訳、要約、コード補助など）の範囲。品質や再現性は未評価で、モデルにない能力を付与することはできません。
- 既存WSPは変更せず、既定のチャットはオフライン・外部通信なし。Android APKに通信権限は追加しません。

## 必要なもの

PCにNode.js 22以上、[llama.cpp](https://github.com/ggml-org/llama.cpp)のllama-server実行ファイル、ユーザーが入手したQwen GGUFファイルが必要です。例：[Qwen/Qwen3-0.6B-GGUF](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF)。

モデルの出典・ライセンスは配布元で確認します。モデルファイルをGitにコミットしないでください。

## 実行

この機能は既存の外部LLM接続UI（PR #1）をベースにした開発ブランチで提供します。

~~~sh
git clone https://github.com/kobayashi-cyder/Sol0.git
cd Sol0
git fetch origin feat/qwen-gguf-local-runner-20261109
git switch --track origin/feat/qwen-gguf-local-runner-20261109
node tools/qwen_local.mjs --help
~~~

実際のファイルパスに置き換えて起動します。

~~~sh
node tools/qwen_local.mjs --model=/path/to/Qwen3-0.6B-Q4_K_M.gguf
~~~

llama-serverがPATHにない場合は実行ファイルを指定できます。

~~~sh
node tools/qwen_local.mjs \
  --model=/path/to/Qwen3-0.6B-Q4_K_M.gguf \
  --runner=/path/to/llama-server
~~~

オプションで完全なモデルファイルのSHA256を比較できます。正しい値は配布元で確認してください。

~~~sh
node tools/qwen_local.mjs --model=/path/to/model.gguf --sha256=64桁の16進数
~~~

## Sol0側の設定

起動コマンドで次のローカルアドレスを使います。

| 項目 | 値 |
|---|---|
| Sol0ブラウザ画面 | http://127.0.0.1:8765/SolZero_Chat_Offline.html |
| LLM接続先 | http://127.0.0.1:9931/v1/chat/completions |
| モデルID | sol0-qwen |

Sol0で「LLM接続設定」を開き、接続先・モデルIDを入力し、モデル出典とライセンスには確認した内容を入力します。「外部LLM（毎回確認）」を選び、質問送信時に接続先を確認して許可してください。llama-serverが実際にモデルをロードできることが前提です。

## 実装上の制限

- GGUF v2/v3のメタデータの一部を読み取り、Qwenアーキテクチャ（qwen2、qwen3、qwen3moe）か判別します。最大48MiBのヘッダーしか読みません。モデル重みの完全な妥当性は保証しません。
- SHA256を明示した場合のみファイル全体をハッシュ照合します。ハッシュ一致もモデルの出典・安全性・偏向を保証しません。
- llama-serverを127.0.0.1に限定し、--offline、--no-webui、Sol0オリジンだけのCORSを指定します。モデル本体や任意ファイルをHTTP配信しません。
- モデルは別途ダウンロード・配置・ライセンス確認が必要。プログラムが自動取得することはありません。
- 既存のUIは現在の質問文のみ送信し、履歴・資料を自動送信しません。承認前はリクエストしません。
- 信頼できるPC上でのみ起動してください。同一PCの他プログラムからのローカルHTTPアクセスを完全には隔離できません。
- Android APKはINTERNET権限なしのため本経路は利用不可。Android実機推論は未実装・未検証です。
- 実GGUF、実llama-server、実端末を使ったEnd-to-End推論はまだ未検証です。テストは合成GGUFと模擬プロセスが中心です。

## テスト

~~~sh
node --test tests/qwen_gguf.test.mjs
npm test
~~~

ブラウザ側の外部送信動作は既存のscripts/browser_model_smoke.pyがモックで検証します。実モデルの品質・速度・バイアスは別途検証が必要です。

完全なSol0独自テンソル推論エンジンにするには、QwenのTransformer、量子化テンソル演算、KVキャッシュ、トークナイザーを再実装し、参照実装と一致を検証する工程が残ります。
