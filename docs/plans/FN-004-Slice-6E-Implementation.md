# FN-004 Slice 6E 実装対応

正式契約は[Transaction / Recovery](../design/FN-004-反映処理・復旧.md)、[History](../design/FN-004-成功履歴・読取検証.md)、[ID state](../design/FN-004-初期化・ID状態.md)、[Approval / Request](../design/FN-004-承認・反映リクエスト.md)、[Slice 6 Planning](FN-004-Slice-6-Planning.md)を正とする。本書は内部runtimeの実装対応を記録する。schema・hash・Request response DTO・readiness/action vocabularyを変更しない。

## 通常ApplyとRequest

[内部composition](../../src/fn004-apply-application.js)だけが通常executorを接続する。既存Approval/Request serviceのdefaultは受付のみを維持し、既存public submitを実Applyへ切り替えるreleaseはPlanningどおり6Fへ残す。client向けenable/skip flagは追加しない。

[Request application](../../src/fn004-approval-application.js)は同Requestの保存原本とsemantic payloadの比較を新規受付条件より先に行う。同payloadのretry/checkはreadonlyであり、execution、Recovery、新しいtransaction、時刻、ID消費を生成しない。processing cacheを更新して結果を作らない。

初回受付は既存のDecision・Plan・Approval・Invalidation全件検証、canonical whole validation、Git audit、History/state proofを利用する。同じlive gateでoriginal snapshotとbefore stateを固定し、Receiptをdurable公開してから[normal kernel](../../src/fn004-normal-apply.js)へ渡す。Ownerを公開し、元入力の再検証を通って初めてPREPARINGへ進む。apply_timeは最初のPREPARINGで固定する。6Bのtarget/backup/temp/Intent/PREPAREDを再利用する。

初回responseのreadonly評価はterminal publication・cleanup後、元ownerのgate解放前に行う。別gateを取り直さない。応答・解放の失敗は元Receiptを削除したり再受付可能へ戻したりする理由にならない。Receipt公開だけの失敗と、executorへのlease handoff後の失敗を区別する。

元transactionにbindしたgateの解放が残る観測は、6A classifierと同じくcleanup_requiredである。従って初回応答の同lease内snapshotでは、成功History参照とcleanup_requiredが共存する。解放完了後のretry/check・通常readerは新しいreader lease下でinitializedを検証できる。成功参照だけを根拠に、gate解放前の通常Plan/新規受付を許可しない。

既存Bootstrap statusとDecision registryも実live leaseをruntime guardへ伝播する。完了済みRequestのpresenceだけを理由に永久にblockしない。Bootstrapの外部statusへ内部terminal contextを追加せず、通常Planだけがservice内部で取得したcontextを利用する。

## Commit critical section

PREPAREDからCOMMITTINGをdurable公開し、Intentのexpected consumed stateをatomic publication・sync・readbackで確定してからid_consumed checkpointを公開する。changed_pathsの固定順にprepared tempをcanonicalへ置換する。変更しないCSVを書き換えない。

順序はworks、creators、artists、releases、songs、song_artists、song_creators、song_performers、release_tracks。各副作用の前後で実gate、元Owner、全入力・Journal・state・canonical provenanceを再観測し、private ledgerが許す当該変更以外を拒否する。canonical置換と6C rollbackは同じ[durability primitive](../../src/fn004-recovery-durability.js)を使う。

最後に実pathの14表を再読込し、whole validationとtarget manifestの完全一致を確認する。6Dの元owner finalizerがall-target/consumed predicate、target・消費・Journalのdurabilityを確認し、COMMIT_DECIDED、History、success state、COMPLETED、Proof、Completion、cleanupへ進む。COMMIT_DECIDED後のrollback経路は作らない。

## 障害とRecovery

既知のtyped failureだけを、同じgate下で再分類して6Cのabort/rollbackまたは6Dのfinalizationへ接続する。unknown/corrupt/contradictory evidenceや不明なpublicationはgateと証拠を保持して停止する。部分成功を正常DTOへ変換せず、元I/O errorのcause/path/phase/publishedを保持する。

