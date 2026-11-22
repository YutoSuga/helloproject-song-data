# FN-005 / SCR-003 実装・検証記録

基点main：189d8f5（PR #102マージ）。PR #100の公開JSON/画面契約、PR #101の共通UI、PR #102の責務分離を維持する。今回の生成は実canonical CSVを使用し、CSV内容やFN-001集計・FN-002〜004契約を変更しない。本番Deployは未実施。

## 実装境界・契約

- FN-005は6表のstrict CSV読込と既存read gate・項目ルールを再利用。対象集合・作品代表名・Version・credit・日付導出と厳密JSON契約を検証する。
- songs:generate / songs:validateは既定G00001、任意のartist IDを位置引数1個まで受ける。生成は同一ディレクトリの一時ファイル→rename、検証不合格時は既存JSONを保持する。
- site:buildはランキング→楽曲生成。CIは両モードで楽曲の厳密契約・画面消費形式・canonical一致、両JSONの再生成差分と未追跡出力を確認する。Deploy条件は維持。
- 実生成結果：site/data/songs/G00001.json、90作品 / 120音源。1作品1カード、詳細は対象primary songのみ。
- 検索はworks.title・credit_name・creators.nameのみ。依頼中の音源タイトル検索はユーザー訂正により撤回済み。音源タイトルは詳細表示に使用。JSONキー・型・null・配列構造に変更なし。
- 実装詳細として検索名配列のUTF-16コード単位昇順、CLI・終了コード・atomic rename・未追跡検査を文書化した。新しいbackend/API/DBや追加絞込は導入しない。

## ローカル自動検証

関連13テスト（song-catalog / song-catalog-model / generated-data / public-site）はPASS、FAIL 0 / SKIP 0。正常対象、Version・共同/特殊role・別名、欠損日付、順序/再現性、CSV/JSON異常、CLI失敗と既存ファイル保全、追跡済み・staged・削除・新規・ignore一致生成物の差分検出を含む。

`npm run site:build`、`npm run songs:validate`は成功。既存ランキングJSONの変更なし。全npm testの実測結果は完了後に追記する。CI結果はDraft PR本文で対象head/runを示す。

## Chromium headless実測

既存previewサーバーと環境側Playwright/Chromiumを使用。本番依存は追加しない。

- 320 / 375 / 390 / 768 / 1024 / 1440px（高さ900px）の6幅で実JSONを読込。
- 各幅で90作品すべてのカード・3順序・検索、全作品の詳細を開き120音源のタイトル・日付・全creditをJSONと照合。ページとdialogの横はみ出しなし。
- ×・Escape、Tab / Shift+Tabのmodal内維持、開時の×focus・閉時の起点復帰を検証。
- 注入データでNFKC/空白AND・正規名/掲載名義・音源タイトル単独検索除外、null日付の新旧両順末尾・日付欄省略、0件を検証。
- HTTP失敗、不正JSON、schema_version不正、必須欠落/型不正、空データ、読込中、詳細対象不整合を検証。
- 既存check-public-site.cjsもPASS：5ページ×6幅の30ケース、ホーム/共通ナビ/artist欄、ランキング全5カテゴリ・組み合わせ分析・根拠・combobox/dialog・異常系・404を回帰確認。
- 390px/1440pxの初期一覧と詳細をスクリーンショットで目視確認。実機iPhone、物理タッチ、スクリーンリーダー、Chromium以外のブラウザは未確認。

再実行（PlaywrightとChromiumは環境側に用意）：

```bash
npm run site:preview
# 別ターミナル。必要ならNODE_PATH/CHROMIUM_PATHを環境に合わせて指定
node scripts/check-song-catalog.cjs
node scripts/check-public-site.cjs
```

## ユーザーのローカル確認

Node.js 20以降、リポジトリrootで実行する。

```bash
npm run site:build
npm run songs:validate
npm run site:preview
```

http://localhost:4173/songs/ で90作品の表示、作品名/作家名検索、3順序、Version別音源詳細を確認する。PCと狭幅で共通ナビから他4ページへ遷移し、作家ランキングも確認する。site:check-generatedは生成JSONをcommitした後で実行する。

## 未実施・範囲外

追加絞込、複数artistボタン有効化・選択状態保存、独立SCR-004、CSV変更・本番操作は対象外。PRはDraftで提出し、ユーザーのレビュー待ちとする。
