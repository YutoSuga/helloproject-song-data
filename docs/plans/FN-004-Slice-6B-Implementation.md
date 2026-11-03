# FN-004 Slice 6B 実装対応

正式契約は[Transaction / Recovery設計](../design/FN-004-反映処理・復旧.md)、[Slice 6 Planning](FN-004-Slice-6-Planning.md)、[Design Follow-up判断記録](FN-004-Slice-6-Design-Follow-up.md)に従う。この文書は実装対応であり、契約・6A〜6F分割を変更しない。

## Moduleと責務

| Module | 責務 |
| --- | --- |
| [target materialization](../../src/fn004-target-materialization.js) | 保存済みPlanのexecution payloadとOwnerにbindingされたoriginal bytesから全14表を構築。既存rowを保持しinsertをtyped PK順でappend。serializer=1、full validator、strict parse roundtripを再利用する |
| [prepare artifacts](../../src/fn004-prepare-artifacts.js) | 全14 CSVとstateのcopy backup、4 input copies、changed CSV tempをimmutable公開。原本からexpected bytesを内部導出し、任意のpath/bytesを受け付けない |
| [durable prepare](../../src/fn004-durable-prepare.js) | 既にdurableなOwnerと本人のlive gate leaseを要求する内部prepare kernel。PREPARING→Intent→PREPAREDの公開順・原本不変・ownershipを検証する |
| [History construction](../../src/fn004-history-construction.js) | 既存History schema/hash/chain/index検証を使いcandidate recordを純粋構築。成功Historyへの公開機能を持たない |
| [persistence](../../src/persistence.js) | 既存exclusive publisherにBuffer入力を追加。JSONと同じtemp/write/sync/readback/no-clobber/directory-syncを共有する |
| [Recovery snapshot](../../src/fn004-recovery-snapshot.js) | Intent前の完成済み未checkpoint tempを固定Plan/original/apply_timeと照合する。欠落を補完せず、分類自体は既存pure classifierへ渡す |

## 公開順と不変条件

1. 実在するOwner、元Decision/Plan/Approval/Receipt、bootstrap/state、全14 canonical、完全Git ID audit、本人のlive gateを再検証する。
2. 初回PREPARING(null)へapply_timeを一度だけ保存する。成功前にtarget/backup/tempを作らない。
3. そのapply_timeと保存済みPlanで全targetを生成・whole validationし、target manifest/changed_pathsをPREPARINGへ記録する。
4. 元snapshot bytesから15 backupと4 input copiesを公開し、backup完了checkpointを記録する。canonicalからのhardlink退避は行わない。
5. changed CSVだけtempへ公開し、完成したref subsetをPREPARINGへ追記する。
6. 全refを含むIntentを公開・sync/readbackし、Hを確立する。
7. PREPARING(H) checkpoint、PREPARED(H)を順に公開する。IDは未消費、canonical/state/Historyは元のままとする。

各publication前後でlive leaseと原本証跡を再検証する。内部ledgerは初回の全証跡と、当該呼出しが内部導出した公開予定bytesだけを許す。Git auditの基準ref変更、他Transactionのartifact追加、原本差替え、claim/retirement/terminal evidence追加を受理しない。raw publisher単体でも6A snapshot validatorを通し、RETIRING/RETIREDや不明なjournal/partial evidenceを迂回しない。filesystem device不一致を拒否する。

失敗時に自動abort/cleanup/release/再prepareを実行しない。prepare kernelはfresh Owner専用で、既存journalがある再呼出しを拒否する。本人の同じleaseにおけるraw artifactの同bytes再検証・再syncは許すが、異なるbytesを上書きしない。Request submit/retry/checkとは接続しない。

## Crash evidenceとtest seam

