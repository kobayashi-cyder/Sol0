## Sol-Zero v0.16 — BANC888認知コアと学習WSP（main統合済み）

2026-11-06、BANC888の `app/src/main/assets/cognition-core.js` から認知計画検証コアを `chat_web/banc_cognition.js` へ移植しました。**BANC888 Androidアプリ全体の統合ではありません**。これは状態・前提条件・期待結果を扱う有限探索であり、学習型ニューラルWSPや自由推論とは区別します。

- チャット `/cognition demo` でJSON見本。 `/cognition {JSON}` でBANC認知計画を予測します。OS操作やメディア書込みは実行しません。
- タスク工房の `cognition.plan` を追加。従来の `wsp.learned` と同じ24操作の枠内で計画を検査します。選択メニューの「BANC認知計画（実行せず検証）」で確認できます。
- 学習型WSPの `/net demo`, `/net train {JSON}`, `/net run [1.3]`, `/net undo` と重み保存・復元を維持。BANC計画器がWSPの学習結果を更新したり、検証前の副作用を許可することはありません。
- Androidエミュレーターで失敗していたワークフローのシェル変数消失を修正。ひとつのBashセッションから実機相当のUI操作・学習・ファイル保存を試験し、失敗時は診断ログを採取します。Android 17実機は別途試験が必要です。

**性能上の境界:** 今回の統合だけでは未知の一般質問に正答する高度な言語モデル、任意コードの作成、高品質な学習型画像・音声・動画の生成、長時間自律稼働は実現しません。これらは評価データ・学習・端末試験が不足しており、完了表示しません。

---

## 学習WSP × タスク工房 × Androidオフライン版

本統合は、ゼロから訓練する小規模な数値ニューラルネットを既存のチャット・タスク工房と接続し、AndroidオフラインWebViewパッケージングに含める改修です。**BANC888の認知計画JSコアを移植していますが、旧Androidアプリ全体の統合ではありません。万能AIは未完成です。**

1. チャットで `/net demo` を入力。訓練データから学習し、別の検証データで合格した数値WSP重みを採用します。
2. `/net run [1.3]` で数値推定。独自タスクなら `/net train {JSON}` で数値の入出力例と未使用評価例を指定します。 `/net undo` で一つ前に戻せます。
3. タスク工房から同じ重みを呼ぶ場合は `{"version":1,"steps":[{"id":"prediction","op":"wsp.learned","args":{"input":[1.3]}}]}` を実行します。
4. JSONバックアップで重みを保存・復元します。破損した重みは拒否します。訓練例への近似だけで万能な自然言語知能・コード・画像・音声・動画生成に達するわけではありません。

