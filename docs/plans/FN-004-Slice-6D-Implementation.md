# FN-004 Slice 6D 実装対応

正式契約は[Transaction / Recovery](../design/FN-004-反映処理・復旧.md)、[History](../design/FN-004-成功履歴・読取検証.md)、[ID state](../design/FN-004-初期化・ID状態.md)、分割は[Slice 6 Planning](FN-004-Slice-6-Planning.md)を正とする。本書は実装対応であり、schema、hash、readiness/action vocabularyを変更しない。[データ一覧](../data-inventory.md)・[CRUD](../crud-matrix.md)・[ライフサイクル](../data-lifecycle.md)はPR #81の調査時点を記録した補助資料として参照する。

## Moduleと実行境界

| Module | 責務 |
| --- | --- |
| [success service](../../src/fn004-success-recovery.js) | 内部のinspect/runと、元ownerのlive gateを受けるpost-decision finalize |
| [shared executor](../../src/fn004-recovery-executor.js) | 6Cの再観測・private ledger・Journal・terminal publication・cleanup/retirementを共有。失敗側factoryと成功側factoryは固定したdomain側を選ぶ |
| [original authority](../../src/fn004-original-authority.js) | 実process identityとnominal live leaseを検証。serialized gate/owned flagを受理しない |
| [success kernel](../../src/fn004-success-finalization.js) | 保存済み成功方針→exact History→HISTORY_COMMITTED→success state→COMPLETED |
| [History publisher](../../src/fn004-history-publication.js) | 全physical recordのschema/hash/chain/set/index/Plan prefixを検証し、元record全体をno-clobberで公開・再確認 |
| [terminal builders](../../src/fn004-failure-terminal.js) | 既存の失敗側wrapperを維持し、同じvalidatorでCOMPLETED Proof/Completionも構築する |

`createSuccessRecoveryService(root).run({binding,command})`は6Cと同じOS終了証明・barrier・permanent claim archive・gate adoptionを必要とする。actionはfinalize_success、成功terminalのfinish_terminal/cleanupだけで、abort/rollbackをdispatchしない。`createFailureRecoveryService`は引き続き成功側を拒否する。

`finalize({gate,binding})`は元ownerの実live gateとdurable decisionがある場合だけ利用できる内部接続点である。通常COMMITTING dispatchや通常のCOMMIT_DECIDED公開を行わない。6Eのcommit kernelが成功方針をdurableにした後に使用する。clientが指定するforce/skip/modeはない。

## 成功方針・時刻・idempotency

RecoveryのCOMMITTING全target例外は、元入力の再検証、完全なtarget/whole validation、actual consumed state、ROLLING_BACKなしを既存classifierで証明した場合だけ適用する。no-opでもO==Tだけで消費のdurabilityを推測せず、既存consumed stateのsync・parent directory sync・readbackを確認する。checkpointが遅れていれば実consumption/progressの確認checkpointを先に公開する。元backupから元Plan/固定apply_timeの結果を検証し、History builderを再利用してrecordを構築する。

decision前のcomplete History candidateは成功証拠にしない。採用する場合も元入力から全recordを再構築してmetadataまで一致を要求する。COMMIT_DECIDEDのrecorded_at、record.applied_at、metadata.published_atを同値に固定し、decisionがdurableになる前にはHistoryを公開しない。

post-decisionでは保存済みrecord全体を再利用する。RECOVERY_REQUIREDは保存resume phaseへ戻し、COMMIT_DECIDEDの再確認entryには元record.applied_atを使う。これは既存Journalのexact時刻bindingを維持する再確認で、新しい成功時刻ではない。apply_time、identity、Decision/Plan/Approval/Request、record metadataを再生成しない。

