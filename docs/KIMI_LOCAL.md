# Sol0でQwenとKimiの公開重みを利用する（実験段階）

2026-11-09。正本は kobayashi-cyder/Sol0。親PRはQwen GGUF #4、その親は任意LLM接続UI #1。**両方ともまだmain未統合**。

## 実装範囲

- Qwen: ローカルGGUFをSol0がバイト列として読み、ヘッダーのアーキテクチャを確認、任意のSHA256照合後、ユーザーが別途用意したllama.cppのllama-serverをオフライン・ループバック起動する。
- Kimi: ローカルsafetensorsのヘッダーと全シャードの存在を検査し、config.jsonのモデル種別を判定、ユーザーが別途用意したvLLMをオフライン・ループバック起動する。
- 両モデルともSol0の既存ブラウザUIからOpenAI互換チャットAPIで利用できる。QwenとKimiのモデルファイル、実行バイナリ、GPUは利用者が準備する。LM Studioは不要。
- **Sol0独自のTransformer演算やKimiの重み自体は移植していない。** 使用する能力は公開重みを別途起動した推論ランタイムが提供するテキスト生成。実際の性能評価には実モデルの読み込みと応答の記録が必要。

## どのKimiモデルを使うか

| モデル | 公式構成 | この経路の使い道と制約 |
|---|---|---|
| Kimi-VL-A3B-Instruct | kimi_vl、16B総/3B稼働、重み約32.8GB | Kimiの比較的小さい構成。vLLMと対応GPUが必要。Sol0側は今はテキストのみ送信。画像理解は未接続 |
| Kimi-Linear-48B-A3B-Instruct | kimi_linear、48B総/3B稼働 | vLLMと対応GPU、モデル固有のバージョン要件が必要 |
| Kimi-Dev-72B | qwen2、72B、配布物約145GB | 明示的な --family=kimi-dev が必要。ベースQwen2.5のライセンス条件も確認 |
| Kimi-K2-Instruct | kimi_k2、総約1兆 | 大規模GPU構成向け。個人PCでの動作は保証しない |
| Kimi-K2.5 | kimi_k25、総約1兆 | マルチモーダル。Sol0の現在の経路はテキストのみ。実機互換は未検証 |

配布元：
- https://huggingface.co/moonshotai/Kimi-VL-A3B-Instruct
- https://huggingface.co/moonshotai/Kimi-Linear-48B-A3B-Instruct
- https://huggingface.co/moonshotai/Kimi-Dev-72B
- https://huggingface.co/moonshotai/Kimi-K2-Instruct
- https://huggingface.co/moonshotai/Kimi-K2.5
- https://github.com/MoonshotAI/Kimi-VL

Kimi-VL/LinearのライセンスとKimi-K2系のModified MIT、Kimi-DevのベースとなるQwen LICENSE AGREEMENTは**モデルごとに異なる**。独立して配布条件を確認する。単純に「Kimi全体はMIT」とは扱わない。

## 起動手順

必要なもの：Node.js 22以上、vLLMが実行可能なPC/Linux/GPU、完全に取得済みの対応Kimi safetensorsディレクトリ。配布元から手動でダウンロードし、Gitへ入れない。

~~~sh
git clone https://github.com/kobayashi-cyder/Sol0.git
cd Sol0
git fetch origin feat/kimi-local-vllm-20261109
git switch --track origin/feat/kimi-local-vllm-20261109
node tools/kimi_local.mjs --help
~~~

Kimi-VL-A3B-Instructの実行例。モデル配布元のPythonコードが必要な場合のみ、**内容を確認したうえで** --allow-model-code を明示する。ソースコードの実行をサンドボックス化するものではない。

~~~sh
node tools/kimi_local.mjs \
  --model-dir=/path/to/Kimi-VL-A3B-Instruct \
  --allow-model-code
~~~

vLLMの実行ファイルがPATHになければ --runner=/path/to/vllm、複数GPUを使用するなら --tensor-parallel-size=N を指定する。Kimi-Devは --family=kimi-dev を付ける。

**重要**：Kimi-VL公式のvLLM実行例も --trust-remote-code を使用する。本ツールはそのフラグを暗黙で付けず、--allow-model-code が明示された場合のみ渡す。trusted codeの取り扱いと依存バージョンは自分で監査する。

## 必要に応じたモデル全シャードSHA256照合

配布元の正しいリビジョンで公表された**各safetensorsシャードのSHA256**を確認し、ローカルのmanifestを作れます。ファイル名はダウンロードした実ファイルと一致させてください。

~~~json
{
  "version": 1,
  "files": {
    "model-00001-of-00007.safetensors": "ここに配布元で確認したSHA256を64桁の小文字16進数で記載"
  }
}
~~~

