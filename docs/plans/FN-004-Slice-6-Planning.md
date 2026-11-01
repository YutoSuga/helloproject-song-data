# FN-004 Slice 6 Planning

## 1. 目的・位置付け

FN-004 canonical反映機能の残作業を、安全性・reviewability・testabilityから実装単位へ分ける。これは実装計画であり、journal等の新しい保存schema、hash projection、error codeを制定する正式contractではない。

確認基準：2026-11-01、main `f4d3c99c7adae4dcc6fd420d608a48cd39619296`。PR #68でSlice 5、PR #72でarchitecture overviewが統合済み。**6A〜6Fの分割・依存・終了条件は本計画の推奨案として確定するが、実装着手には22章のDesign Follow-up完了を必須とする。** 本PR自体もmerge・人間レビュー前に実装承認とは扱わない。

Source of Truthは[README](../../README.md)、[機能ID](../feature-ids.md)、[architecture](../システム構成.md)、[Roadmap](../roadmap.md)、[データ仕様](../data-spec.md)、[収集仕様](../collection-spec.md)と以下の正式設計。古い「runtime未実装」やroadmap基準日時点の表現は、現コードの確認結果と区別する。

- [全体フロー・FN-003仕様](../design/レビュー準備・canonical反映の全体フロー.md)
- [Decision](../design/FN-004-判断モデル.md)、[Apply Plan](../design/FN-004-反映計画.md)
- [Approval / Invalidation / Request / response](../design/FN-004-承認・反映リクエスト.md)
- [History readonly](../design/FN-004-成功履歴・読取検証.md)、[Bootstrap / state](../design/FN-004-初期化・ID状態.md)
- [Transaction / Recovery](../design/FN-004-反映処理・復旧.md)、[CLI / SCR-002 interface](../design/楽曲管理のCLI・画面連携.md)

以下のpathはrepository root基準。将来component名は責務の候補であり、新APIやdirectoryの正式schemaではない。

## 2. 現在地・確認方法

docsと`src/`・`scripts/`・`test/`・package/workflowを照合した。productionを操作してTransactionを試すことはしない。新しいdocs/plans配下の既存規約はなく、本計画は詳細contractを置くdocs/designとは分離して配置する。

分類：`implemented`は記載範囲の実コードあり、`partially implemented`は必要な一部だけあり、`design only`は正式設計はあるがruntime実行がないことを意味する。

## 3. Slice 1〜5実装状況

| Slice / 責務 | 分類 | 実コードと限界 |
| --- | --- | --- |
| 1: 全14表validator | implemented | `canonical-schema.js` / `canonical-validator.js`。header・strict CSVはsnapshot側。既存readerの部分検証とは別 |
| 1: snapshot / manifest / JCS / SHA | implemented | `canonical-snapshot.js` / `canonical-hash.js`。同bytesでparse/hash。単独snapshot APIはgateを取得しない |
| 2: repository / persistence | implemented | `fn004-repository.js` / `persistence.js`。path safety、strict JSON、exclusive/atomic JSON、file/directory sync。canonical raw-byte writerはない |
| 2: common exclusive gate | implemented | `fn004-gate.js`。live token、inode/全bytes ownership、non-reentrant。crash後のowner移管・lock保持付き失敗処理は未実装 |
| 3: bootstrap / instance / ID状態 | partially implemented | `fn004-bootstrap.js` / `fn004-state.js` / `fn004-id-audit.js` / `fn004-git-audit.js`。監査・初期化・genesis・state schema/hashあり。Transactionの消費・finalizationなし |
| 4: Decision / lifecycle / OCC / registry | implemented | `fn004-decision-core.js` / `fn004-decision-lifecycle.js` / `fn004-decision-application.js`。保存・確認・取消し・再送・effective registry |
| 4: History readonly | implemented | `fn004-history-record.js` / `fn004-history-projections.js` / `fn004-history-verify.js` / `fn004-history-runtime.js`。schema/hash/chain/index、success-only proof。writerや失敗terminal proofではない |
| 4: Apply Plan | implemented | `fn004-plan-application.js` / `fn004-plan-generate.js` / `fn004-plan-target.js`等。immutable計画、予定ID、hypothetical target、stale check。ID予約・実CSV生成ではない |
| 5: Approval / Invalidation | implemented | `fn004-approval-schema.js` / `fn004-approval-repository.js` / `fn004-approval-application.js`。exact binding、global scan、永久失効、prospective cross-Approval guard |
| 5: Request / Receipt / idempotency | implemented | durable no-clobber受付。既存同ID lookupを新規preconditionより優先。同payloadは原本、異payloadはINTEGRITY_CONFLICT |
| 5: retry / check / response | implemented | 共通current evaluatorがartifact/readiness/diagnostics/resultを返す。元Receipt、IDs、time、bytesを保持 |
| Transaction / canonical write / History publication | design only | executor、serializerによる実bytes生成、backup/temp/journal、ID消費、実canonical置換、成功公開はない |
| Recovery / terminal readiness / 正式管理CLI | design only | owner takeover、rollback/forward、receipt-only completion、terminal journal proof、管理commandはない |

`fn004-state.js`のhash・schema validatorやrepositoryのgeneric JSON writeが存在しても、domainの正しいstate遷移writerが実装済みとは扱わない。

### Slice 5のruntime終端

`createApprovalRequestService().submitApplyRequest()`は、新規branchで`saveApplyRequest()`後に`requestResponse()`を返す。dispatcher、canonical writer、History writer、state finalizerは呼ばない。既存branchはsemantic projection比較後、同じevaluatorだけを呼ぶ。