再起動後の読込みだけでdurabilityを断定しない。History/state公開前に既存Journal prefixと全14target bytesをsync・directory sync・exact readbackで再確認する。全target例外の不可逆decision前には、rename元のtemp/data directoryが存在すればそのsyncも確認する。unknown bytes、state矛盾、不正History、wrong repository/transactionはSTOPし、canonicalをtargetへ強制上書きしない。

Historyは同identity同内容なら元bytes/inodeを保持して再確認する。異なるmetadataも元decisionとの不一致として拒否する。完全なpublisher tempは元decisionと一致する場合だけ再確認でき、partial/unreadable/foreign/conflicting tempを修復・推測採用しない。HistoryがあるだけではCOMPLETEDにもinitializedにもならない。

success stateは既存terminal state計算を使う。consumedからgeneration+1、pending解除、History count/head/last確定を一度だけ行い、high-water/allocation eventsを保持する。既にexact after stateなら再更新せず、既存bytesのsync・parent directory sync・readbackを確認してからCOMPLETEDへ進む。renameだけ成功した過去の不確実なdurabilityを、after state一致だけで省略しない。no-opもconsumed/pending証拠と成功Historyを必要とし、通常ID消費をこのkernelから実行しない。

## Terminal・retirement・6C回帰

COMPLETED→Proof→Completionを既存immutable publisherで公開し、既存Proof/Completionを上書き・再生成しない。terminal checkpointのsync失敗から再開した場合も、Proof公開前に保持Journal prefixのdurabilityを確認する。これは共有terminal処理で失敗側にも適用する。Proof-onlyはfinish_terminal、Proof+Completionはcleanup、Completion-onlyはintegrity conflictを維持する。cleanup前にProof/Completionのdurabilityを再確認する。

Recoveryは6Cのcleanup→RETIRING→gate release→RETIRED→barrier releaseを共有する。元live ownerはRecovery archiveを新設せず、terminal cleanup後に元gateを解放する。cleanupは既存6C契約の列挙済みbackup/temp/restoreと検証済みの既知publisher tempだけを扱い、未知path・partial/conflicting証拠をsweepしない。

6CのKnown-Mixed・UNKNOWN・formal trace・state ordering・逆順restore・All-Original/full validation条件は変更しない。terminal evidence priorityとCOMMIT_DECIDED後rollback禁止を維持する。成功側のcanonical操作は既存target bytesのsync/readbackだけで、CSV write/renameはしない。

## 障害・再起動の検証

- [success Recovery tests](../../test/fn004-success-recovery.test.js)：decision/History/state/COMPLETED、no-op、checkpoint lag、candidate、元live owner、stale command・unknown/mixed/state/History/Intent/Completion矛盾。
- 同testsの実process SIGKILL：decision、History、success state、COMPLETED、Proof、Completion、RETIRINGの各公開直後。再起動後に元History/Proof bytesを再利用し、同claim prefixで終端を完了する。History tempのpartial write中のSIGKILLではtyped STOPし、部分証拠・consumed state・canonicalを保持する。
- [publication tests](../../test/fn004-success-publication.test.js)：partial write、file/directory sync、link直前/直後、temp cleanup、readback、同record再確認と異内容衝突。
- I/O adapterがlink/renameの実処理後に例外を返す場合、両path/inodeを観測してpublished=true/false/nullを保持する。typed cause/path/phase/publishedを一般Errorへ潰さない。process停止後は実evidenceから再分類する。

全テストはfixture/temp repositoryを使用する。production canonical/staging、既存Request原本、通常の成功Historyを試験目的で更新しない。

## 6Eへのhandoff

6Eへ残すのは通常Applyのinitial dispatch、prepare→ID消費→canonical置換→成功方針のcritical section、両側kernelの合成、Request response/通常readerのterminal接続である。公開CLIは6F、UI/API/DBは今回追加しない。候補status変更・削除、Git自動化、既存canonical rowの訂正/削除も追加しない。

次工程は独立した **FN-004 Slice 6D — Review & Merge**。本実装タスクではPRをmergeしない。
