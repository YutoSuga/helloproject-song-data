# CSV直接編集・現行システム簡素化

状態：PR #112承認・マージ済み。実装と受入記録は後続の実装PRで確認する。2026-11-25。

本書は実装目標を定義する。2026-11-25にCSV直接編集、全14表検証、独立reader、単純台帳、C=88、Issue #111の次候補C00089/90、通常CI一本化、FN-004テスト分離、FN-002/003任意利用、旧操作誤実行防止の基本方針が承認された。今回は比較基準の設計修正までとし、実装開始は別途指示を待つ。設計PRのマージだけで現行の操作契約を切り替えない。実装・受入完了まで現行CLIを新しい手順として使用しない。FN-004を追加修正して今回のCIを通すことは対象外。

## 1. 目的・背景・範囲

現行サイトのJuice=Juiceの情報精度向上・新曲追加を早期に再開する。CSVを唯一の楽曲データ正本とし、ChatGPT・Codexによる調査と直接編集を正式手順にする。簡素化するのは登録経路であり、データ品質ではない。

Java＋RDBの次世代管理システムは別開発。Java実装、DB移行、正本切替は対象外。将来はHigh Waterをシーケンスまたは採番管理テーブルへ引き継げる。FN-004は完成した技術資産として保存し、失敗した開発として扱わない。

対象は共通読取、ID管理、通常CI、公開処理の接続、運用文書。14表のschema・業務ルール・集計規則・公開JSON形式・画面機能は変更しない。

## 2. 比較基準と今回のCI失敗

比較基準はPR #108マージ後main `01eff4582f5f8758145cfa3504cdd4e85dc9bf3f`。PR #108は2026-11-24T16:23:18Zに手動マージ済み。Issue #111はopenで、新規作家2名・作曲関係2行が残る。

