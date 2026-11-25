# 現行CSV運用簡素化・実装受入記録

2026-11-25。人間レビュー待ちの実装PRに付属。マージ・main公開は実施しない。

## 基準と保存

- 着手main：`14fc448bfb17c4a9de53437f3f3819593da3356b`（PR #112手動マージ済み）。直前との差分は設計文書4件のみ。
- CSV比較基準：`01eff4582f5f8758145cfa3504cdd4e85dc9bf3f`（#108後）。着手mainとCSV・公開JSONは同じ。
- 保存タグ：`archive/fn004-v1.0` → `9363c69cc0c119ad4ac251e029061e43d9016d76`。既存同名タグ404を確認後に作成し、GitHub refs APIでcommit SHA一致を再確認済み。上書きなし。
- Final Acceptance対象：`a265e8a165e13f2fdd525a79cb7bd86ede00217b`。正式再受入PASSの既存原本を維持。

[受入証拠](archive/csv-simplification-20261125/)に初期監査・byte一致・通常test/browserログを保存する。

## 着手CIと初期採番

main [run 45547151205](https://github.com/YutoSuga/helloproject-song-data/actions/runs/45547151205)はcompleted/failure。ログで844 pass/2 failを確認。prepare-reviews.test.js:154、song-catalog.test.js:67のSTATE_HIGH_WATER_INVALIDのみで、Gate Node20/24はsuccess、Deployはskip。既知原因と一致し、追加の不整合なし。

初期化のため最新main全263到達commitを一度監査した。`initial-id-audit.json`に固定ref・結果を保存。現在CSV/Bootstrap/state C86に対し履歴C88。採用台帳はA0/B0/C88/G3/H1/J120/L136/M0/O0/P17/R0/T0/V0/W90。通常CIはこのFN-004監査を呼ばない。

## 実装範囲

共通readonly readerで全14表strict検証し、既存rankings/song catalog/about生成とFN-002/003へ接続。CSVパース・schema・validator・集計・公開JSON契約は維持。単純台帳とbase/candidate ID検証、既存identity差分の出力を追加。自動で意味的identityを保証するとはしない。

旧CLI/Gate/Bootstrap/Decision/Approval/Apply/Recovery入口は台帳存在時に副作用前拒否（壊れた台帳でも拒否）。FN-004への変更は停止guardのみで、旧CIを通すための修正ではない。正常な保存原本はタグで維持。

通常CIは毎回全通常suite＋canonical/ID/公開契約/生成一致。保存版全suite・Gate Node20/24は固定保存SHAとorigin/mainを使う手動workflowへ分離し、公開せず通常Deployに依存させない。旧ci-policyは参照資産として残すが呼ばない。

## 同等性・受入結果

- 14 CSV＋公開/手動JSON計20ファイルを着手mainとbyte比較し全件一致。`equivalence.json`にbytes/hashを保存。CSVと参照データの変更なし、stagingの変更なし。
- canonical:validate成功、manifest `7485388dac2f7c9b39892c27df34c129306a8a74043e3fc94cce6ba98e485e85`。既存全負例は通常suiteに維持。
- site:build／songs:validate／rankings:validate／site:check-generated成功。117 primary songs/90 works。CSVから生成した公開JSONもbyte一致。
- 新規楽曲J00121・新規作家C00089をfixtureで直接追加し、全表/ID検証・JSON生成成功。全namespaceの削除ID/消費済み欠番再利用、台帳減少/空予約/欠落/重複キー/型異常、並行PR競合を試験。
- PR/push/manual比較基準、複数commitの先頭だけに不正採番があるケース、実merge commit、非先祖・同一SHA・欠落台帳・未commit候補を試験。
- 壊れたFN-004 state/Bootstrapがあっても通常reader・生成は成功。旧CLI・service・Gate/Recoveryは台帳存在時停止しCSV不変。通常読取ソースはFN-004 runtimeをimportしない。
- 通常testは210 tests / 210 pass / fail0 / skip0、ローカルNode24で8516.309438 ms。browserの詳細は保存ログを参照。公開/モックの操作・6画面幅、5カテゴリ詳細、役割badge、異常JSON表示を確認。公開5ページと楽曲検索/詳細/並び替えは390/1440pxで追加確認、JSエラー0。ブラウザ試験の固定68件を、現行JSONの実件数と照合するassertionへ更新（#108後の件数に対応）。サイトコードの変更なし。

最初のローカルsandbox実行ではNode子プロセスのEPERM/詳細出力欠落・HTTPサーバーへの接続拒否があった。独立checkout内でsandbox外の子プロセス実行と同一環境HTTPサーバーを使用して再検証した。試験assertionやデータ検証の無効化はしていない。最初のfixture更新では旧部分列と正規列の期待値差を修正し、正規headerで重複PK負例を維持した。

## CI実測比較

変更前の成功PR run45414980331：Test and build 2026-11-24T14:31:22Z〜15:20:36Z、49分14秒。main失敗run45547151205：04:30:01Z〜05:52:44Z、82分43秒。後者は成功baselineではなく失敗実測。runner負荷・環境差があり厳密な性能benchmarkとはしない。

変更後実装PRの通常CI結果・実行時間は提出後に追記する。PRのDeploy skipは正常であり、マージ後main公開は人間による手動マージ後に確認する。保存版の長時間全suiteは今回は再実行していない。

## 保存所在・残課題

追跡済みのBootstrap/state/song-candidates、FN-004実装・設計・test・操作ガイド・監査archive/bundleは保存タグに含まれる。stateはgeneration0/History0/pending=nullで、成功History実ファイルはない。

/workspaceの作業checkout・scratch/sharedと今回の/tmp調査checkoutを確認したが、Issue #111記載の隔離Candidate/Decision/Plan原本（dec_83d667bc…/ap_96d27a…）の所在は確認できず未回収。既存受入archiveのログとは区別し、タグが未追跡物を保存したとは主張しない。外部環境の原本は所有者が別途確認する。

保護設定確認は解消済み。2026-11-25所有者確認：Rulesets・Classic branch protection・required checksなし。移行不要、新設は範囲外、従来どおり最新main/CI確認後に順次手動マージする。

Issue #111のデータ修正・close、Java実装、main push、auto mergeは未実施。初回CSV更新は本PR受入後の別データPR。
