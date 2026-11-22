# 公開サイト実装PR 1：実装境界・検証記録

2026-11-22 JST。基点main `8ceff36336372d77466d405ece8f392f4bbb1a45`（設計PR #100マージ済み）。開始時working tree clean、open PRなし、main CI成功、公開ルートHTTP 200と「Juice=Juice 作家ランキング」のHTMLタイトル・見出しを確認。

## 実装範囲と方式

- `/`・`/index.html`はホーム。ランキングへの明確な本文リンクを設置し、自動転送しない。
- `/songs/`は共通枠・対象表示・準備中案内だけの**暫定実装**。検索/一覧/並び替え/音源詳細/公開JSON生成/契約テストはPR 2へ引継ぐ。PR 1だけで楽曲機能完成とは扱わない。
- `/videos/`はComing Soon、`/more/`は免責とXリンク（別タブ・noopener noreferrer）。その他にartist欄は置かない。
- `/creators/`で既存公開ランキングJSONとpair-analysis.jsを利用。集計/JSON形式は変更しない。名前のみ根拠操作、曲名リスト中心のdialog。候補入力と確定IDを分離した単一combobox、空/失敗/分析未生成を区別。
- 共通CSS・common.js、作家専用app.js。静的HTMLは5ファイルで共通ナビ・artist欄のマークアップを保持する。5ページだけの構成でビルド機構/フレームワーク追加を避け、JSが動かなくてもナビを提供するため。共通部分の順序/リンク/色はNodeテストで照合し、変更時は各ページを同時修正する。
- 1024px以上は240px sidebar、未満はsafe-area対応下部タブ。ホーム本文幅960px以上は4列、狭い本文とSPは2列。ほか3画面は44px以上の横スクロール。選択はJuice=Juice固定。複数artist/保持方式は未実装。
- 各ページにtitle/description/canonical。階層から共有CSS/JS/iconを相対参照、ランキングJSONはapp.jsのimport.meta.url基準。404 fallbackは追加しない。

## 集計表示の日本語化

- creator-work pairs：`延べN曲（作家ごとの曲数の合計）`
- pair-work pairs：`延べN曲（組み合わせごとの曲数の合計）`

どちらも既存entriesのwork_countの総和。同じ作品が別の作家/組に登場すればそれぞれ加算する意味を保持し、ユニークなサイト全体曲数とは説明しない。曲数説明は承認済みの「同じ曲に複数のバージョンがある場合も、1曲として数えています。」。

## 検証手順・結果

Node v24.19.0、Linux Chromium headless、既存site:previewをローカルHTTPで起動。

```sh
npm run site:preview
# 別ターミナル、Playwright/Chromiumを利用可能な環境
node scripts/check-public-site.cjs
```

Playwrightを本番依存やCI依存には追加していない。外部インストールのモジュールはNODE_PATH、ChromiumはCHROMIUM_PATH、検証URLはPUBLIC_SITE_URLで指定可能。ブラウザ検証スクリプトはCIのnpm testとは別に手動実行する。

実施したブラウザ検証：

- 320/375/390/768/1024/1440px×5画面の30組。直接URL、全ページHTTP 200、nav切替・選択中、DOM id一意、レビュー項目なし、ホーム4列/2列、artist欄の選択中可視と全ラベル四辺/文字非重複、ページ横はみ出しなし。下部タブ用88px以上の本文余白。
- ルートとindex.htmlがホーム、ホームから作家へ遷移、更新/戻る/進む、存在しないURL404、階層CSS/JS/JSON取得。
- 既存JSONを期待値に全5カテゴリの全entryのrank/name/work_count/creator_idを表示と比較。先頭entryの全根拠曲名を比較。
- 組み合わせ全件・両方向絞込、順位・全件数・自己作品数、根拠曲名を既存analyzeCreatorPairsの結果と比較。入力途中で結果不変、候補0件、矢印/Enter/Escape・ARIA選択状態。
- dialogの×/Escape、Tab/Shift+Tab内部循環、名前へのフォーカス復帰。
- JSONの読み込み中・HTTP失敗・不正JSON・空カテゴリ・pair欠落/不正をブラウザrouteで注入し表示を確認。失敗を0件とせず、pair欠落/不正でも利用可能な通常ランキングを維持。
- ページJavaScriptエラーなし。