`inspectRuntimeState()`はRequest directoryのentry、またはbootstrap専用以外のtransaction entryがあるだけでRECOVERY_REQUIREDを返す。したがって正常なdurable受付直後でも通常readinessはrecovery_requiredとなり得る。`requestResponse()`はこれと独立して検証済みHistory参照を返せるが、終端証跡を見て通常利用を再開する処理はまだない。

## 4. FN-004残作業

1. 完全なjournal/intent/completion契約とvalidator、durable chain、discovery、cache再構築。
2. owned execution contextによる元Request・Approval・Decision・Plan・state・History・全14表の再検証。
3. real apply_timeでのtarget materialization、serializer=1、全14 manifest、backup・changed temp・restore。
4. ID消費、9表の許可されたchanged filesだけの置換、whole validation、COMMIT_DECIDED。
5. successful History構築・no-clobber公開、state成功head、COMPLETED、cleanup。
6. owner停止証明・lease移管、receipt-only・pre/post-decision・rollback途中の再起動復旧。
7. rollback消費を含むterminal state proofとreadiness、retained Requestの結果観測・新規利用再開。
8. 初回受付者だけのexecution接続、正式CLI、全crash境界の検証と公開前のend-to-end試験。

## 5. Transaction責務・再検証

同common gate内で本人Receiptとexact repository/Decision/Plan/Approval bindingを検証する。他のunfinished workを拒否する。初回受付で確認したからといってexecution時の再検証を省略しない。

通常の`checkApplyPlan()`はRequest/pending存在を理由に止まる。これをそのままexecutionから呼んだり、公開skip flagでguardを外したりしない。保存Plan・registry・candidate・canonical・History・state・rulesを再計算する既存logicを、**本人のlive leaseと元intentが検証された内部context**で共用する設計が必要である（DG-02/04）。一般readerのguardは維持する。

新規利用のApproval有効性と受付時のexact bindingは分ける。post-acceptの正しいInvalidationだけを理由に既存Requestを取消さない。cross-Approval prospective guard、global fail-closed、既存Historyの二重適用検出を維持する。stale/invalidでjournal前に止める場合も、receiptを消さず正式completion証跡が必要。

## 6. Transaction state machine

`LOCKED`はlease取得段階を表す説明用の語であり、正式journal stateへ追加しない。正式stateは以下。sequenceは副作用ごとのcheckpointも記録し得るが、完全record形式はDG-01で確定する。

| State | Entry condition / 意味 | Durable evidence・次への条件 | Failure時 |
| --- | --- | --- | --- |
| LOCKED（非journal） | common gate所有、本人要求・他work確認 | live lease。次はoriginal全14表と元binding検証 | journal前crashはreceipt/owner/実stateから判定。推測再dispatch禁止 |
| PREPARING | original valid、execution前提確認済み | journal、apply_time固定、intent/入力copy、backup/temp構築。全検証・sync後PREPARED | original一致・副作用なしを証明してABORTED。部分証跡は保持 |
| PREPARED | 全14 backupとchanged tempが完成・検証済み | immutable intent・hash参照。直前precondition再検証後COMMITTINGをdurable化 | original確認してABORTED。自動commit再開しない |
| COMMITTING | 置換開始方針がdurable | ID消費/pending保存が先。各置換・sync・hash・progress、全14検証後COMMIT_DECIDED | 部分置換は原則ROLLING_BACK。全target時の例外は7章 |
| COMMIT_DECIDED | 全target実path検証済み、不可逆な成功方針durable | applied_atと元成功recordの根拠。History公開後HISTORY_COMMITTED | rollback不可。unknown mutationは上書きせずSTOP |
| HISTORY_COMMITTED | exact成功Historyがdurable | state成功head/pending整合、journal完了へ | 同record/元state遷移を使いforward finalize |
| COMPLETED | target・成功History・state・journalが整合 | result参照整合、terminal証明後cleanup/unlock | 成功を取消さずcleanup_required。再Apply禁止 |
| ROLLING_BACK | 成功方針前の復元方針durable | backupを検証、target fileだけ逆順restore、全14 original検証 | 方針を変更しない。失敗は証跡・lock保持でRECOVERY_REQUIRED |
| ROLLED_BACK | original復元・terminal state整合 | 消費済みIDは保持、pending解消を証明 | 成功Historyを作らない。通常利用にはterminal proof必要 |
| ABORTED | canonical original・副作用なしを証明 | journalまたはreceipt-only completion。形式はDG-01/02 | 成功Historyを作らない。根拠不足はSTOP |
| RECOVERY_REQUIRED | 自動で安全な完了を証明できない | 実hash・owner・journal・History・stateをinspect | 続行/削除/成功推測をしない |

state enumと外側のreadiness/error codeは別の概念である。

## 7. COMMIT_DECIDED boundary

成功方針のdurable recordが境界であり、「全rename完了」「validationを一度通過」「Historyが見える」だけで代用しない。sync失敗でpublication成否が不明な場合は実record/hash/chainを再確認し、安易に未決定へ巻き戻さない。

