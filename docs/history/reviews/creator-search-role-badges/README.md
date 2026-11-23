# 作家検索・担当役割バッジの検証記録

基点は最新mainの `f1a936421e52a754d54ff75f30f7aeaf5f20f8ee`。専用ブランチから実装し、他ブランチの変更は取り込んでいない。

## 変更とデータ境界

- 全ペア両側の作家IDを候補化する既存コンボボックスを再利用。役割チェック2個とクリアへ変更。
- 両OFFはOR、片方ONはその担当、両ONは選択IDが両側にある自己ペア。作品のrolesをAND判定に使わない。
- 作家詳細は作詞・作曲・編曲の3カテゴリを作家ID・作品IDで索引化し、対象音源全体の役割を作品単位で和集合にする。作品一覧・件数・順序は開いたカテゴリを維持し、ペア詳細にはバッジを追加しない。
- canonical CSV、schema、ランキング集計・生成処理、公開JSONは変更しない。再生成後も追跡済み公開JSONの差分はなし。対象120音源・90作品を維持。

## 自動検証

```sh
node --test test/ranking-pairs.test.js test/creator-roles.test.js test/public-site.test.js test/rankings.test.js test/canonical-ranking.test.js
npm test
npm run rankings:validate
npm run site:build
npm run site:check-generated
npm run songs:validate
git diff --check
```

関連単体テストは19件成功、失敗0件。ランキング検証は anomaly_count=0。ビルド成功、生成物一致検査成功、楽曲JSONの契約・canonical一致検査成功。

全体テストは839件中838件成功、失敗0件、既存スキップ1件（終了コード0）。実行時間は約98分。関連テストは最終コードでも19件成功。

## Chromium操作確認

Node.js 24、Python Playwrightと環境提供Chromiumで検証。アプリの依存追加はなし。再実行する場合はリポジトリルートをHTTPで配信する（`site/`だけの配信ではモックを確認できない）。

```sh
python -m http.server 4173
python test/browser/creators.py http://127.0.0.1:4173
```

Chromiumの場所が異なる場合は `CHROMIUM_PATH` を設定する。Python Playwright/Chromiumは任意のブラウザ検証環境で必要。通常のNode単体テストには不要。

- 本番・モックとも320 / 375 / 390 / 768 / 1024 / 1440pxで検索、チェック、クリア、候補リスト、モーダルを操作。
- 初期全件・チェックdisabled、選択後enabled、作家変更時のチェック維持、非空の未確定入力で選択保持、空入力・クリア・再読込の初期化。
- 上下・Enter・Escape・Tab、候補クリック、外側クリック、ARIAの展開・アクティブ候補、フォーカス維持・復帰。
- 候補0件と結果0件を区別し、結果0件で条件保持。
- 全5カテゴリで表示作品名・件数・順序と、3カテゴリから求めた役割バッジの正確な和集合・固定順を確認。ペア詳細にはバッジなし。
- 長い作品名・長い候補名・3バッジをDOM上で与えたストレス確認でもページ・モーダルに横スクロールなし。
- 不正なwork_idは既存読込エラー表示となり、不整合を隠すフォールバックなし。
- 共通mock.jsを使用する他4ページの読込と、楽曲モックの検索・詳細を確認。JavaScriptエラーなし。

IMEのcompositionイベントと変換中Enterは合成イベントで確認。OSの日本語IME、Windows実機、タッチ実機、スクリーンリーダーの実操作は未検証。ローカルではこれらを追加確認する。

## 画面

基点mainの本番ファイルを同じローカルChromiumで表示して変更前を撮影。変更後は実装の本番ファイルを表示。スクリーンショットは検証用で公開サイトへ配信しない。

- [変更前の検索（1440px）](before-search-1440.png)
- [変更後の検索（1440px）](after-search-1440.png)
- [変更後の担当役割（390px）](after-modal-390.png)

スキップ1件はGitHub Actions実環境のcheckout専用検証（ローカルでは対象外）。対応するローカルfixture検証は成功しています。
