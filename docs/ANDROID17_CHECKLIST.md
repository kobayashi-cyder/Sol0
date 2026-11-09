# Sol0 Android 17 実機受入手順（非破壊）

この手順はGitHub Actionsで代替できない **Android 17（API 37）物理端末**の確認用です。前提は、ADBが使えるPC、本人が操作できる専用テスト端末、プライバシーに配慮したテストデータ、事前バックアップです。

Android 15/17 **エミュレータ**のCI成功は、端末固有のIME・WebView・ストレージ・ダウンロード・実機GPU互換性の証拠にはなりません。

## 1. 読み取りのみの事前点検

まずPCで \`adb devices -l\` を確認し、意図した端末を特定します。シリアル番号を公開のIssue・ログ・スクリーンショットに掲載しないこと。**次のコマンドはアプリのインストール、削除、ADB設定変更、入力操作を行いません**。

~~~sh
python android/tests/physical_preflight.py \
  --serial="<ADBで確認した端末のシリアル>" \
  --apk=android/app/build/outputs/apk/debug/app-debug.apk \
  --report=/tmp/sol0-physical-preflight.json
~~~

- 出力にはOS/API、WebViewプロバイダー、Sol0パッケージの有無、INTERNET権限が見つかったか、ローカルAPKのSHA256だけを残す。端末シリアルは出力しない。
- \`readOnlyPreflightReady=true\` は端末とアプリの**準備条件**に過ぎず、実機のUI試験合格ではない。 \`physicalUiTestsExecuted=false\` が意図した状態。
- \`--apk\` で計算したSHA256は **PCにあるAPKのハッシュ**。端末にインストール済みのAPKが同一バイトであることを証明しない。
- 未インストール、Android APIが37未満、エミュレータ、WebViewを判別できない場合などは失敗として記録する。強制アップデートや自動アンインストールをしない。

## 2. 実機テスト（本人の明示操作のみ）

使用予定のAPKを署名・パッケージ名・INTERNET権限の不在で検証する。バックアップJSON・メディア作品ZIPを、端末とは別の場所へ退避してから進む。既存データがある端末では、署名の異なるdebug APKの上書きを無理に通さず、専用のテスト環境での確認を優先する。

- [ ] Android 17実機の端末機種、API、OSビルド、WebView、APK SHA256を記録（シリアルは公開しない）
- [ ] 日本語IMEの変換中にEnterを押しても意図せぬ送信が発生せず、通常のEnterは改行、Ctrl+Enterまたは送信ボタンだけが送信する
- [ ] 長文WSPコードを生成・保存、端末を再起動またはアプリを再開して本文・学習済み重みが保持される
- [ ] 破損JSON／破損WSP／容量オーバーを復元しようとしても、チャット・知識・資料・メディア作品が壊れない
- [ ] PNG・WAV・GIF（最大8秒）・WebMの生成とダウンロード、ZIP・JSONエクスポートが意図どおり動作
- [ ] 画面回転、スリープ復帰、複数回のアプリ再開、通信遮断時のオフラインWSPが動作
- [ ] Androidの権限ダイアログにINTERNET権限が存在せず、予期しない外部通信が起こらない
- [ ] クラッシュ・JSエラーがない。失敗した場合は匿名化された再現手順だけ共有する

## 3. GitHubでの受入

上記チェック項目の成否と匿名化した検証結果を [Issue #9](https://github.com/kobayashi-cyder/Sol0/issues/9) に記録。APKやモデルの配布物、端末内データ、個人情報・秘密鍵・APIキーは添付しない。

- 全項目と物理端末上の操作証拠がそろったときだけ「Android17実機合格」とする。
- Android17エミュレータ成功は「Android17 OS互換テスト合格」として別の欄に記録する。
- 読み取りのみのpreflightを通過しただけではIssue #9をCloseしない。