- **前**：部分commit・validation failureは原則rollback。ROLLING_BACKを先にdurable記録する。
- **例外**：全targetだが成功方針record前のcrashは、ROLLING_BACK未記録、保存Approval/入力/実targetの再検証成立なら成功確定してfinalizeできる。これは正式matrixの条件付き例外であり、「前は常にrollback」と単純化しない。不成立で安全な根拠があればrollback、unknownならSTOP。
- **後**：History/state/journal障害でもoriginalへ戻さない。元apply_time/applied_at・同一record・同一transactionを使いforward finalize。未知の外部変更へtargetを強制上書きしない。
- no-opはoriginal==targetなのでbytesだけでは位置を判定できない。journal方針・ID state・Historyを合わせる。

## 8. ID high-water接続

Planの`allocatePlannedIds()`は予定IDであり予約/消費ではない。executionで現在state、canonical/historical maxima、範囲・capacityを再検証する。

正式成功遷移はbefore→consumed→terminal。COMMITTINGをdurable化後、最初のCSV置換前にconsumedを保存する。consumedはgeneration+1、本人pending、namespace別連続allocation rangesをappendしhigh-waterを進める。IDなしno-opもgeneration+1とpending確立が必要。

成功terminalはHistory公開後にさらにgeneration+1、pending=null、history.count/head_hash/last_apply_idを同recordへ更新する。lineage、initialized_at、baselineは不変。`hashState()`を再利用する。同一遷移のRecovery再送でgenerationを二重加算しない。

rollbackでも消費済みranges/high-waterを下げず、state backup全体を戻さない。pending解消・rollback terminal generationとproof形式の完全な具体化はDG-04。ID消費保存の失敗は「消費なし」と即断せず、原本/消費後hashを再読込しCSV置換を止める。

## 9. canonical commit strategy

全14表をoriginal snapshot・backup・target検証・commit後再読込・復元検証の対象とする。変更対象は正式v1 insert可能表のchanged filesだけ。

commit順序：`works → creators → artists → releases → songs → song_artists → song_creators → song_performers → release_tracks`。非変更の`members / member_affiliations / videos / video_songs / video_song_performers`も全体検証対象で、write対象へ勝手に拡張しない。rollbackは実targetのfileだけ逆順。

serializer=1はUTF-8/BOMなし、schema列順、LF・最終LF、必要fieldだけquote・内部quote二重化。既存row順・全field値を維持しinsertをtyped PK順で末尾追加する。変更fileのquote再表現はあり得るが、非変更fileはbytes不変。複数CSVのOS atomic transactionとは呼ばず、共通gateと復旧証跡によるlogical all-or-nothingとする。

`validateHypotheticalTarget()`はtimestamp markerを使うpure checkで、実timestamp/CSV bytes writerではない。既存operation/template・typed-key comparator・validatorを共用し、Planのtemplate semantic検証と、実apply_timeを埋めたtargetのraw manifest検証を分ける。実target bytesのhashをPlanのtemplate hashへ直接代入しない。

## 10. backup / temp / journal

| Evidence | 作成・durability | Recovery用途・保持 |
| --- | --- | --- |
| backup/data | PREPARING中、全14 original Bufferをcopy。hardlink/rename退避ではない。exclusive create→write→file sync→再読込/hash→directory sync | original復元根拠。復元でも消費せず保持 |
| backup/state | 元state snapshotを保存・hash検証 | 遷移根拠。high-waterを巻き戻す復元元にはしない |
| temp/data | 同filesystem上にchanged targetだけexclusive作成し検証・sync | commit用。missing時の扱いはphase次第。未決定・未置換の根拠を推測しない |
| restore | verified backupから別tempを作りsync後にtargetだったfileへrename | rollback途中crashも再分類し、backupを失わない |
| intent / 入力copy | Decision / Plan / Approval / immutable Receipt、original/target、時刻等をbinding | immutableな再起動根拠。再生成して現在入力に差し替えない |
| journal/sequence | recordを完成tempからno-clobber公開、directory sync後に次の副作用 | stateとhash連鎖、progressは補助。cacheだけで判断しない |
| transaction.json | 正式設計上のlatest参照cache、atomic replace | 全chainとintentがvalidな場合だけ再構築可。不正末尾を無視して古いrecordを採用しない |
| temp/apply-history | 元成功内容を検証して保存 | COMMIT_DECIDED後に同recordを公開。metadataを含めretryで作り直さない |

各canonical rename前に期待hashを確認し、後にdestination directory sync・実hash確認・journal progressを追記。progressは実renameに遅れ得るため実bytesが判断根拠となる。partial publicationは既存persistenceのphase/published/tempを保存して扱う。

`apply_time`はPREPARINGでtarget生成前に一度だけ固定し、new masterのcreated_at/updated_atへ使う。journal/intentのどのcheckpointでdurableにbindingするかはDG-01で確定し、保存済みtargetや成功根拠と異なる時刻をRecoveryで生成しない。`applied_at`はCOMMIT_DECIDEDの成功確定時刻、`published_at`は最初のHistory publication intent時刻として固定する。これらをReceiptのrequested_atやApprovalのapproved_atへ流用せず、再送で更新しない。

journalに必要と正式設計で記述されている情報は、sequence/previous hash/record hash、state、repository/Request/transaction/apply identity、Decision/Plan/Approval binding、original/target manifest、affected paths、backup/temp hash、per-file progress、ID state前後、History予定、時刻、error/recoveryである。ただし**完全closed field set・nullable/per-state制約・hash projectionはまだ確定していない**。ここでJSON schemaを創作しない（DG-01）。

## 11. successful History write

builderとpublisherを分離する。builderはPlan/Decision snapshot、candidate coverage、final ID mapping、全operation results、before/after全14 manifest、before/consumed state、ranges、固定apply_time/applied_at、actor、各exact bindingから既存v1 recordを構築する。

