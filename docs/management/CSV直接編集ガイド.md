# CSV直接編集ガイド

`data/*.csv`の14表が唯一の楽曲データ正本です。ChatGPT・Codexによる調査・直接編集を正式運用とし、人間がPRとCIを確認して手動マージします。Java＋RDB版は別開発で、完成をCSV更新の条件にしません。

## 更新手順

1. 最新mainを取得し専用branchを作成する。既存作家・作品・音源の再利用可否と公式出典を確認する。
2. 新規IDは`data/id-high-water.json`の該当namespaceを超える値を仮採番する。CSVと台帳を同一PRで更新する。連番は推奨だが必須ではない。台帳だけの増加や空予約は不可。
3. CSVの必須項目、正確な列名・列順、日時・出典・関連行を編集する。既存IDを別対象へ付け替えない。必要な誤記訂正は理由をPRに記す。
4. 編集を止め、`npm run canonical:validate`、`npm test`、`npm run site:build`、`npm run songs:validate`、`npm run rankings:validate`を実行する。複数プロセスで同時編集/生成しない。
5. CSV・台帳・生成JSONをレビューして専用branchへcommitする。`npm run ids:validate -- --base <最新mainの完全SHA>`と`npm run site:check-generated`、`git diff --check`を実行する。ID CLIの候補は現在HEAD、作業treeはcommit済みの状態で実行する。
6. PRに出典、追加/削除ID、既存identity変更理由、台帳変更、検証結果を書く。CIが成功した最終headを人間が確認する。
7. マージ直前にmainを再取得。進んでいれば取り込み/rebaseしIDを再照合、競合時は後続PRの仮IDと全参照を再採番してCIをやり直す。同時に他PRをマージしない。順次手動マージで確定する。
8. マージ後main CI・Pages公開を確認する。失敗を無視して追加マージしない。

Rulesets、Classic branch protection、required checksはいずれも設定なし（2026-11-25所有者画面確認済み）。移行すべき既存設定はなく、新設も今回対象外。手動のCI確認・順次マージを徹底する。

## 採番と失敗時

全namespace A/B/C/G/H/J/L/M/O/P/R/T/V/Wを管理。0〜99999整数、High Waterは下げない。削除済み確定IDと上限以下の欠番は使わない。未マージ・外部未公開IDは仮番号だが、mainに取り込まれた履歴のC87/88は消費済みとして初期C=88に含めた。Issue #111の次候補はC00089/90、実行時に最新mainで再照合する。今回は#111未修正。

台帳はschema_versionや予約・transactionを持たない単純JSON。新規ID最大に一致する値へ更新する。既存の名前等の訂正は機械的identity差分を人間が確認する。意味上の別対象への付替えは台帳だけでは自動判定できない。

CSVエラーはfile/record/columnと出典を確認し修正。ID競合は最新mainに追従。生成差分はCSVから再生成しcommit。基準SHA不明/非先祖/台帳欠落は停止し、回避fallbackやstate手編集で通さない。

## 任意の補助機能と旧経路

`collect:candidates`と`prepare:reviews`は任意の調査・レビュー支援。実行しなくてもCSV更新でき、stagingは正本や採番予約ではない。両機能も共通全14表readerを使う。

`canonical:manage`と旧FN-004 mutating serviceは新台帳が存在するrootで`LEGACY_OPERATION_DISABLED`として停止する。台帳が壊れていても拒否。旧Apply/Recoveryは新運用へ使わない。保存版の実行は[保存記録](../history/reviews/CSV簡素化受入.md)に従う。

## CIの比較境界・再実行

PR：固定base SHAから検証用merge SHA。main push：イベントbeforeからafter（複数commit全体）。手動workflow：main限定、必須input `base_sha`から起動時の固定SHA。元pushを再検証する場合はそのイベントbeforeを指定する。履歴の最終commitのfirst parentへ暗黙に戻さない。同一SHA/all-zero/不正/非先祖/取得不能は停止する。

移行導入時だけ`14fc448bfb17c4a9de53437f3f3819593da3356b`の台帳不存在を既知初期値として扱う。他の台帳不存在は拒否する。手動再検証でこの移行を含める場合も同じ基準を指定する。

ロールバックで台帳・確定IDを巻き戻さない。公開不具合は検証済みartifactの承認された再公開やforward fixで対処し、旧Applyを再開しない。