Node回帰: `node --test tests/*.test.mjs`（159件合格）、HTML再構築: `python scripts/build_standalone.py`。Android 15エミュレーター上でチャット・学習WSP・認知計画・タスク・PNG・保存の操作試験に合格済み（[CI #42342001443](https://github.com/kobayashi-cyder/FFC-FlyFromCodex/actions/runs/42342001443)）。Pixel 10 / Android 17実機は未検証です。

---

# Sol-Zero v0.15（旧版仕様）— タスクを分解・検証して実行するオフライン作業基盤

v0.14のチャット、WSP回路の生成・輸出、固定アルゴリズムのPython/JS生成、PNG/WAV/GIF/WebMメディア工房に、**22種類の許可済み操作を最大16工程つなぐタスク工房**を実装しました。自由な汎用知能ではなく、JSON手順を検証して実行する決定的な作業エンジンです。

## 操作方法
1. `SolZero_Chat_Offline.html`を開き、上部の「🧩 タスク工房」を選択。サンプル「CSV集計」から実行できます。
2. `/agent help`で操作説明、`/agent demo`でサンプルJSONを表示。`/agent {JSON}` はメディア書込みのない計画のみチャットから実行します。
3. `$ref`を使って直前工程の計算結果や表を次の工程へ渡します。手順と結果をJSONファイルに書き出せます。
4. `media.generate` が含まれる場合だけ実行時に明示確認を求め、許可された場合に限って画像・音声・GIF・WebMを作品領域へ保存します。

対応する工程： `value`, `documents.read`, `documents.search`, `text.normalize`, `text.replace`, `text.lines`, `text.join`, `json.parse`, `json.stringify`, `csv.parse`, `csv.stringify`, `table.select`, `table.filter`, `table.sort`, `table.group`, `table.stats`, `math.calculate`, `wsp.run`, `code.generate`, `wsp.export`, `media.generate`, `assert.equal`。

## 実行の例
CSV入力を読み取り、カテゴリごとに金額を合計してCSVへ変換する4工程のデモが同梱されています。文字列・表・文書・WSPを同一プラン内に組み込めます。未定義の操作や未来の工程参照、無効な値は停止し、実行した工程と失敗工程を表示します。1計画16工程、CSV1000行・32列、計画JSON48,000文字の上限があります。

## 品質と限界
`node --test tests/*.test.mjs` によりタスク基盤の16テストと過去版回帰テストを実行。CIでPython重みストア試験、単独HTMLの再現ビルド・バイト一致、PlaywrightのCSV集計・不正操作拒否・メディア生成承認・既存チャット/メディア回帰を確認します。ブラウザCIはAndroid実機試験の代替ではありません。

未知の自然言語要求を自動分解する汎用プランナー、任意の外部WebやOS操作、既存モデルなしでの高度な自然言語生成、拡散画像・自然音声・実写動画生成は未実装です。「万能AI完成」とは扱いません。許可済み処理を順序立てて確実に実行するための基盤です。

---

# Sol-Zero v0.14: 数値WSP → 実行可能なPython・JavaScriptコード
今回の追加機能は、**数値WSPの訓練・編集・検証済み回路**をPython/JavaScriptの移植可能なソースに変換するものです。画面「WSP 汎用グラフ」の「現在の回路→Python / →JavaScript」、またはチャットの `/exportwsp python` と `/exportwsp javascript` を利用します。

出力関数は `wsp_predict([数値入力1, ...])` で、回路の出力名から数値配列への辞書（JavaScriptではオブジェクト）を返します。入力名・ノード・重みは原回路を検証したうえでソースへ埋め込み、ネット接続・コード評価（eval / Function）・既存学習済みLLMを一切使いません。多数の演算（線形重み、ReLU、sigmoid、softmax、l2norm、加減乗算、内積など）を移植します。

**検証:** 生成済みPython/JavaScriptを実行する独立回帰試験で、同じ数値入力に対する元のWSPGraph実行結果と比較します。正しさは検査した演算・入力に限り、実際の一般知能や自由コード生成の証明ではありません。埋め込み回路JSONには120KBの制限があり、それ以上はJSON回路として保存してください。モバイルブラウザ端末の実機互換確認は別途必要です。

**コマンドラインでもWSPをコードへ変換：**

```bash
node tools/export_wsp.mjs solzero_wsp_graph.json python result.py
node tools/export_wsp.mjs solzero_wsp_graph.json javascript result.js
# 既存ファイルへの上書きは --force を明示したときだけ
```

不正回路・サイズ超過は出力ファイルを書き込む前に拒否し、生成コードを元のWSPGraph結果と照合するクロス言語回帰テストを追加しています。通常の実行ではネットワーク通信や元のコードの任意実行は行いません。Python・JavaScript双方のコードを外部プロセスで実行するのは開発時のテストに限ります。

---

# Sol-Zero v0.13 — WSP・チャット・コード生成・メディア統合（実験版）

**品質強化パッチ：** コード生成の追加条件を勝手に無視しない厳密なコマンド判定、512文字の要求長上限、バージョン表記整合、タッチ操作領域・キーボードフォーカス・動作軽減設定、JavaScript追加回帰試験、4bit重みストアのPython試験、単一HTML再生成一致のCI検査を追加しました。品質判定と未達項目は [QUALITY_GATES.md](QUALITY_GATES.md) に記載しています。

v0.12のチャット・独立評価つきWSP帰納・画像/音声/動画工房を維持し、**Python/JavaScriptの実行可能な8種類の固定アルゴリズムコード生成**を追加します。ブラウザ内でコードを実行せず、コピー用テキストを生成します。

**試す：** `/code python fibonacci`、`/code javascript binary_search`、`/code help`。利用可能：階乗、フィボナッチ、昇順二分探索、重複除去、回文、平均、CSVフィールド引用、範囲制限。`/image 海`、`/audio 波`、`/video 星空`（GIF）、`/webm 街`（ブラウザ対応時の音声付きWebM）は継続利用可能です。映像・画像は学習済みモデルではなく手続き的生成です。

**ビルド・検証：** `node --test tests/*.test.mjs`、`python scripts/build_standalone.py`。コミット済みソースを `SolZero_Chat_Offline.html` に再生成できます。`/code` のPython/JSコードは実行テストを用意しています。GitHub Actions `sol-zero-ci.yml` ではNodeテスト、Python構文検査、単体HTMLの再構築と配布アーティファクト化を実施します。PythonのPyTorch学習系テストは別工程であり、CIの軽量チェックには含めません。

**限界：** 自由なコード生成、総合的な自然言語推論、実写・高品質画像・動画生成、一般用途の学習知能は未実装です。ゼロからのモデル開発と、WSP数値回路・手続き的生成を区別します。端末ブラウザ互換と現物動作は別途検証が必要です。

---

# Sol-Zero Chat v0.12 — オフライン・マルチメディア統合版

学習済みの外部モデル（Qwen、Llama、Gemma、GPT等）・蒸留・外部推論API・CDNは**使用しません**。v0.11のチャット/WSPに、数学的な手続きによる画像・波形・動画の生成を追加しました。高品質な生成AIモデルはまだ存在しません。

## はじめかた

`SolZero_Chat_Offline.html` をスマートフォン／PCのブラウザで開いてください（インターネット不要）。上の **「🎨 メディア工房」** から、文章の説明・乱数シード・画風・時間・音を指定します。

1. **画像 PNG**：Canvasの描画計算から静止画を作り、端末へ保存。
2. **音声 WAV**：アンビエント・波音・風音・自作電子音・簡易ロボット声を16kHz PCM波形として生成。
3. **動画 GIF**：フレームを作りLZWでGIFに変換。音声は入りません。
4. **音声付き動画 WebM**：Canvas＋WebAudio＋MediaRecorderを使い、映像・音声の2トラックをWebMへ出力（ブラウザ対応時のみ）。
5. **作品ZIP**：現在のすべての画像・音声・動画と再編集用の `project.json` を一括ダウンロード。**「作品ZIPを復元」** で再読込可能。
6. **端末の素材を取り込む**：PNG/JPEG/GIF/WAV/MP3/MP4/WebMを作品に含められます。取り込んだ画像の内容をAIが理解するわけではありません。
7. **メディアWSP**：4×3の直接プログラムした重みを編集すると、描画密度・運動速度・音程が変化します。

チャットから `/image 青い海`、`/audio 波音`、`/video 星空`、`/webm 街の夜景` と入力しても生成できます。`/video` はGIFです。音声入りWebMを希望する場合は `/webm` を使用してください。

### プロジェクトの保存

対応ブラウザでは生成素材をIndexedDB、制作条件・WSPパラメータをlocalStorageへ保存します。ただし `file://` のストレージ制約やプライベートモード等では保存できないことがあります。**作品ZIPが確実な持ち運び・バックアップの手段**です。チャット履歴のJSONバックアップとメディア作品ZIPは別に保存してください。素材は外部に送信しません。

### ソース構成

| ファイル | 用途 |
|---|---|
| `chat_web/media_studio.js` | 描画、波形、GIF、ZIP、WSP重み制御 |
| `chat_web/media_ui.js` | ブラウザ画面、IndexedDB、WebM録画、素材管理 |
| `chat_web/app.js` | チャットUI・メディアコマンド・旧版移行 |
| `scripts/build_standalone.py` | 外部依存なしの1ファイルHTMLを再生成 |
| `tools/webm_to_mp4.py` | PCでWebM→MP4変換（FFmpeg要） |
| `tests/media_studio.test.mjs` | PCM/GIF/ZIP/WSP等のテスト |
| `samples/` | ブラウザで実生成した静止画・音声・GIF・WebM/MP4 |

### 検証コマンド

```bash
node --test tests/*.test.mjs
python -m pytest -q tests/test_solzero.py tests/test_weight_store.py
python scripts/build_standalone.py
python tools/webm_to_mp4.py samples/movie.webm samples/movie.mp4
```

端末によってWebM録画と自動保存の挙動が異なります。ブラウザ実操作検証にはPlaywright/Chromiumを用意してください。学習済みモデルは不要です。

### 境界と次の研究課題

2026-11-06現在、自由な自然言語理解や、任意プロンプトを解釈する拡散画像モデル・自然なTTS・実写動画生成は未実装です。現在の `MediaWSP` は**生成パラメータの制御回路**で、生成知能そのものではありません。高品質な学習系に進むには、許諾確認済みデータ・ゼロからの訓練・独立評価・推論ランタイム・低ビット量子化が必要です。5GBは最終配布物の保存上限であり、訓練時RAM/VRAMを制限していません。