`validateHistoryRecord()`、`historyRecordHash()`、`validateHistoryChain()`、`historySemanticHash()`、既存Plan/Decision validatorと共通JCSを再利用する。testの`syntheticSuccess()`をproduction builderとしてコピーしない。writerは元store transition・current registry/source・original/target bytesから、readonly readerが証明できない当時の実行前提とtargetを証明する責務がある。

sequenceはvalidated prefix count+1、previous hashは前record（初回bootstrap_hash）。同leaseでprefixを再確認し、COMMIT_DECIDED後に同apply_idへno-clobber/durable公開。同内容再送は保存済み元recordを検証して利用、別内容はintegrity STOP。receipt_hashは元Receiptとのexecution検証に用い、既存History schemaへ勝手にfield追加しない。

失敗・ABORTED・ROLLED_BACKを成功Historyに入れない。no-op成功も記録する。公開済み成功は後続state/journal/cleanup障害で消さない。

## 12. state finalization・terminal proof

History公開→state成功head/pending解除→COMPLETED→結果参照整合→cleanup/unlock。state更新はlive lease下、元hashと期待する遷移を検証しatomic replace/file+directory syncする。単なるgeneric JSON writeだけではdomain保証にならない。

現`verifySuccessfulHistory()`のsuccess-only-v1は成功chainからterminalを再構成する。rollback後の消費eventやgeneration gapは`STATE_TRANSITION_PROOF_REQUIRED`になり、schema/hashがvalidなだけでは通常利用できない。

DG-04では、成功History検証を弱めず、terminal journal/completion/ownerから追加遷移を証明する合成validatorを確定する必要がある。retained RequestやCOMPLETED transactionがdirectoryにあるだけで永久blockしないよう、`inspectRuntimeState()`も検証済みterminal証跡を分類する。ただしunknown entryや未証明workをskipしない。成功Historyのvalidとstate/terminal readinessは独立のまま保つ。

## 13. Recovery責務・entrypoint

readonly inspectと明示recoverを分離する。inspectはunfinished Request/journal、lock/owner、repository lineage、全chain、intent、backup/temp、canonical、History、stateを一貫観測し、一意な許可actionと観測state hashを示す。recoverは人間確認後、同根拠を再検証して実行する。wire DTO/option名はDGで決定し、ここでは制定しない。

process crash後のserialized tokenはlive leaseではない。Recoveryは専用mutexとowner停止証明を使い、元gateを空けずに移管する。別host、PID再利用、必要OS identityがnull、recovery mutex自体のowner不明を時刻だけで解決しない。証明不能ならmanual STOP。

current canonicalをfileごとにoriginal/target/unknownへ分類し、COMMIT_DECIDED、ROLLING_BACK、History/state証跡と組み合わせる。targetでも未知の別transactionを推測継承しない。inspect/recoverのv1実行入口はCLIのみで、Browser/API用Recovery commandを増やさない。

## 14. rollback / roll-forward / manual STOP

| 分類 | 許可条件・動作 |
| --- | --- |
| ABORT | receipt-only / PREPARING / PREPAREDで、元owner停止・original/state/History・副作用なしを証明。未開始再dispatchではない |
| rollback | COMMIT_DECIDED前のpartial commit、またはROLLING_BACK記録済み。必要backup hashが全てvalidでunknown canonicalなし。逆順restore、whole original確認、消費保持・pending解消のterminal proof |
| 成功確定してforward | 全target・成功方針前の正式例外を7章どおり満たす場合。自動commit再開一般を許すものではない |
| forward finalize | COMMIT_DECIDED以降。exact target/History/owner/stateを再検証し不足する成功公開・state・journal・cleanupだけを完了 |
| manual STOP | corrupt/unknown journal、intent欠損、必要backup欠損、canonical unknown、History hash/binding不一致、state/History矛盾、repository mismatch、owner証明不足 |

temp欠損は一律に安全でも一律に復元不能でもない。PREPARED完成証明、既にdestinationへrename済みか、original/target/hash、phaseを見て正式matrixで判定し、足りない証跡を現在入力から再生成しない。詳細な欠損組合せの許可actionはDG-01/03で閉じる。

error taxonomyは既存codeを維持する。unknown/pending workはRECOVERY_REQUIRED、binding conflictは既存境界でINTEGRITY_CONFLICT、壊れたgateはGATE_CORRUPT、未証明stateはSTATE_TRANSITION_PROOF_REQUIRED。History固有code・PERSISTENCE_*のphase/causeも保持し、すべてを成功diagnosticへ丸めない。新journal errorのexact mappingはDG-05で承認し、新codeを本計画で追加しない。

## 15. crash / failure injection matrix

全caseで再起動後inspect→明示recover→再inspect、同recover再送、他reader/新Requestのfail-closedを検証する。History/state/journalの不一致を単なるmissingとして扱わない。