[main CI run 45436537967](https://github.com/YutoSuga/helloproject-song-data/actions/runs/45436537967)のjob 138595842498は846 tests、844 pass、2 fail、skip 0、exit 1、duration 2880161.932804 ms（約48分）。失敗は以下。

- `test/prepare-reviews.test.js:154`：current repository canonical and candidate inputs can produce reviews without writing
- `test/song-catalog.test.js:67`：actual canonical catalog matches committed JSON and target set

ともに `STATE_HIGH_WATER_INVALID` / Runtime state blocks ordinary canonical reads。ランキング・楽曲検証、build、artifact upload、Deployはskipped。Gate Node20/24は成功。マージ後公開成功とは扱わない。PR head `519fabcef172d95ff580236375007672940205a2`の[先行run 45414980331](https://github.com/YutoSuga/helloproject-song-data/actions/runs/45414980331)成功とは区別する。

原因は `src/fn004-git-audit.js:auditGitIds()` がorigin/mainから全到達親を監査し、`src/fn004-history-verify.js:proveHistoryState()` がBootstrap・現在CSV・全親履歴の各上限をstateが包含することを要求する点にある。`withCanonicalRead()`→`assertReadableRuntime()`で通常読取にも伝播する。

現在CSV・Bootstrap・stateはC=86だが、260到達commitの履歴最大はC=88。`e6a53160e64d35d08740c2580eacf4629bb6cb26`にC00087 Andreas Carlsson、C00088 Julie Yuが存在し、`519fabce…`で延期・除去された。マージ時にその中間履歴もorigin/mainの到達対象となった。PR時のorigin/mainにはその履歴がまだなく、検査条件が異なった。CSV内の不正ID追加やstateファイル破損が原因ではない。

独立検証の記録は[調査結果](../../history/research/2026-11-24-CSV簡素化検証.md)と[機械結果](../../history/research/2026-11-24-CSV簡素化検証.json)。全14表のstrict検証はok／diagnostics=[]。manifestは `7485388dac2f7c9b39892c27df34c129306a8a74043e3fc94cce6ba98e485e85`。既存純粋生成関数へ検証済みtablesを渡し、ランキング・楽曲・about artistsの3生成JSONがcommit済み内容とbyte一致。117 primary songs／90 works。

この結果と人間の着手条件変更に基づき、CI失敗状態で設計を進める。チェックの無効化、state修正、Revert、FN-004修正による解消は行わない。

## 3. 新旧アーキテクチャと正式運用契約

旧：CSV → withCanonicalRead → Gate／state／History／Git全履歴証明 → 部分reader → 集計・公開JSON → CI → Pages。

新：出典調査・任意のFN-002/003 → CSV直接編集＋ID台帳 → 共通全表reader／ID差分検証 → 既存集計・JSON契約 → 単一通常CI → PRの人間レビュー・順次マージ → main検証・Pages。

- `data/*.csv`の既存14表が唯一の楽曲正本。`data/id-high-water.json`は採番メタデータであり楽曲正本ではない。
- Decision、Plan、Approval、ApplyRequest、Applyは必須にしない。stagingをCSVへ自動昇格しない。
- 公式出典・訂正理由・新規IDと再利用判断・検証結果をPRに記載する。AIの判断のみでマージしない。
- 最新mainから専用branchを作り、CSV・必要な台帳・生成JSONを同一PRで更新する。CIは自動commitしない。
- 未マージかつ外部未公開IDは仮採番。mainへのマージ時に確定する。確定IDを削除しても再利用しない。
- ローカルは単一操作者が編集・検証・生成を直列に行う。同時編集時のatomic snapshotは保証しない。CIは固定checkoutを用いる。

## 4. 共通reader・全表検証

提案ファイル `src/canonical-reader.js` に `readValidatedCanonical(root)` を置く。`readCanonicalSnapshot()`をそのまま利用し、validation.ok=falseなら構造化diagnostics付き非0相当エラーを返し、部分結果を生成に渡さない。返却tablesは文字列値・元順序を維持し、正規化・書込・採番をしない。manifest/rawBytesは同じ読取bytesに基づく。

`canonical-schema.js`、`canonical-validator.js`、`csv.js`、`canonical-snapshot.js`、`canonical-hash.js`、`strict-json.js`を既存資産として利用。FN-004 repository、state、Gate、History、Git監査をimportしない。パス安全性は共通readerでdata配下の通常ファイルを確認し、symlink・特殊ファイル・root外参照を拒否する。既存persistenceの安全確認を使う場合もruntimeを呼ばない。

維持対象：14表必須・未知CSV拒否・strict UTF-8/CSV・正確な列名と列順・列数・PK/FK/複合FK・ID形式/重複・必須/型/enum/date/URL・primary artist・順序重複・期間/所属期間重複・動画uniqueと区間参照。現行validatorを縮小しない。公式情報の真偽・網羅性は出典レビューで補う。

`loadCanonicalData()`は全表検証結果から既存6表とcamelCaseのsongArtists/songCreatorsを投影。`loadSongTables()`は既存6表名の形を維持。集計・カタログ関数とJSONシリアライズを変更しない。about生成もこの入口を使う。snapshotは同時書込への排他ではなく、ローカルで編集完了後に実行する契約。

提案CLI `scripts/validate-canonical.js`／`canonical:validate`はこのreaderを呼ぶ。ID検証は別責務であり、共通readerをGit必須にしない。

## 5. High Water台帳仕様

パスは `data/id-high-water.json`。UTF-8 BOMなし、重複キーなし、JSON objectのみ。namespaceをキー、0〜99999の整数を値とする。欠落・未知キー・負数・小数・文字列・nullを拒否。保存形式はASCIIキー昇順、2 spaces、末尾LF。意味検証では空白だけの差を不正にしない。schema_version、generation、transaction、予約情報等を加えない。

全namespaceは既存schemaのマスターIDパターンから導出する（A/B/C/G/H/J/L/M/O/P/R/T/V/W）。導出ロジックをFN-004のエラー型と切り離す。namespace追加はschema変更と台帳更新を同一PRで行う。

今回の初期値案：

```json
{"A":0,"B":0,"C":88,"G":3,"H":1,"J":120,"L":136,"M":0,"O":0,"P":17,"R":0,"T":0,"V":0,"W":90}
```

実ファイルは前述のpretty形式。移行時は最新mainの全親履歴最大・既存FN-004 High Water・現在CSV最大・既知外部確定利用の最大を取り、移行記録にSHAと根拠を残す。この初回監査だけ全履歴取得を要する。以後の通常reader/CIでFN-004監査を繰り返さない。

C00087/88は現在CSVにないが、マージ後に全親履歴へ取り込まれたため安全側で消費済みとして扱う。Issue #111の次候補はC00089/90（実施時に最新mainで再照合）。通常規則の「未マージ・外部未公開なら仮採番」を、すでにmainに到達可能となった履歴へ遡及して番号解放する根拠にしない。

## 6. ID差分検証・競合防止

提案 `src/id-high-water.js` と `scripts/validate-ids.js`／`ids:validate --base <SHA>`。基準は明示的なimmutable main SHA。ネットワーク取得はCLI外で行い、検証器は取得済みGit objectを読む。基準が不明・欠落・先祖関係不正なら停止する。全表検証後に実行する。

namespace nごとに基準台帳B、候補台帳H、基準に存在しない候補マスターID集合Nを求める。

1. H >= B、H >= 現CSV最大を必須とする。
2. Nの各suffixはBより大きいこと。削除済みID・欠番の再利用を同じ規則で拒否する。
3. H = max(B, Nの最大suffix)とする。新規なしならH=B。空予約・理由のない増加を許さず、新IDと台帳のcommit漏れを検出する。連番・欠番埋めを強制しない。
4. 関係表は既存PK/FKで検証し、独立採番を追加しない。
5. 既存IDの追加/削除/変更行を一覧化する。削除＋別ID新設や同IDの名称・タイトル・work_id変更はidentity確認対象としてPRに出す。根拠ある誤記訂正は許可するが、別対象への付替えは人間が拒否する。

名前等は訂正可能であり、別対象への付替えを数値台帳だけで完全自動判定できない。機械による再利用拒否と、既存IDのidentity差分に対する必須レビューを合わせて防止する。新たなidentity台帳・承認システムは作らない。

PR CIはイベントbase.shaと固定検証SHAを使用する。マージ直前は人間が最新main SHAを取得し、branchへ取り込み（またはrebase）、そのmainを含む最終headでCIを成功させる。他PRをその間にマージしない。並行PRのID競合は後続PRで再採番し参照も更新する。mainの取り込みがない古いCIだけでマージしない。

### イベント別の比較基準

検証器には基準SHAと候補SHAを明示して渡し、両端のCSV・台帳を比較する。最終commitだけの差分やmerge-baseによる暗黙の置換は使わない。これは採番差分の境界であり、候補全14表の検証は常に別途行う。

| 実行条件 | 基準SHA | 候補SHA | 検証範囲 |
| --- | --- | --- | --- |
| 通常PR（main宛） | `github.event.pull_request.base.sha` | `github.sha`（PRの検証用merge commit） | 固定baseにPRを取り込んだ結果全体。head SHAも記録する |
| PRをmerge commitでmainへ取り込み | pushイベントの`github.event.before` | 同イベントの`github.event.after`（`github.sha`と一致を確認） | push直前mainからマージ後mainまで。first parentに決め打ちしない |
| mainへ複数commitを一度にpush | 同イベントの`github.event.before` | 同イベントの`github.event.after` | push前後の累積差分。最後のcommitで変更していないID・台帳変更も含む |
| mainへの単一commit push（squash/rebaseを含む） | 同イベントの`github.event.before` | 同イベントの`github.event.after` | 同じpush規則を適用する |
| 手動workflow（main限定） | 必須input `base_sha` | 起動時に固定された`github.sha` | 操作者が指定した既知の比較基準から対象mainまで |

main pushは取得時点の動くorigin/mainや最後のcommitのfirst parentを基準にしない。イベントのbefore/afterをログへ記録し、checkout候補もafterに固定する。必要なbase objectを明示的に取得する。beforeがall-zero、未取得・不正SHA、beforeがafterの先祖でないforce push等では停止し、成功やfirst-parent fallbackにしない。mainの通常運用ではbranch新規作成・削除・履歴書換えを想定せず、例外を別途人間確認とする。保存済みイベントの再実行も元のbefore/afterで検証する。

例えば `B → C1（新ID・台帳更新）→ C2（文書のみ）`を一度にpushした場合、`B`と`C2`を比較する。`C1`と`C2`だけを比較して新ID変更を見落とさない。比較は両端の確定候補状態を対象とし、各中間commitの個別検証を追加する仕組みにはしない。

手動workflowには`base_sha`を必須入力として設け、完全SHA・取得可能・対象SHAの厳密な先祖であることを確認する。同一SHA指定による空差分検証や、省略時のfirst-parent自動選択は許さない。操作ガイドで、再検証したい元main pushのbefore SHAをActionsイベントから確認して指定する手順を案内する。複数pushをまとめて再検証する場合は、それ以前の確認済みmain SHAを明示する。継続的な自動基準管理や新たな履歴台帳は導入しない。手動実行でも固定候補の全表・公開品質検証と公開直前の最新main確認は省略しない。

これらは移行後CIの設計であり、今回workflow inputや設定は変更しない。移行導入PRのみ台帳不存在の基準を許し、固定移行SHA・初回監査値との一致を検査する。通常の台帳欠落はエラー。無期限のfallbackモードにしない。

## 7. FN-004保存・旧経路停止

タグ名 `archive/fn004-v1.0` と対象SHAは2026-11-25に承認済み。今回は作成しない。対象は `9363c69cc0c119ad4ac251e029061e43d9016d76`（#108直前、[CI/Pages成功 run 45295342133](https://github.com/YutoSuga/helloproject-song-data/actions/runs/45295342133)）。このrunは軽量で全suite/Gate stepはskip。全件受入済みという説明はしない。保存版のorigin/mainもこのSHAへ固定した独立cloneで再現する。現mainのrefを参照すると今回の履歴上限が混入する。

Final Acceptance対象は `a265e8a165e13f2fdd525a79cb7bd86ede00217b`。`docs/history/reviews/FN-004-Final-Acceptance-20261115.md`のPASSと原証拠を保存する。完成版・受入対象・移行CSV基準は異なるSHAであり、混同しない。今回の失敗mainはタグの正常版候補にしないが、Git履歴と本調査に保存する。この対象の保存は承認済みだが、タグの実作成は後続の明示指示を待つ。

コード・設計・テスト・CLIガイド・監査archiveを大規模移動せず保存。通常entrypointを切り離し、保存版テストはタグ時点のコード/データ、またはruntimeを持たない独立fixtureのみを対象にする。現行CSVを旧FN-004テストの本番入力にしない。

所在：追跡済みは `staging/fn004-bootstrap.json`、`staging/fn004-state.json`、`staging/song-candidates.json`。stateはgeneration0、History count0、pending=null。成功Historyファイルはない。Decision/Plan/Approval/Request/transactions/recovery証拠は現mainに追跡されていない。PR #108記載の隔離checkout内Candidate/Decision/Plan原本は今回所在・永続保存を確認できていない。タグが未追跡物を保存するとは説明しない。移行前に所有者が棚卸し、存在する原本をhash・所在付きで別保管する。復旧・再生成して過去原本と称さない。

旧Apply停止はscript削除だけでは不十分。新台帳が存在するrootでは旧管理CLIとmutating service（Bootstrap、Decision/Plan/Approval/Request保存、Apply、Recovery）を副作用・Gate取得より前に拒否する共通guardを設計する。台帳が壊れていても「存在」で拒否し、回避flagは設けない。library直接呼出しの公開境界も対象。保存コード原本はタグで維持する。任意の旧ソースをコピーしてguardを外す操作までは技術的保証外であり、運用禁止とする。

## 8. FN-002・FN-003

`src/collector/match-existing.js:loadTitleIndex()`と`src/prepare-reviews.js:loadReviewCanonical()`を共通readerへ接続。照合・候補検証・レビュー整列・保存形式は維持する。レビュー出力は参考資料で正式ID予約ではない。収集失敗はCSV直接更新を妨げず、不正CSVなら補助機能も停止する。

## 9. CI構成・実行条件

通常CIは一本化し、ci:lightによる省略を廃止する目標。1通常workflowに `Test and build` とmain限定 `Deploy` を置く。全PR・main push・main手動起動で全14表・ID・公開サイト回帰を毎回実行する。非main手動公開は拒否。既存固定SHA・persist-credentials:false・最小権限を維持する。

通常build順序：第6節のイベント別base/candidate SHA確定・記録 → checkout固定候補SHA＋基準object取得 → Node設定 → whitespace → canonical:validate → ids:validate → 通常回帰suite → rankings:validate → songs:validate → site:build → site:check-generated → mainのみartifact upload。

通常suiteはcanonical-validation、canonical-ranking、rankings、ranking-pairs、song-catalog、song-catalog-model、creator-roles、public-site、about-data、generated-data、collector各種、prepare-reviewsと新ID/reader/停止guard試験。混在テストを内容で整理し、単純なfn004文字列除外で有用な検証を落とさない。browser smokeは実装受入で既存browser資産を実行し、既存Nodeの公開サイト回帰は毎回必須。

FN-004専用・Gate互換性テストは手動の保存版専用workflowへ分離し、通常Deployのneedsから除外。新運用CSVを入力にしない。保存refは固定SHA/タグを使用し、通常branchのruntime停止guard試験は通常suiteに残す。

Deployはmainのみ、同一runの検証済みsite artifactのみ使用。contents:read/pages:write/id-token:write、Environment、github-pages lock、cancel-in-progress:false、lock中の最新main SHA照合と古いartifact skip・API失敗時停止を維持する。ci_modeとGate needsは通常build依存へ置換。現行ci-policyとlight運用文書は実装時に整理する。

初回API調査は403だったが、2026-11-25に所有者が設定画面でRulesets・Classic branch protection・required checksすべてなしと確認した。残課題は解消済み。既存設定移行不要、新規保護設定は実装範囲外。CI確認後の順次マージ・直前main再照合を継続し、設定変更は行わない。

比較指標は同一runner/Nodeで通常build、test step、全workflowの経過時間とテスト件数。現失敗runのtest約48分は参考値で成功baselineとはしない。移行前成功runの実時間も取得し、差を受入記録に残す。短縮のため品質試験をskipしない。

## 10. エラー時運用

CSV構造・整合性エラー：対象file/record/keyを確認し出典に基づき修正。自動補正・不正行の黙示除外は禁止。ID衝突：最新mainへ追従し仮IDと参照・台帳を更新。生成差分：CSVから再生成し意図した差分をcommit。基準SHA不明・保護設定不明：マージを止め所有者確認。旧管理操作拒否：新CSV手順へ戻りstateを編集しない。FN-004保存版失敗：通常データ運用へ修正を持ち込まず保存環境の問題として報告。

## 11. 変更ファイル・文書計画

実装時の対象（本PRでは変更しない）：

- 新設候補：`src/canonical-reader.js`、`src/id-high-water.js`、`scripts/validate-canonical.js`、`scripts/validate-ids.js`、`data/id-high-water.json`、旧操作停止guardと関連tests。
- 接続変更：`src/canonical.js`、`src/song-catalog.js`、`src/collector/match-existing.js`、`src/prepare-reviews.js`。既存公開生成scriptsの必要最小限の接続、package.json。
- 旧公開mutating service/CLIの停止guard、通常/保存版test選択、`.github/workflows/deploy-pages.yml`と保存版workflow、ci-policy。
- 改訂文書：README、docs/README、システム構成、全体フロー、公開ビルド仕様、アプリケーションサービス・CLI契約、データ仕様の採番節、FN-002/003/FN-005接続、ロードマップ、開発・PR運用、.github/CI.md、AGENTS.md。
- 新設運用文書：`docs/management/CSV直接編集ガイド.md`。旧FN-004操作ガイド・設計索引には保存資産の案内を付け、原本の歴史を書き換えない。

設計PRの新規文書は本書・調査記録・JSON証拠・再現手順、改訂はdocs/READMEの設計案リンクのみ。既存有効契約の一斉改訂は実装受入と同期し、未実装の運用を採用済みと記載しない。

## 12. 移行・ロールバック

1. 本設計を人間レビュー。保護設定、タグ候補、過去成果物所在を確認。
2. 最新mainを固定しCSV14表/生成JSON/ID集合/hash・状態原本・公開状態を保存。進行データPRを一時直列化。
3. 承認済み保存タグは実作成の指示を受けた後続作業で作成。移行基準は#108後CSV、保存タグは正常な旧版と区別。
4. 共通reader・台帳・ID検証・旧停止guard・通常CIを一つの切替単位で導入。途中PRをmainへ入れる場合は非有効部品だけとし、旧経路と新採番を混在運用しない。
5. 同等性受入、main CI・Pages確認後にCSV運用を開始。
6. Issue #111は別データPRで最新出典・既存登録確認後に対応。今回は修正・closeしない。

切替前の失敗はコード/設定の変更を戻し再設計。切替後に新IDを確定した場合は台帳とCSVを巻き戻さずforward fixを原則にする。緊急時は最後の検証済み公開artifactを別途承認して再公開し、データ更新を停止。旧FN-004 Applyを再開するrollbackは行わない。#108のRevertを解決策にしない。

## 13. 同等性検証・受入条件

- #108後の既存14 CSVがbyte不変、既存IDと参照が不変。新台帳追加だけを区別する。
- 同じCSVからランキング/楽曲/about artistsの全生成JSONがbyte一致。117 primary songs/90 worksを基準とする。手動about JSONも不変。
- ランキング順位・同順位・work単位重複除外・同一音源ペア規則と画面の検索/詳細/作家/ナビが維持される。
- canonical-validation.test.jsの全負例（UTF-8/CSV/列/型/PK/FK/複合FK/業務ルール）を維持する。
- 台帳減少、削除ID・欠番再利用、台帳更新漏れ、空予約、競合PR、古いmain基準を検出する。既存identity変更はレビュー差分に出す。
- PR固定baseとmerge候補、merge commit push、単一/複数commit push、手動base指定の境界をfixtureで確認する。複数commitの先頭だけに不正なID/台帳変更があり末尾が文書変更のケースも拒否する。before all-zero、取得不能、非先祖、手動base未指定/同一SHAも停止する。
- 独立fixtureで新規楽曲・作家・関連行をCSV追加し生成まで成功。Issue #111の手順を適用できるが実データ変更は別PR。
- state/Bootstrap/History/Gateがない環境、または保存用runtimeが不整合な環境でも通常read/build/CIがそれらを参照しない。import境界も確認。
- 新台帳が正常/壊れている双方で旧CLIと直接mutating serviceが副作用前に拒否され、対象CSV/state/Historyがbyte不変。
- 保存版テストは保存SHAか独立fixtureで実行、証拠checksumを確認。未回収資産は未回収と記録。
- 通常CI毎回実行・最新main公開保護とrequired checks整合を確認し、実行時間を前後比較する。

## 14. 実装PRの範囲

2026-11-25の方針に従い、従来案A（棚卸し・共通reader/ID検証部品）＋B（台帳・接続・旧経路停止・CI・運用文書）を原則一つの実装PRにまとめる。既存資産を活用した最小の一括切替で、現行サイト運用の再開を優先する。今回は実装を開始しない。

実装PRは移行証拠の確定、共通reader、台帳/ID差分、公開/FN-002/003接続、旧誤操作停止、通常CI一本化・保存版suite分離、運用文書と受入を含む。規模・移行リスクが判明して分割が必要なら、理由と安全な切替単位を報告して判断を受ける。旧経路と新採番の混在運用を生む中途切替をしない。

Issue #111は実装・受入後の別データPRで対応し、その後Juice=Juice新曲追加を進める。Javaは別計画。保存タグの実作成も今回の設計修正には含めない。

## 15. 残課題・判断事項

- 保存タグ対象は#108前の正常main `9363c69cc0c119ad4ac251e029061e43d9016d76`として承認済み。Final Acceptance対象・CSV比較基準との区別を維持する。未実施なのはタグ実作成。
- 保護設定の所有者確認は解消済み（2026-11-25）。Rulesets・Classic branch protection・required checksはいずれもなし。既存設定移行・新設は不要/対象外。CI確認後の順次手動マージを継続する。
- 隔離checkoutの過去原本所在・外部確定IDが他にないかの確認。移行時の最新履歴監査で初期値を再確定する。
- 既存IDの別対象への付替えは意味的判断を要し、完全自動保証を主張しない。
- 保存資産の移動・新予約サービス・新管理画面・新DBを追加しない。実装承認までは本書を実施済み扱いしない。

## 16. 設計レビューとCI例外

2026-11-25、人間がPR #112初版のCI（844 pass / 2 fail）を#108マージ後mainと同じ既知STATE_HIGH_WATER_INVALIDによる失敗と確認し、設計専用PRに限って例外的に許容した。これはCI成功の判定、実装後の通常CIでの失敗許容、チェック無効化、FN-004修正の許可ではない。今回修正後のCIも実測状態を報告し、新規の失敗があれば既知例外へ含めず確認する。

## 実装時の確定情報

共通readerはsrc/canonical-reader.js、ID検証はsrc/id-high-water.js・src/id-diff.js、CI境界は.github/scripts/id-ci-base.cjs。旧経路停止guardのみFN-004公開境界に追加し、旧CIを正常化する修正はしない。初期監査はmain 14fc448…の263到達commitで承認値と一致。保存タグは指定SHAで作成済み。通常CIは毎回全通常suiteを実行する。手動保存版CIのみ固定保存SHAを使用する。既存詳細文書には現行/保存版の責務境界を追記する。