`onBoundary`は内部dependency injectionで、phase通知の戻り値は制御に使わない。validation/sync/hashをskipする公開switchは存在しない。IO adapter faultは既存publisherのphase/published/temp情報を保持する。通常throwによる中断とprocess terminationは異なり、このSliceではpublication境界のthrow/IO failureを検証する。実process-kill E2E全体は後続sliceの対象として残す。独立Reviewで追加したテストは、Intent/PREPARED公開直後の子processをSIGKILLし、catch/finallyを通さずgateと証跡が残ることも確認する。

| 中断点 | 残る証跡と後続判断 |
| --- | --- |
| 初回PREPARING前 | Receipt/Ownerのみ。target/backup/tempなし |
| PREPARING(null)後 | original未消費を検証できればjournal-based abort候補 |
| backup/temp途中 | 完成subsetは原本または保存済みPlanのtargetと照合。partial/不明tempはblocked、完成済みsubsetは元predicateで分類 |
| Intent公開後・H checkpoint前 | 正規Intent Hを検証して確立済みとする。pre-Intentへfallbackせず、Recoveryは同Hでabort候補。再prepareしない |
| H checkpoint/PREPARED後 | 全refsを検証し、未消費originalならabort候補。commit済みとはみなさない |

既存M-01のProof/Completion優先、H-01 archive永久保持、R77-H01のstate/canonical照合、R77-H02のclaim/gate照合、R77-M01のIntent非依存input-copy検証を変更しない。action/readiness/diagnostic vocabularyも変更しない。

## History候補と時刻

prepareのjournal時刻は初回に固定したapply_timeを使用し、clockを再取得しない。History候補builderは明示的な`applied_at`を受け取る。これは後続成功処理が初回COMMIT_DECIDED publication intentで一度だけ固定する値で、apply_time以上を要求する。prepare時点の候補は成功証拠ではない。expected consumed stateを純粋導出してbindingするだけで、state/IDを消費せず、History head/generationも更新しない。

## 検証対応

[target/serializer/History tests](../../test/fn004-prepare-target.test.js)はno-op、relation insert、全9 write対象表へのinsert、全14 raw bytes、typed PK順、CSV quoting/newline/空field、invalid target/原本、既存独立History vectorとの一致を検証する。

[durable prepare tests](../../test/fn004-durable-prepare.test.js)はtemp Git repositoryと実live gateを使用し、15 backup・changed temps・全input copies・PREPARED chain、Intent前後の中断、raw publisher各IO failure、同bytes retry/no-clobber、原本/foreign namespace/retirement/Git ref変更の拒否を検証する。canonical/state/bootstrap/Receiptのhashを前後比較し、successful History directoryが作られないことも確認する。既存6A suiteでPre-Intent/H-01/M-01/R77修正を継続検証する。

canonical replacement、ID consumption、state mutation、History publication、Recovery action execution、Request dispatch、public CLIを実装しない。次工程は独立したSlice 6B Review & Mergeとし、6Cを開始しない。

## 独立Reviewでの検証補強

R78-M01（MEDIUM）：backupのIO faultとIntent/PREPARED前後のthrowだけでは、後二者のpublication途中と実process停止を直接固定できなかった。[crash regression tests](../../test/fn004-prepare-crash.test.js)へIntent/PREPARED各3 IO boundary（partial write、no-clobber publication、directory sync）と2 SIGKILL caseを追加した。partial JSONは元parse error、完成tempだけはmanual STOP、公開済み完全recordは全refs確認後のabort候補として検証する。再観測の一致・canonical/state/Receipt不変・History未公開もassertする。production実装・正式契約・action/readinessは変更しない。

R78-M02（MEDIUM）：raw artifactのfinal readbackが直接IO errorをthrowし、既存typed codeと公開済み情報を保持しなかった。既存PERSISTENCE_READ_FAILED/PERSISTENCE_NOT_FOUNDへcause付きで変換する。primitive外の読込なのでphase=null、確認対象が公開済みであることをpublished=trueで保持する。EIO/ENOENT回帰でprepareが停止し、元証跡・canonical/state不変と再観測可能性を確認する。filesystem metadata読込にも同じtyped mappingを使い、公開状態の根拠がない場合はpublished=nullを維持する。
