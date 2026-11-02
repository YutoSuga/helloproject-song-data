# FN-004 Slice 6A 実装メモ

正式契約は[Transaction / Recovery設計](../design/FN-004-反映処理・復旧.md)、分割は[Slice 6 Planning](FN-004-Slice-6-Planning.md)、H-01・M-01・6A-DG01-01の判断履歴は[Design Follow-up](FN-004-Slice-6-Design-Follow-up.md)を参照する。本メモは保存schemaやsafety規則の別正本ではない。

## 実装境界

6Aはartifact検証・readonly discovery・observation v2・pure decisionと、immutable publisherの低水準基盤を提供する。通常Request受付、Plan/readiness service、CLIへ実Recoveryを接続しない。既存success-only-v1 readerの失敗を成功へ変換しない。

canonical/state/ID/Historyのwrite、action実行、owner takeover、gate adoption、retirement実行、Request dispatch、target生成、backup/restoreは未実装。publisherをaction handlerから呼ぶ経路もない。次の6Bは独立Review & Merge後に開始する。

## Module map

| 責務 | 実装 |
| --- | --- |
| closed共通型・既存error registry・JCS/SHA projection | [types](../../src/fn004-evidence-types.js)、[errors](../../src/fn004-evidence-errors.js)、[hash](../../src/fn004-evidence-hash.js) |
| Owner / Intent / Journal個別検証 | [transaction evidence](../../src/fn004-transaction-evidence.js) |
| Journal phase / chain / Intent単調性 | [journal chain](../../src/fn004-journal-chain.js) |
| ownership archive / retirement / current head | [ownership](../../src/fn004-evidence-ownership.js) |
| Terminal Proof / Completion / state合成profile | [terminal evidence](../../src/fn004-terminal-evidence.js)、[terminal history](../../src/fn004-terminal-history.js) |
| immutable publication / readonly discovery / namespace | [persistence](../../src/fn004-evidence-persistence.js)、[discovery](../../src/fn004-evidence-discovery.js)、[namespace](../../src/fn004-evidence-namespace.js) |
| raw bytes・元入力・全local証跡の検証 | [snapshot](../../src/fn004-recovery-snapshot.js)、[local evidence](../../src/fn004-local-evidence-validation.js) |
| 既存target bytesのreadonly検証 | [prepared target validation](../../src/fn004-prepared-target-validation.js) |
| observation v2 / stale token照合 / pure classifier | [observation](../../src/fn004-recovery-observation.js)、[classifier](../../src/fn004-recovery-classifier.js) |
| 二度収集・競合検出の内部adapter | [collection](../../src/fn004-recovery-collection.js) |

JCS/SHA、strict JSON、persistence、live gate、state/bootstrap、Decision、Plan、Approval/Receipt、History検証は既存moduleを共用する。state消費の期待値とHistory prefixの導出をpure helperへ抽出し、通常success-only readerのguardを維持した。composite profileからの元Plan再検証も既存Plan生成logicを共用し、現在canonicalから再計画しない。

prepared target validationは既に存在するbytesのhash・whole validation・元row・Planのinsert・固定apply_time・serializer-v1 syntaxを検証する。CSV bytesを生成しない。target materializer/serializer/writerは6B以降の責務である。

## APIとauthority

`prepareRecoverySnapshot`はcomplete discoveryのraw bytesを再検証し、private fieldを持つ不変snapshotを作る。`classifyRecoverySnapshot`はそのsnapshotだけを受け取り、filesystem・clock・network・PID・gateへアクセスしない。返すDTOは正式なinspect v2のfield集合で、allowed_actionsは0件または1件。

`collectRecoverySnapshot`は内部readonly adapterで、二度のdiscovery・Git audit・trusted owner probeの結果を比較する。owner probe未提供では終了を推測しない。OS照合を省略したruntime takeoverやpublic skip flagは提供しない。machine/boot/namespaceが違う終了申告ではactionを選ばない。`matchesRecoveryObservation`は照合predicateだけでrunを実行しない。

publisherは既存のlive common gate leaseを必須とし、artifactから正規pathを導出する。serialized GateWitnessはleaseにならない。Journalには元inputs/Owner/Intentと完全prefix、claim/retirementにはownership context、CompletionにはProofを要求する。immutable same-JCSの再試行は元artifactを再検証・syncし、異内容を上書きしない。実Transaction/Recovery lifecycleからの呼出しは後続sliceで行う。

H-01のarchiveは全claimを数値chainとして検証し、最後のclaimを保持したままretirementを導出する。M-01ではProof公開後のre-abort、Completion公開後のfinish_terminalを禁止する。6A-DG01-01ではPREPARING(null)からのjournal-based ABORTED(null)と、正規Intentが先行したbinding lagを区別する。欠損・破損・tempをNOT_CREATEDへ丸めない。

## Test map

| 項目 | tests |
| --- | --- |
| required / unknown / version / hash / chain / Intent / Proof / Completion | [schema](../../test/fn004-evidence-schema.test.js) |
| H-01、claim fork/gap、retirement binding | [ownership](../../test/fn004-evidence-ownership.test.js) |
| readonly discovery、live lease、no-clobber、sync/publication failure | [I/O](../../test/fn004-evidence-io.test.js) |
| H-01 × M-01 × pre-Intent、5 action排他性、成功/rollback/state合成、observation race | [decision](../../test/fn004-recovery-decision.test.js) |
| 独立Review：actual state/canonical順序、退役gate参照、別Transactionのinput copy | [review regressions](../../test/fn004-review-regressions.test.js) |

fixtureのCSV生成・state/History構築はtest内だけで行い、production artifactを更新しない。I/O失敗注入は既存persistenceと同じtrusted dependency injectionを使う。caught throwではphase/published/temp/causeと残存bytesを確認する。process killはcatch/finallyが実行されない別境界であり、後続sliceのprocess-kill harnessでも同じI/O publication境界を利用できる。6Aは全Recovery実行のkill E2Eを提供しない。

Focused検証：

```sh
node --test test/fn004-evidence-schema.test.js test/fn004-evidence-ownership.test.js test/fn004-evidence-io.test.js test/fn004-recovery-decision.test.js test/fn004-review-regressions.test.js
```

## 独立Reviewでの修正

- R77-H01：消費前state＋partial target、failure-after state＋未復元canonicalをrollback候補としていた。正式publication順序と矛盾するactual組合せを拒否し、合法なcheckpoint lagは維持する。
- R77-H02：gate解放後のretirementでcanonical gateとclaimの参照照合が不足していた。採用gateとのexact一致、gateなしで取得したcleanup gateのoperation/current owner bindingを全retirementで検証する。
- R77-M01：別のpre-Intent終端Transactionのinput copyがIntent参照なしでは照合されなかった。Intentの有無によらず残存copyを元inputsへexact bindingする。

いずれも既存正式契約の実装漏れを修正したもので、保存schema・hash projection・action/readiness・runtime scopeは変更しない。回帰testsは修正前の誤分類を再現し、合法な継続caseも確認する。