stateのatomic rename前には、actual stateと異なる完成済みpublisher tempが残り得る。既存snapshot validatorはこれを当該Intentのexpected consumed state、またはJournalの正式phaseから導出したterminal stateと全内容一致する場合だけknown evidenceとして検証する。tempをactual stateへ読み替えず、消費済み・pending解消済みの証明にも使わない。wrong transaction、未知hash、不正schema、早すぎるsuccess afterは拒否する。[純粋回帰](../../test/fn004-state-publication-lag.test.js)と通常rename前後のI/O試験で固定する。

rollbackでcanonicalをAll-Originalへ戻してもhigh-waterとallocation eventsは戻さない。成功側は元Intent/Decision/Plan/Approval/Requestと固定時刻を使う。既存Proof/Completionを再生成・上書きしない。retryが暗黙にRecoveryを実行する経路はない。

Known-Mixedのsemantic diagnosticsは保持する。各fileのexact ORIGINAL/TARGET provenanceに加え、正式trace、state、Journal、ownership等を証明できる場合だけ6Cでrollbackする。UNKNOWNや任意のO/T組合せをbackupで強制上書きしない。

## Readerと独立したterminal proof

[terminal runtime](../../src/fn004-terminal-runtime.js)はactual live gate下で既存transaction-terminal-v1 proof、全History、state、14表、Git high-water、local Request/Journal/Completion、ownership archive/retirement、Approval/Invalidationを検証する。未完了・不明・cleanup途中は通常reader/Plan/新Requestを許可しない。

通常Planはservice自身が取得したcomposite contextと既存pure lookupを使う。caller提供のproof flagはない。既存success-only-v1のfalseをtrueへ変更せず、旧readApplyHistory/verifySuccessfulHistory/lookupVerifiedHistoryの失敗境界を維持する。failure terminalで成功Historyを増やしたり、過去terminal manifestを現在canonicalと同一と仮定したりしない。

## Gate metadata競合

既存gateはfinal pathのexclusive wx作成後にmetadataを書き込む。この間に競合操作が読むと、未完成JSONはGATE_CORRUPT / PERSISTENCE_PARSE_FAILEDになる。6Eの[deterministic regression](../../test/fn004-normal-apply-guards.test.js)はwriteを止めてこの窓を再現し、競合RequestがReceipt・ID state・canonicalを変更せず、他ownerのgateを削除しないことを検証する。

これはBUSYへの読み替えや自動unlockで解消しない。既存正式gate contractを維持した安全側のavailability制約として残る。テストの再実行成功を根本原因の解消と扱わない。

開始main `4ced76cdaa8237a9a40bce1a2223620dbb7eb4d5`の独立したdetached checkoutでも同じwrite直前停止を再現し、baselineと6Eの両方でGATE_CORRUPT / PERSISTENCE_PARSE_FAILEDを確認した。acquire/metadata検証protocolは6Eで変更していない。通常Requestの競合時に未完成gateを無視してdispatchする経路も追加しない。

## 検証とscope

実装中のself-reviewで次を修正した。既存正式contractを変更するものではない。