Node検証は `npm test`、`npm run rankings:validate`、`npm run site:build` と生成ランキング差分なし、`git diff --check`。結果の最終件数・CIのhead/runはPR本文に記載する。Nodeテストにナビ/SEO/共有asset/固定artist構成/モック要素混入防止/楽曲暫定範囲の確認を追加。

## 変更しない範囲・未確認

canonical CSV、src/FN-002〜004、Production state/Apply/Recovery、ranking生成、site/data/rankings、pair-analysis.js、Pages workflow/domain設定は変更しない。Pages artifactはsite/のみ、docsモックは非公開。PR段階でDeployしない。
実機iPhoneのsafe-area、物理デバイスのタップ/トラックパッド、スクリーンリーダー、全ブラウザの目視は未確認。headless検証は実機検証の代用とはしない。既存JSONの将来すべての不正形式を網羅する検証ではない。

## ユーザーマージ後の公開確認手順（今回は未実施）

1. mainの既存workflowで検証とPages artifact、freshness、Deployが成功したことを対象SHAで確認。
2. hellosongdb.comの5 URLとindex.htmlへ直接アクセス。CSS/JS/JSON/iconのHTTP成功、ルートがホーム、404がホーム転送されないことを確認。
3. 既存JSONとランキング・分析・根拠を比較し、SP/PCのナビ・artist・下部余白を確認。
4. 楽曲が準備中の暫定状態であることを確認。PR 2では正式設計のwork単位JSON生成・検索・並び替え・song詳細と契約CIを実装。

本PRのDraft化解除・マージ・公開操作はユーザーが判断する。

## 記録作成時点の確定結果
ランキング関連3ファイル＋新規公開ページテスト：12 PASS / FAIL 0 / SKIP 0。rankings:validate・site:build・生成JSON差分なし・git diff --checkは成功。Node全スイートのnpm testは長時間の既存FN-004プロセス終了/復旧試験を継続中で、全体の成功はまだ未確定。失敗未検出を全体PASSとは扱わない。フルCIの最新head結果はPR Checksを参照する。

## UIレビュー2件の追記（2026-11-22 JST）

対象は組み合わせ分析の全件表示時の余白と、暫定楽曲ページの案内形式だけ。

- `#pair-panel:has(#pair-direction option[value="all"]:checked) #pair-ranking:not(:empty)` にmargin-top:20pxを指定。既存selectの選択状態と生成済みカードの有無をCSSで参照し、JavaScript・集計・creator HTMLは変更しない。0件は:emptyにより対象外。
- 375px/1440pxとも修正前の全件gap=0px→修正後20px。全件カード数68を維持。作詞者/作曲者の選択後gap=57.59375px、自己数の上端はcontrols下端から16pxで修正前後一致（確認時のカード数9/1も一致）。全件0件をJSONレスポンス差替えで再現しmargin=0px/空一覧高さ=0pxを確認。
- 楽曲の枠線付きカードを削除し、動画と同じmain直下のh2＋pで「Coming Soon...」「楽曲一覧・検索機能を準備中です。」を表示。375px/1440pxで動画と見出しの階層・文字サイズ・ウェイト・上下余白が一致。動画自体、楽曲タイトル・artist欄は変更しない。PR 2の機能は未実装のまま。
- Chromium headless + local HTTPで上記実測を行い、既存check-public-site.cjsの30幅/ページ組合せ・絞込/コンボ/根拠モーダル/状態の回帰も成功。新旧比較のため修正前の座標も同じブラウザで取得した。
- 公開ページ＋ランキング関連テスト12件PASS、FAIL/SKIP 0。rankings:validate、site:build、生成JSON差分なし、git diff --check成功。テスト期待値の変更は楽曲の案内とカード廃止のみ。
- 今回ローカルnpm test全スイートは再実行しない。親コミットccaba9fのCI run44927367615は成功を確認。更新コミットのCIはPR Checksで別途確認し、実行中を成功と扱わない。

未確認：物理PC/SP端末、実機safe-area、スクリーンリーダー、Chromium以外のブラウザ。CSS :hasの挙動は今回のChromiumで確認済み。新機能・データ生成・canonical・FN-002〜004・workflow/domain設定の変更なし。
