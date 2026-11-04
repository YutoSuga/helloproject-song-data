# FN-004 Slice 6C 実装対応

正式契約は[Transaction / Recovery](../design/FN-004-反映処理・復旧.md)、特に[Known-mixed訂正](../design/FN-004-反映処理・復旧.md#known-mixed-recovery-contract)、分割は[Slice 6 Planning](FN-004-Slice-6-Planning.md)を正とする。本書は実装対応であり、正式schema・hash projection・action/readiness・設計判断を変更しない。

## Moduleと境界

| Module | 責務 |
| --- | --- |
| [canonical provenance](../../src/fn004-canonical-provenance.js) | validated O/T exact bytes、全backup、state/Journal trace、両endpointのID maximaを検証。semantic validityをbyte provenanceから分離する |
| [Recovery snapshot](../../src/fn004-recovery-snapshot.js) / [pure classifier](../../src/fn004-recovery-classifier.js) | 既存の全evidence検証へprovenanceを合成し、狭いCase Cだけrecovery_required/rollbackを許可。CANONICAL_INVALIDと元validator codesを保持する |
| [process proof](../../src/fn004-recovery-process.js) | 同Linux host/boot/PID namespaceとstart identityを照合する。PID再利用・不明probeは終了証明へ変換しない |
| [archive reader](../../src/fn004-recovery-archive.js) / [normal gate guard](../../src/fn004-gate-recovery-guard.js) | 全ownership recordのstrict読込・filename/chain/terminal bindingとSEALED判定を再利用。live ownership確認でdomain CSVを再読込せず、各副作用のfull snapshot検証は別途維持する |
| [Recovery authority](../../src/fn004-recovery-authority.js) | expected observation照合、barrier→anchorまたは次claim、全archive/head・physical barrier照合。実終了を取得前後に確認する |
| [common gate](../../src/fn004-gate.js) | 元gateのmetadata/dev/ino/bytesを保持するRecovery限定adoption。gate不在は検証済みterminal cleanupのみ。通常取得はRecovery barrierを前後で確認する |
| [durability confirmation](../../src/fn004-recovery-durability.js) | 既存immutable bytesを上書きせずsync/readbackする。未知・欠落・partial evidenceを修復しない |
| [failure terminal builders](../../src/fn004-failure-terminal.js) | 失敗Proof/Completion/retirementのpure構築と既存validator照合 |
| [failure Recovery service](../../src/fn004-failure-recovery.js) | owned再観測、abort/rollback、逆順restore、failure state、Proof/Completion、cleanup・retirementを接続する内部application service |

`createFailureRecoveryService(root)`の`inspect(binding)`はreadonlyである。`run({binding,command})`は正式v2 commandとtrusted内部contextから実行し、Request submit/retry、通常Apply、CLI/APIには接続しない。success-side action/証拠は6Dへ残し、本serviceから成功History・success state・COMPLETED proofを公開しない。

既存strict JSON/JCS/SHA、full canonical validator、Plan materialization、Journal/Proof/Completion/ownership validator、immutable publisher、persistenceを再利用する。restoreも既存exclusive Buffer publisherでoriginal copyを作り、同filesystem rename→destination/source directory sync→exact readbackを行う。元backupは消費しない。

## AuthorityとTOCTOU

inspect tokenはreservationではない。runは最新hash/actionを照合し、元ownerの実終了を確認、barrier/claim取得、common gate採用後に全evidenceを再取得する。本人が追加したexact ownership artifacts/必要parent directories・effective owner変化だけを区別し、他の差分は変更前に拒否する。

sessionはprocess内WeakMapのnominal capabilityであり、serialized witnessやclient booleanから作れない。外へ渡す内部viewもreadonlyで、discovery bytesはcopyで返す。全write/release前にfull archive/head/barrierと同gateを確認する。barrier→anchor間でprocessが終了した場合はmanual STOPし、別processがanchorを推測生成しない。

自己所有は、freshに検証したsessionから不変RecoverySnapshotへ導出する内部contextに限る。pure classifierはその不変入力だけを読み、後のsession変化や失効により同一入力の結果を変えない。evidence.owner_statusはliveのままで、外部inspectに自己所有例外を渡さない。executorはclassifierとは別に実capabilityを毎回検証する。

owned operation中も、各副作用の前後に再discovery/再validation/再classificationする。private ledgerは当該operationのexact追加/変更/削除だけを許す。Requestのprocessingとvalidなlatest cacheはauthorityにせず、元Receiptと全Journalを検証する。失敗時は自己descriptorだけcloseしてgate/barrier/全証拠を保持する。unknown例外へ新domain codeを捏造しない。

## Known-Mixedとrollback

元Plan・original backup・固定apply_timeからTを検証用に再現し、実Intent manifestと一致させる。新Plan/Intent/ID/timeを生成して救済しない。全14 current bytesのORIGINAL/TARGET membershipをexactに判定し、unchanged/no-opを混在件数へ加えない。

COMMITTINGは実target集合が正式順prefixであり、recorded progressがそれを越えないことを要求する。実consumption/replacement prefixを確認checkpointへ保存してからROLLING_BACKのPを固定する。ROLLING_BACKではP外のtargetや逆順と両立しない組合せを拒否し、checkpoint lagは実bytesから証明する。UNKNOWN・不正backup・state矛盾・COMMIT_DECIDED・当該成功History・Terminal Evidence矛盾をrestoreしない。

remaining target-only fileを逆順でrestoreし、既にoriginalのfileは触らない。全14 All-Original raw manifest＋full validator PASSを確認してから、消費済みhigh-water/eventsを保持したfailure state遷移を一度だけ行う。未消費rollbackではbefore stateを変更しない。

R80-H01訂正：最後のrestoreのrenameだけが成功しdirectory syncが失敗した場合、再起動後のAll-Original readbackはdurabilityの証明にはならない。terminal state公開前に全14の既存original fileをsync・exact readbackし、destinationとrestore sourceのdirectory syncも再確認する。bytesを書き直さず、不足/不正を修復しない。再確認失敗ならstate/Proofを公開せず証拠とgateを保持する。[durability regression](../../test/fn004-recovery-durability.test.js)は実sync失敗→SIGKILL→restartと、再確認自体の失敗を検証する。

R80-M01訂正：cleanup/barrier unlinkの例外でも削除未実施と断定しない。同pathの不在/残存を再観測してpublished=true/false、観測不能ならnullを保持する。元cause/path/phaseを失わず、失敗は成功結果へ変換しない。同regressionで削除前・削除後・結果不明の3ケースを検証する。

R80-M02訂正：JournalのErrorEvidence.io_codeにはnested RepositoryErrorのdomain codeではなく元causeのerrnoだけを保存する。元error/cause chainはそのままthrowし、errnoがなければnull。directory sync障害の回帰でEIOを保持することを検証する。

## Terminalizationとretirement

PREPARING(null)→ABORTED(null)は未作成検証済みの場合のみ。正規Intent Hが先行したpublication lagでは、既存同bytesのdurabilityを再確認してHをbindingし、nullへ戻さない。Proofには完全Journalを保持しreceipt-onlyへ偽装しない。

terminal journal→Proof→Completionをdurable公開する。既存公開Proof/完成proof publication intentの元内容・ended_at・authorityを再利用する。Completionは元Proofへexact bindingし、Completion-onlyを受理しない。cleanup前に既存Proof/Completionの同bytesのdurabilityも再確認する。

失敗terminalの既知backup/temp/restore/一致するpublisher tempだけを検証して片付け、RETIRING→gate release→RETIRED→barrier releaseを守る。anchor/全claims/retirement/元Owner/inputs/Intent/Journal/Proof/Completionは保持する。RETIRING以後にsemantic workへ戻らず、別processはOS終了証明付き次claimでcleanupだけを継続する。

通常reader/Request responseへのcomposite proof接続は6Eの責務として残す。本serviceの検証済みterminal observationと、現public readerのpresence guardは別境界であり、後者をskip flagで解除しない。

## Validationとfailure seam

- [Known-Mixed tests](../../test/fn004-known-mixed.test.js)：KM-01〜KM-12、songs target/song_artists original、逆順restore、semantic diagnostics、state/trace/UNKNOWN/success/terminal境界。
- [Recovery execution tests](../../test/fn004-failure-recovery.test.js)：receipt/pre-Intent/post-Intent abort、unconsumed/no-op rollback、複数file restore、Proof再利用、Completion、retirement、stale token。
- [ownership runtime tests](../../test/fn004-recovery-ownership-runtime.test.js)：実live owner拒否、B→C→Dの永久claim prefix、unanchored barrier STOP、不変自己所有contextと失効capability拒否。
- [I/O tests](../../test/fn004-recovery-io.test.js)：ownership/Proof publication、rename/readback失敗とcause/path/phase/published、RECOVERY_REQUIRED証跡。
- [process fixture](../../test/fixtures/recovery-runtime-child.js)：IPCを保持した実processをSIGKILLし、signalもassertする。mock throwや自然終了で代用しない。

onBoundary/io/audit/probeOwnerはtrusted in-process dependency injectionで、client optionや環境変数のskip/forceではない。hook戻り値は制御に使わない。全試験はtemp repositoryで行い、production data/stagingを更新しない。

正常canonical commit、通常ID消費、成功History/成功state/正常success proof、roll-forward/finalize_success、Request dispatch、公開CLI、UI/API/DBは未実装。次工程は独立した **FN-004 Slice 6C — Review & Merge**。本implementation taskではmergeも6D開始もしない。