| Crash point | 残り得る証跡 | 期待判定・assertion | 主担当 |
| --- | --- | --- | --- |
| lock取得直後 | lock、receipt、journalなし | owner/元入力/全stateから未開始証明。不能ならSTOP | 6A/C |
| 初回journal作成途中 | temp/不完全chain | canonical不変、部分record保持。未知recordをskipしない | 6A |
| backup作成途中 | 一部copy | original一致・副作用なしならABORTED。backup完成を偽装しない | 6B/C |
| temp作成途中 | 一部target temp | 原本不変、未完成をPREPAREDとしない | 6B/C |
| PREPARED後 | 完成intent/backup/temp | original/state確認後ABORTED。再dispatchなし | 6B/C |
| COMMITTING記録後・消費前 | journal、before state | 消費有無を再読込、canonical置換未開始を確認 | 6C/E |
| ID consumption後 | consumed/pending、canonical original | 消費保持してROLLED_BACK。generationを戻さない | 6C/E |
| canonical置換途中 | original/target混在、progress遅延 | hash分類→逆順restore。unknownならSTOP | 6C/E |
| 全canonical置換後 | 全target、decision未記録 | 正式な条件付き成功確定／rollback／STOP。no-opも別検証 | 6D/E |
| whole validation後 | target検証済みだがdurable方針なし | memoryの成功判断だけでforwardしない。直上と同じ | 6D/E |
| COMMIT_DECIDED直前 | 成功record tempかrecordなし | durable publication不明を実chainで判定 | 6A/D/E |
| COMMIT_DECIDED直後 | 成功方針あり | rollback禁止、元時刻/identityでforward | 6D/E |
| History write前 | intentに成功内容 | exact元recordをno-clobber公開 | 6D |
| History write途中／sync失敗 | tempまたは公開済みrecord | published phase・実bytes照合。同ID重複/別recordなし | 6D |
| History write後・state前 | Historyとconsumed state | History保持しstate headを一度だけfinalize | 6D |
| state update途中 | before/afterいずれかとtemp | hash/世代照合。二重加算なし、不明はSTOP | 6C/D |
| state update後・COMPLETED前 | 正しいhead/pending、journal遅延 | stateを再消費せずjournal完了 | 6D |
| COMPLETED後・cleanup前 | terminal evidence、残lock/temp | 成功保持、owner確認後cleanup。failureはcleanup_required | 6C/D/F |
| restore途中／rollback journal失敗 | backup、混在、rollback方針 | lock/artifacts保持、同方針で再開。成功へ転換しない | 6C |

各行にEACCES、ENOSPC、file locked、write/rename/link/fsync失敗とprocess強制終了を適用する。例外throwだけでcrash試験を代用しない。COMMIT_DECIDED以後の未知canonical変化は強制forwardで修復しない。

## 16. Request / retry / checkとの接続

existing Request lookup→semantic比較を新規preconditionより先に置く。元repository/Decision/Plan/Approval/actor、request_id、payload/receipt hash、requested_at、transaction_id、apply_idを保持し、retryはexecution entryにしない。初回branchだけにexecutionを接続する方式とowner証跡はDG-02で確定する。

元Request artifactはprocessingを含め書き換えない計画とする。ProcessingCacheはadvisory/hash-excludedで、表示用state/ref/diagnosticは検証済みjournal/Historyからresponseへ導出できるが、acceptedやcache refだけで未開始・成功・dispatch可否を決めない。既存設計の将来cache更新許容を、今回の実装必須要件やauthoritative更新と解釈しない。

初回/同payload retry/checkのresponseは引き続き`{artifact, readiness, diagnostics, result}`。resultはnullまたは`{apply_id, record_hash}`だけでfull HistoryRecordを埋め込まない。result非nullとrecovery_required/cleanup待ちは共存し得る。新readiness enumを作らない。terminal失敗の詳細表示とcompletion観測はDG-02/04で既存response制約内に具体化する。

受付後Invalidationのexact-target診断は維持し、既存Requestをcancelしない。受付前のcross-Approval衝突はpublication前に拒否したままにする。応答生成失敗がdurable受付後に起きても原本を削除せず、同IDの照会で回収する。Plan staleは既存guardを迂回せず、評価不能なら推測しない。

## 17. gate / concurrency / failure保持

Request・Invalidation・Decision等とTransactionは同common gateでserializeする。本人executionは元leaseを内部へ伝播しnested取得しない。leaseはprocess内の所有権、journalはcrash後のdurable証拠であり代替関係ではない。

現在の`withCanonicalGate()`はcallback例外でもreleaseを試みる。正式Transactionの「復旧が必要なjournal/rollback失敗ではlockを保持」とそのまま一致しない。これはSlice 2のbugと決め付けず、Transaction用の保持・移管lifecycleを追加する設計課題である（DG-03）。既存reader/通常callbackのrelease contractを変更しない。

Recovery mutex、live lease adoption、inode/全bytes検証、元owner終了証明、失敗時の保持を一体で扱う。stale/PID/経過時間だけのunlink、public force unlock、別の並行canonical lockは導入しない。common gateを一度空けて他operationを通す移管は禁止する。

## 18. Gitとの境界

Transaction成功はGit add/commit/push/PR/mergeを待たない。Git失敗でcanonical成功をrollbackしない。成功後に人間がcanonical・Decision・Approval・History・stateのdiffとvalidationを確認して通常Gitフローへ進む。Transaction中のcheckoutや非協調editorを保証対象へ含めない。Git自動化はv1対象外。

## 19. SCR-002 / CLIとの境界

SCR-002 楽曲管理画面、React、Backend/API、認証、DB、JOB-001は対象外。FN-004はUI非依存のapplication/domainとして実装し、将来Backendも同serviceを利用する。architecture overviewは変更しない。

必要entrypointは通常Applyの人間確認・初回受付/実行、Request/status/check/History照会、Recovery inspect→明示run、bootstrap check/initである。正式v1のbootstrap/Recovery実行はCLI限定。CLI command名・JSON/exit境界は既存interfaceを再利用し、詳細不足はDGへ戻す。6Fまで実Apply入口を公開しない。