| ID | Severity | 原因と対応 | 回帰 |
| --- | --- | --- | --- |
| S6E-H01 | HIGH | local Receiptなし＋Git管理failure Proofだけのcloneで、Historyだけの受付済み照合では同Requestを再受付し得た。composite proofのRequest identityもReceipt公開前に照合し、再発行を拒否する | cloneの同Plan/stateを通常利用可と検証した上で、同Requestの新規Receipt/Owner/state変更なしを確認 |
| S6E-M01 | MEDIUM | state rename前の完成済みexpected tempをactual stateとの相違だけで競合扱いしていた。正式phase・Intent/Journal由来のexact値だけを検証し、実消費とは分離する | rename前後EIO、wrong tx、早すぎるsuccess after、rollback/success after temp |
| S6E-M02 | MEDIUM | 内部接続を既存service defaultの公開切替と混同しないよう、専用compositionへ分離した | 既存defaultは受付のみ、内部compositionだけが実Apply |
| S6E-M03 | MEDIUM | 元owner finalizerはleaseを消費するため、その後のresponse評価では元leaseを利用できない。同leaseの解放前readonly callbackで評価する | 同一lease、response評価→gate release順、二重解放・保持・解放失敗 |
| S6E-M04 | MEDIUM | readerがpublisher tempを別のHistory/Proof原本へ数えないようにし、既知の同bytes残存だけをcleanupと分類する | 同Proof temp、未知temp、完成後のreader再開 |
| S6E-M05 | MEDIUM | composite validationのdomain integrity errorをblocked正常DTOへ丸めない | 別Planの破損とterminal Proof read/parse failureのtyped伝播 |
| S6E-M06 | MEDIUM | 元transactionのrelated gateが残る間をinitializedとしない。actual physical witnessでreader自身の新leaseと区別する | 元gateではreader/Planをblock、解放後の新leaseでinitialized |
| S6E-M07 | MEDIUM | 参照のない未知workへのBootstrap statusを新profileのintegrity errorへ変えず、従来のrecovery-required境界を維持する | 既存Bootstrap全ケースとterminal reader/clone回帰 |
| S6E-M08 | MEDIUM | 未解決tempの検査が保存Requestのidentity比較に先行しないようにする。同ID異payloadと原本破損を先に拒否し、同payloadには従来のRecovery待ちを返す | temp共存時の異payload・破損、非dispatch・時刻非生成、原本保持 |
| S6E-M09 | MEDIUM | Bootstrap未成立のReceipt/未知workをcomposite proofへ進めず、従来のRECOVERY_REQUIREDを維持する。読取不能をREADYへ緩和しない | 既存repositoryのpartial bootstrap / unknown pending artifacts回帰 |

重い複数fixtureを並行実行した連続rollback→次成功の試験は15分deadlineを超過した。段階別の比較実行では、ID消費・rollback・新Plan/Approval・全置換・COMMIT_DECIDED・History/state・Proof/Completion・両Request retryまで約14.5分で進んだ。単なる再実行成功を業務不具合の解消と扱わず、負荷と試験budgetを区別する。連続する2 transactionのfixtureには30分の有限budgetを取り、final suiteのfile並列度を制御して検証する。runtimeの確認・durability境界を省略する変更は行わない。

- [正常実行](../../test/fn004-normal-apply.test.js)：insert、新規entity、no-op、same Request非dispatch、terminal reader再開。
- [入力・gate](../../test/fn004-normal-apply-guards.test.js)：stale/invalid inputの受付前拒否、metadata競合、lease消費・保持・解放失敗。
- [I/O](../../test/fn004-normal-apply-io.test.js)：ID消費・CSV置換のsyscall前後障害、typed error、rollback後のcomposite state proof、UNKNOWN非上書き。
- [実process停止](../../test/fn004-normal-apply-crash.test.js)：通常初回dispatchをSIGKILLし、元Request identityで明示Recoveryへ接続する。Request retryは再dispatchしない。
- [lifecycle](../../test/fn004-normal-apply-lifecycle.test.js)：受付後のsource変更による合法pre-Intent abortと、消費後rollbackから新Plan/Approvalによる次の成功。
- [terminal停止](../../test/fn004-normal-apply-terminal-crash.test.js)：Receipt-onlyはOwnerを捏造せずmanual STOP、cleanup前はcleanupだけ、gate解放済みterminalは再実行なし。
- [reader](../../test/fn004-normal-apply-reader.test.js)：Proof-only、Completion後の残存cleanup、元gateでのresponse、Bootstrap status/Decision registry再開、既存defaultの受付のみの境界。

検証は隔離したtemp repositoryで実施する。production canonical/stagingをApply対象にしない。公開CLI・UI/API・DB・Git自動化・candidate削除/status変更・既存canonical rowのupdate/deleteは含めない。6Fへは公開adapterとrelease validationを引き継ぐ。

本実装タスクではPRをOPENで止め、独立したFN-004 Slice 6E — Review & Mergeへ進む。6Fは開始しない。