この例は説明用です。実際に起動するときは**全シャードを漏れなく記載**してください。モデルを改変・欠損させた場合やハッシュが一致しない場合は推論サーバーを起動しません。ハッシュ計算はモデル全ファイルをストリームで読むため、時間がかかります。

~~~sh
node tools/kimi_local.mjs \
  --model-dir=/path/to/Kimi-VL-A3B-Instruct \
  --allow-model-code \
  --sha256-manifest=/path/to/verified-shards.json
~~~

照合できるのは**ローカルバイト列と自分で用意したmanifestの一致**であり、そのmanifestの由来・署名、モデルの安全性、ライセンスや偏向を自動保証しません。

## Sol0への接続

| 項目 | 設定値 |
|---|---|
| Sol0画面 | http://127.0.0.1:8766/SolZero_Chat_Offline.html |
| Kimi接続先 | http://127.0.0.1:9932/v1/chat/completions |
| モデルID | sol0-kimi |

vLLMがモデル読み込み完了を表示した後、Sol0の「LLM接続設定」でURL、モデルID、確認済みの出典・ライセンスを入力し、「外部LLM（毎回確認）」を選ぶ。送信時の承認がない場合は現在の入力文を送信しない。履歴、WSP、メディアは自動送信しない。

Qwenを使用するときは親PRの docs/QWEN_GGUF.md を参照（通常127.0.0.1:8765 / 127.0.0.1:9931 / sol0-qwen）。

## 実接続プローブ

**サーバーが実際に起動しモデルを読み込んだ後**、固定の公開テスト文章のみを推論させる。

~~~sh
node tools/local_model_smoke.mjs --consent \
  --endpoint=http://127.0.0.1:9931/v1/chat/completions \
  --model=sol0-qwen

node tools/local_model_smoke.mjs --consent \
  --endpoint=http://127.0.0.1:9932/v1/chat/completions \
  --model=sol0-kimi
~~~

127.0.0.1以外は拒否。テストツールはプロンプトを固定し、WSPには自動フォールバックしない。応答が返ればHTTP経路の実接続は確認できるが、性能・内容・政治的偏向は検証されない。

~~~sh
node --test tests/kimi_model.test.mjs tests/local_model_smoke.test.mjs
npm test
~~~

## 能力別比較（実モデルがロードされた場合のみ）

公開された固定質問を1件ずつ送信します。QwenとKimiで同じcaseIdを使い、出力を比較してください。

~~~sh
node tools/compare_model_capabilities.mjs --consent \
  --endpoint=http://127.0.0.1:9931/v1/chat/completions \
  --model=sol0-qwen --case=arithmetic

node tools/compare_model_capabilities.mjs --consent \
  --endpoint=http://127.0.0.1:9932/v1/chat/completions \
  --model=sol0-kimi --case=arithmetic
~~~

caseIdは evaluations/local_capability_cases.json に定義（ja_instruction、arithmetic、translation、summary、code、source_uncertainty）。結果のexactMatchは単純な文字列一致だけで、コードの正しさ・翻訳品質・事実性を自動採点するものではありません。どのケースもreviewStatus=unreviewedで返し、人間の根拠ある評価が必要です。コード回答を自動実行しません。実モデルを起動できない環境では結果を捏造しません。

## セキュリティ・未達

- ヘッダー検査だけでは重み・コードの出典や安全性を検証しない。任意の --sha256-manifest を指定すると全シャードのSHA256をストリーム検証できるが、**manifest自体の入手元・署名とライセンスは別途確認が必要**。
- モデルshardはディスク上にあることとサポートされるdtype/offsetを確認するが、全テンソルの数値内容、対応GPU、vLLM互換性、ライセンス、著作権は保証しない。
- vLLM起動時にHF_HUB_OFFLINE/TRANSFORMERS_OFFLINE/HF_DATASETS_OFFLINEを設定してモデルの自動ダウンロードを抑制。モデルを渡すのはローカルディレクトリのみ。利用者自身がインストールしたvLLMやサードパーティモデルコードの挙動をネットワークレベルでサンドボックスするものではない。
- vLLMのHTTPサービスは127.0.0.1限定、CORSはSol0オリジンのみ。ポートが衝突したら --port と --ui-port を変更する。UI配信はSol0単体HTMLのみに限定。
- **Android APKはINTERNET権限なし、オンデバイスQwen/Kimi推論は未実装**。Android17実機、実Kimiモデル、実vLLM/GPUでの動作確認は未完了。
- Qwen GGUFとKimi safetensorsの生成モデルを再配布・自動取得せず、秘密情報をGitに追加しない。既定のWSPオフラインモード、Enter改行/明示送信、WSP長文履歴復元、GIF8秒上限を変更しない。
- Kimi-VLの画像/動画入力、Kimiのツール実行、長期記憶の自動取り込みは未実装。モデルが生成したコードや指示をSol0が自動実行しない。