## 20. test strategy

| Layer | 主な検証 |
| --- | --- |
| Unit（6Aから） | strict journal/intent/completion validation、hash/sequence/transition、file分類、pure Recovery decision、state projection。未知状態・別repository・誤Receipt・no-opを含む |
| Target / History unit（6Bから） | system binding、serializer引用/改行/UTF-8、既存row不変、9/14表区別、全operation results、record hash/chain/Plan prefix、metadata固定 |
| Integration | success/no-op、ID消費、canonical置換、History append/state finalization、Request不変、retry/check、別要求・Invalidation race |
| Recovery integration | receipt-only、PREPARED abort、partial rollback、全target例外、post-decision finalize、rollback後の通常readiness、success→rollback→次successの証明 |
| Process / filesystem | 15章全durable boundary、独立processのkill/restart、二重Recovery競合、owner証明欠如、partial metadata、sync未対応、cleanup失敗 |
| Existing regression | Decision/OCC/registry、Plan/stale、Approval/global scan/cross-binding、Request idempotency/response、History readonly、bootstrap/state、全canonical、rankings/site |

production dataをfixtureに書き戻さない。full Git history付きtemp clone/fixtureを利用し、data/staging inventoryを前後比較する。各実装PRはその単位のnegative/crash試験も同時に含める。既知GATE_CORRUPTが出たらexact failure保存、同head/main比較を行い、assertion緩和・skip追加で回避しない。

## 21. failure injection strategy

既存`createPersistence(root,{io})`、serviceのio/clock seam、repository fault testsの方法を拡張する。raw bytes writer、journal publisher、state publisher、lock移管のadapterを狭く分離し、FSのwrite/sync/link/rename/readを注入可能にする。時刻は一度採った値をfixtureで固定する。

6Aでjournal各phase・pure decisionのharness、6Bでbackup/temp/serializer、6Cでowner/restore/state terminal、6DでHistory/state/journal成功順序、6Eで全置換境界・初回dispatch、6Fで実processとCLIのend-to-endを追加する。failure injectionを最後の単位へ先送りしない。

必要ならtrusted in-process step hookを検討するが、client option、環境変数、productionのskip-validation分岐を認可に使わない。throwは通常error cleanupを走らせるため、hard crashを別processで試験する。検証に使ったfixture成功recordをproduction writerの代用にしない。

## 22. DESIGN GAP・実装前gate

以下は既存formal contractの不足を可視化したもので、Slice 1〜5のintegrity defectを発見したという意味ではない。安全要件と大きな状態遷移は既に決まっている。正確なartifact/API/proofを推測で決めず、**FN-004 Slice 6 Design Follow-up**で正式化・review・mergeしてから6Aへ進む。

| Gap | 現在の記述・不足判断 | 実装前に必要な理由 | 選択肢 / 推奨案（未承認） |
| --- | --- | --- | --- |
| DG-01 Evidence closed contract | Transaction文書にdirectory・必要情報・hash連鎖はあるが、journal/intent全field、version/hash projection、各stateのrequired/null、partial末尾/cacheとcheckpoint規則がない | strict scan、PREPARINGの未確定target/時刻、crash判定を同じ意味で実装できない | 個別追加fieldを実装任せにする案は不採用推奨。state別完全schemaと不変intent/checkpoint参照を正式docsへ定義し、固定vectorsを設ける案を推奨 |
| DG-02 Receipt completion / execution ownership | completion保存先と初回受付者のみdispatchは記載済み。完全completion schema、no-start証明、accept→executeのowner継承、terminal失敗の観測方法は未確定 | retry再dispatchやimmutable Request更新を避け、receipt-only crashを安全に終える必要 | 初回branchが同live leaseで内部executorへ継続する案を推奨。分離entryなら偽造不能な初回owner証明が必要。どちらもretryは照会のみ。方式とDTO/error境界を人間承認する |
| DG-03 Recovery gate lifecycle | mutex/停止証明/元lockを空けない移管は正式要件。現gateはWeakMap live tokenで移管APIなし、wrapperは例外時release | crash後token採用、partial lock、保持失敗時に別要求を通さない正確な手順が必要 | stale delete/reacquire案は正式要件に反し不可。通常gateを維持してRecovery限定adoption/retain/release protocolと各crash点を定義する案を推奨。OS証明不足はSTOP |
| DG-04 Terminal proof / rollback state | success-only-v1は既存正式契約。失敗の消費済みevent/generation gap、pending clear後のterminal証明、retained receiptの通常利用再開の完全contractがない | History成功を偽装せず、rollback後や次success時のchainを証明する必要 | History validatorを緩める案は不可。terminal journal/completionの検証結果を成功History proofと合成する新しい内部profile/registryを正式化する案を推奨。既存success-only APIを無断変更しない |
| DG-05 Typed error / inspect-action contract | 既存typed codesと概念的STOPはある。新journal破損・欠損・takeover失敗のcode対応、inspect出力とrun前提のexact契約は未確定 | message分岐や同じ不正状態の別解釈を避ける必要 | 既存INTEGRITY_CONFLICT/RECOVERY_REQUIRED等と元PERSISTENCE/History/Gate codeを保つ対応表・観測token/action契約を推奨。新codeが必要なら別途正式承認し、本計画では追加しない |

DG-01〜05は全て公開実行前のblocking design prerequisite。細部が不明だから全体Planningが不可能という状態ではなく、分割は下記の責務境界で成立する。Follow-upで既存schema/hash変更が必要と判明した場合は別途明示承認し、この計画を根拠に無断変更しない。

