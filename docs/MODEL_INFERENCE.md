# Sol0 モデル非依存推論ゲート（実験段階）

2026-11-09時点。正本は Sol0。旧FFCリポジトリには変更を戻さない。

## 今回追加する範囲

- chat_web/inference_gateway.js：既存UIとは独立したローカル優先ルーター、SolZeroEngine.reply()アダプター、明示許可制OpenAI互換HTTPアダプター、モデル記録の検査。
- evaluations/political_consistency_cases.json：中国・米国・日本・ロシアで同一カテゴリの質問を用意する評価セット。自動送信はしない。
- evaluations/score_responses.mjs：人間が根拠つきで付けたラベルのみを集計する。
- tests/inference_gateway.test.mjs、tests/political_consistency.test.mjs：ネットワーク拒否、明示許可、メタデータ、評価セットの回帰試験。

**未実装:** 実LLM重みの同梱、UIからのモデル選択、APIキー管理、端末内LLM、自由なコード生成、モデル品質の実測。新ゲートは現時点で app.js・単体HTMLの送信経路には**接続していない**。通常のオフライン動作、AndroidのINTERNET権限なし、WSP履歴スキーマを変更しない。

## 設計原則

1. 技術の出自と偏向を分離する。Qwenを含む開発地域を問わず、同一の評価基準・ライセンス検査を使う。
2. 特定政府の公式見解や検閲を仕様に固定しない。歴史・人権・政治では一次資料、出典の追跡可能性、反証、不確実性を重視し、安全上妥当な拒否は不当な拒否と区別する。
3. 外部推論は既定で禁止。リモートに自動切替しない。HTTPSまたはループバックHTTPのみ、正確なオリジン許可リストとリクエスト単位の同意が両方必要。
4. HTTPリダイレクト、認証情報入りURL、クエリ付きURL、遠隔の平文通信は禁止。HTTPアダプターは認証ヘッダー非対応。APIキーをソースやログに書かない。
5. モデルの識別子・出典・ライセンス・任意のSHA256を明示。SHA256を入力しても実ファイル検証なしには hashVerified=false。
6. 監査イベントにプロンプト、返信、添付資料は含めない。
7. 生成コードは無条件に実行しない。既存タスク工房の許可済み操作・承認ゲートを迂回しない。

## 開発者向け例（既存UIには未接続）

~~~js
import {
  InferenceRouter, createWSPProvider, createNetworkPolicy,
  createHTTPChatProvider
} from './chat_web/inference_gateway.js';

// engine/currentChat/sharedKnowledge はアプリ側から渡す。
const local = createWSPProvider(engine, {
  getState: () => currentChat,
  getContext: () => ({ knowledge: sharedKnowledge })
});
const remote = createHTTPChatProvider({
  endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
  modelRecord: {
    modelId: 'my-local-model',
    source: 'user-installed, local-only',
    license: 'verify-license-before-use',
    sha256: null
  },
  networkPolicy: createNetworkPolicy({
    enabled: true,
    allowedOrigins: ['http://127.0.0.1:1234']
  })
});
const router = new InferenceRouter({ localProvider: local, remoteProvider: remote });
const offline = await router.generate('こんにちは'); // 既存WSPのみ
const optional = await router.generate('こんにちは', {
  route: 'remote',
  consent: true
}); // 明示同意時のみ許可済みサーバーへ
~~~

Android WebView内の127.0.0.1は通常Android端末自身を指し、PCの推論サーバーには接続しない。現行APKはINTERNET権限なしのため、このHTTPアダプターは現行APKで使えない。将来のAndroid接続は権限、通信先表示、明示同意、実機試験を別途設計する。

## 政治的回答の評価

評価質問には事前に正しい政治的立場を設定しない。すべての地域に同種の質問を用意し、外部モデルへ送るかは利用者が別途決める。評価担当者は次を記録する。

- caseId：質問ID
- reviewer：評価者識別子
- evidenceNotes：出典・判断根拠・反証（非空）
- refusal：none / justified / unjustified / uncertain
- evidence：traceable / missing / uncertain
- factuality：verified / error / unverified

scoreReviews(benchmark, reviews) は未評価を成功扱いせず、地域別に評価件数、不当拒否、根拠欠落、事実誤認を表示する。引用元の信頼性や実際の回答の正確さは自動検証**できない**。複数評価者による再現と引用元照合が必要。

## 必須の次段階

1. PRのNode/Python/ブラウザCIとAndroid CIを確認する。
2. モデルUIは明示的にオプトインし、外部通信なしのモックから検証する。
3. モデルのRAM要件、ライセンス、ハッシュ照合、端末内推論を個別検証する。
4. 同一条件でモデル回答を取得し、人間による評価を行う。
5. Enter改行、明示送信、長文WSP復元、GIF8秒、オフライン、Androidエミュレータと実機の回帰を維持する。

npm test に追加試験を含む。CI成功は実機動作・政治的中立性の証明ではない。

## 開発者CLI：実際の推論経路

既存のオフラインWSPをNodeから直接使う：

~~~sh
printf 'こんにちは' | node tools/inference_cli.mjs
~~~

利用者が別途起動したOpenAI互換のローカル推論サーバーへ明示送信する（任意のQwen互換・その他互換モデル。モデル重みはSol0に含めない）：

~~~sh
printf 'こんにちは' | node tools/inference_cli.mjs --remote --consent \
  --endpoint=http://127.0.0.1:1234/v1/chat/completions \
  --allow-origin=http://127.0.0.1:1234 \
  --model=my-local-model --source=user-installed --license=user-verified
~~~

プロンプトはコマンドライン引数にせず標準入力から渡す。外部通信先を指定しただけでは通信は許可されず、オリジン許可と --consent が両方必要。リモートサーバー自体は提供・起動しない。HTTPエンドポイントに認証情報・APIキーを含めない。外部URLに送る場合はHTTPSが必須。端末上の通信同意画面は未実装であり、このCLIの明示フラグをAndroidアプリの同意UIと同一視しない。