## 23. 分割候補の比較

| 案 | 評価 |
| --- | --- |
| 1 PRでTransaction+Recovery全体 | journal、canonical write、成功証明、owner移管、CLIを同時reviewするため大きすぎる。非推奨 |
| 6A Transaction / 6B Recovery | 復旧可能性が検証される前にwriterを作りやすく、失敗境界の手戻りが大きい。非推奨 |
| 3単位：foundation / execute / recovery | foundationは有効だが、成功finalizationとrollbackがexecuteの後付けになりやすい。内部をさらに分ける方が明確 |
| 6単位：evidence→prepare→rollback→finalize→orchestrate→CLI | 復旧・成功の両kernelを実行接続より先にfixtureで検証できる。各単位に明確な副作用上限と終了条件を置ける。推奨 |

## 24. 推奨するSlice 6A〜6F

### 6A — Transaction Evidence / Journal / Recovery Decision Foundation

- 目的：検証可能なdurable証跡とpure Recovery分類を共通基盤にする。
- 範囲：承認済みjournal/intent/completion validator・hash/sequence、immutable publisher/cache、discovery、状態遷移のpure model、original/target/unknown判定と許可action。
- 非対象：canonical write、ID/state mutation、History公開、owner takeover、公開Apply入口。
- 依存：Slice 1〜5、DG-01〜05のFollow-up。予定component：Transaction evidence/recovery decisionモジュール、repositoryのstrict dispatch、既存persistenceの再利用。
- 主要test：全closed fields・version・duplicate JSON、chain gap/fork、誤filename/binding、partial publish/cache欠落、no-op、全crash分類。
- 終了条件：不正証跡をskipせず、副作用なしで同一観測から決定的なaction/STOPを返す。通常readerのblockをまだ緩めない。
- handoff：後続が使うvalidated evidence/decisionとtemp/phase試験harness。

### 6B — Target Materialization / Durable Prepare / History Construction

- 目的：commit前に必要なreal targetと証拠を完成させる。
- 範囲：owned contextの再検証用pure helper共用、固定apply_time、serializer=1、全14 backup、changed temp、入力copy/intent、PREPARING→PREPARED、History builder（未公開）。
- 非対象：ID消費、canonical置換、History/state成功公開、外部dispatch。
- 依存：6A。予定component：Plan target/primitivesからの共通helper抽出、raw-byte preparation adapter、History construction。既存Planの意味は不変。
- 主要test：引用/改行/UTF-8、既存row/非変更bytes不変、全14/changed区別、template hashと実manifest、backup/temp各sync障害、real valid History record構築。
- 終了条件：PREPAREDが全証跡の完成を保証し、失敗でもcanonical/state/History不変。Hypothetical placeholderを実writeへ流さない。
- handoff：再検証可能なprepared transactionと元History材料。

### 6C — Recovery Ownership / Rollback / Terminal State Proof

- 目的：初めてのcommit writerより先に、安全な復元と失敗terminal証明を持つ。
- 範囲：Recovery mutex・owner停止/adoption/保持、receipt-only/prepare abort、restore adapter、ROLLING_BACK→ROLLED_BACK、消費を保持したpending解消、terminal proof composition。
- 非対象：通常forward commit、COMMIT_DECIDED後の成功公開、公開CLI。
- 依存：6A/6B。予定component：gateのRecovery限定lifecycle、rollback service、terminal/state proof。通常`withCanonicalGate`の意味は維持。
- 主要test：fixtureのpartial canonicalを逆順復元、途中kill/restart、消費済みID保持、owner不明STOP、二重Recovery、rollback後のproofと次成功prefixの合成。
- 終了条件：内部の復元writeはvalidated fixture/evidenceに限定。decision済みtransactionをrollbackしない。失敗時lock/evidence保持。post-decisionは6DへhandoffするまでSTOP。
- handoff：正常executorが失敗時に呼ぶrollback kernel、terminal proofとowned Recovery lease。

### 6D — Success Finalization / History Publication / Roll-forward Recovery

- 目的：不可逆成功方針以後を同じkernelで完了・再実行できるようにする。
- 範囲：COMMIT_DECIDED根拠の検証、exact History no-clobber公開、成功state head、HISTORY_COMMITTED/COMPLETED、forward Recovery、terminal cleanup。
- 非対象：通常canonical forward置換、初回Request dispatch、公開Apply入口。
- 依存：6A/6B/6C。予定component：History publisher、state transition writer、success finalizer、Recovery dispatcherへのpost-decision接続。
- 主要test：History前後・state前後・journal/cache/sync/cleanup失敗、同ID再送、no-op、result+recovery共存、unknown canonical拒否。
- 終了条件：検証済みtarget fixtureから全post-decision crashを同identity/時刻で完了できる。成功をrollback/二重公開しない。cleanup失敗で成功を消さない。
- handoff：commit kernelが成功方針確立後に使うfinalizer、両側のRecovery処理。

### 6E — Canonical Commit Orchestration / Request Lifecycle Integration

- 目的：検証済みprepare/rollback/finalizeをnormal Applyの一貫したcritical sectionへ接続する。
- 範囲：初回受付者のみの内部execution接続、COMMITTING、ID消費、9表順のchanged rename、全14実path validation、COMMIT_DECIDED、6C/D合成、terminal readinessと既存response evaluator接続。
- 公開制約：execution接続は内部composition / trusted harnessで検証し、既存public submitを実Applyへ切り替えるreleaseは6Fまで行わない。clientが指定できるenable/skip flagを作らない。
- 非対象：CLI公開、Browser/API、Git自動化、新schema/hash。
- 依存：6A〜6D。予定component：UI非依存transaction application service、Approval/Request application、runtime-state/Plan内部検証のcontext接続。
- 主要test：成功/非変更/no-op、全置換prefix crash、pre/post-decision、両Invalidation race、retained immutable Request、retry非dispatch、同ID異payload、success→rollback→次success。
- 終了条件：temp repositoryで初回受付からterminalまで一貫実行し、全failure matrixを通す。callerがproofを偽装してguardを迂回できない。公開commandはまだ追加しない。
- handoff：Recoveryを含めたservice-level end-to-end成功と公開前検証結果。

### 6F — FN-004 CLI / Status / Recovery Integration and Release Validation

- 目的：正式v1の人間操作・観測・復旧を薄いCLI adapterで完成させる。
- 範囲：既存interfaceに従う通常Apply確認、status/check/result/History、Recovery inspect/run、bootstrap導線、stdout/exit/非TTY/確認取消し、実process障害の最終統合試験。
- 非対象：SCR-002、React、HTTP/API/認証、JOB-001、Git自動化、DB。
- 依存：6A〜6E、全障害試験と独立review。予定component：正式CLI adapter/scriptsとintegration tests（具体名は実装PRで既存interfaceに従う）。
- 主要test：端末確認、wrong hash/action、未認証context、二重送信、SIGINT/timeout、crash後の明示復旧、元artifact不変、公開site回帰。
- 終了条件：CLIで確認→受付→成功/停止→結果照会→必要なRecoveryが安全に完結。全25章・26章条件を満たして初めて実Apply入口を公開する。
- handoff：FN-004完成判定・運用review。production Apply/初期化の実行は別の明示タスク。

## 25. 終了条件・依存の共通gate

各単位は実装・意味あるnegative/failure tests・formal照合・独立reviewを同時に完了する。fixtureだけ通ることをproduction実行可能の宣言にしない。6Cのrestore等の危険な内部writeをCLI/APIから先行公開しない。

依存順はDesign Follow-up→6A→6B→6C→6D→6E→6F。6Aのpure modelは両側のRecoveryを先に網羅し、6C/Dで副作用kernelを完成してから6Eの通常commitを接続する。各単位の予定componentは所有責務であり、同じvalidator/serializer/state遷移を別Sliceで再実装しない。

PRサイズが過大なら同じ安全境界内でさらにreview単位を分けられるが、テストを後回しにしたり、6Eの危険なwriteだけを先に公開したりしない。具体的diff量は実装前reviewで見積もり、意味のない空PR数を固定しない。

## 26. FN-004全体の完成条件

- confirmed Decisionからcurrent Plan生成、exact Approval、durable Request受付、immutable retry/checkが可能。
- 許可された既存参照/新規insertだけで実targetを構築し、全14表whole validation、既存値不変、予定ID再検証を満たす。
- gateとdurable journalでlogical all-or-nothingを守り、ID消費はCSV置換より先、上限/世代の巻戻し・二重消費なし。
- pre-decision失敗を安全にabort/rollbackし、全target例外を正式条件で判定する。post-decisionは元History/stateをforward finalizeする。
- successful History append/hash/chain/prefix/Decision/Plan/Receipt binding、state headとterminal証跡が整合する。
- rollbackによる消費を含む場合も、成功Historyの意味を変更せずterminal proofで通常利用可否を判定できる。
- receipt-only、全crash/restart、Recovery再送、owner不明、unknown artifact/hashを検証し、不明はfail-closed。stale lock自動削除なし。
- retry/checkの共通DTO・exact result参照、resultとrecovery/cleanupの独立性を維持。Request/Receipt/processing原本を書き換えない。
- 正式CLIと人間確認、bootstrap/Recovery CLI限定、status/inspectionの安全な導線と障害試験が揃う。
- Slice 1〜5・canonical・rankings・siteの回帰、FS/独立process tests、production artifact保護、独立最終reviewを通過する。

SCR-002やWeb API、定期JOB、DBの完成はFN-004完成条件に含めない。実装完了とproductionで初めてApplyを実施する承認も別である。

## 27. 実装順序・今回の検証

最初に本Planningの人間review/merge。その後**FN-004 Slice 6 Design Follow-up（DG-01〜05）**を正式docs-only PRとしてreview/mergeする。その確定contractへ照合して6Aの実装タスクを開始し、6B〜6Fへ順次進む。

本PlanningのvalidationはMarkdown/local link、diff check、full-history temp cloneでのnpm test / rankings validation / site buildとgenerated差分確認、data/stagingの独立開始/終了snapshot比較。コード・fixture・workflow・dependency・既存formal docsは変更しない。Planningでfailure injection runtimeやproduction Transactionを生成しない。

## 28. 次工程・非対象

次工程は実装ではなく、本Planning PRの人間reviewと**FN-004 Slice 6 Design Follow-up**である。最初の実装単位の名称は「FN-004 Slice 6A — Transaction Evidence / Journal / Recovery Decision Foundation」とするが、Design Follow-upのblocking gap解消前には開始しない。

Roadmap / feature-ids / architectureの更新、古い記述整理、UI/REST/hosting/DB選定は別follow-up。今回これらの既存文書は変更せず、実装・production artifact生成・PR mergeを行わない。
