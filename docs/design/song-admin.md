# CLI / SCR-002 Interface・Approval / Apply Request

FN-004 canonical反映機能とSCR-002 楽曲管理画面の正式v1設計。runtime・CLI・backend・frontendはいずれも未実装。[全体設計](canonical-registration.md)、[Decision](fn004-decision.md)、[Plan](fn004-apply-plan.md)、[Transaction](fn004-transaction.md)、[History readonly契約](fn004-history.md)を参照する。

## application boundary

```text
CLI ---------------------+
                         v
                 Application Service → FN-004 domain → repository/filesystem
                         ^
SCR-002 browser → authenticated backend
```

CLIとbackendが同じserviceを使う。revision/OCC、Plan hash、Approval、request idempotency、transaction/recoveryをadapterで重複実装しない。browserはCSV・JSON・lock・journal・Git・GitHub tokenを直接操作しない。任意pathやrowを実行用payloadとして受け取らない。

SCR-001は`site/`の静的公開を維持する。SCR-002 frontendは将来`admin/`等へ分離できるが、Pagesのstatic frontendだけでwriteは完結しない。管理機能を公開site artifactへ混ぜない。backend platform / hosting / DB / 認証provider / session / deployment / CSSは本設計の選定対象外。

SCR-002は閲覧から認証済み管理者専用。backendがtrusted actorを渡し、client申告actorを信用しない。CLIはfilesystemへアクセスできるlocal operatorを前提に、`local:<stable-id>, assurance: local_process`を記録する。将来のWeb actorは`admin:<stable-id>`等とし、個人情報は必要最小限。local実行をWeb認証済みと偽らない。未設定認証の公開backendはwriteを拒否する。

## Approval（人間の承認）

Decision confirmationは「identity判断は正しい」、Apply approvalは「この具体的Planを反映してよい」。異なる確認である。

`staging/apply-approvals/<approval_id>.json`へ独立immutable recordを保存しGit管理する。Decision/Planへ埋め込むと不変性と責務が混ざり、journalだけではtransaction前の承認を保存できないため採用しない。

Approvalの完全closed schema・approval_hashは[Approval / Request Hash Contract](fn004-approval-request.md)を正とする。既存のschema_version=1、apr_UUID、exact repository/Decision/Plan binding、approved_at、actor、purpose=canonical_apply、intended_request_idを維持する。approval_hashはartifact全体（schema_version・approval_id・approved_atを含む）のJCS/SHA-256であり、artifactに自己hash fieldは置かない。request UUIDを先にclient/applicationで生成してApprovalへbindingし、一つのrequest IDだけに使用する。

新Planへ旧承認を引き継がない。失効は`staging/apply-approvals/invalidations/<event_id>.json`にschema/version、対象approval_id/hash、reason、actor、時刻を追記してGit管理する。used / stale / invalidatedはHistory・receipt・失効recordから導出し、承認を書き換えない。一度失効した承認はデータが元へ戻っても復活させない。未知version・hash不整合はSTOP。

完全なversioned schema、ainv_UUID identity、受付前後のReceipt参照、全件readonly validation、duplicate/conflict、immutable persistenceは[Approval Invalidation Contract v1](fn004-approval-request.md#approval-invalidation-contract-v1)を正とする。新規受付の永久失効はAPPROVAL_INVALIDATED。durable受付後も失効eventは作成できるが、既存Requestの取消しにはならない。受付前失効とreceiptの矛盾はINTEGRITY_CONFLICTとする。

UIでは確認check＋「反映する」を一連にするが、内部はapproveApplyPlan → submitApplyRequest → executeTransaction。Approvalだけ保存してprocessが落ちた場合はApply未受付であり、GETや再読込によって自動実行しない。明示submitで元承認・元request ID・全preconditionを検証する。

## durable Apply Request（実行要求）

`staging/apply-requests/<request_id>.json`をtransaction journal開始前にdurable保存する。Requestは承認の証跡でも成功の証拠でもなく、実行要求と唯一のtransactionの対応を固定する。UUIDのrequest_idをclient/applicationで生成する。

ApplyRequestArtifactは`{schema_version:1,receipt,receipt_hash,processing}`。完全closed schemaと省略なしの例は[Hash Contract](fn004-approval-request.md)を正とする。schema_versionはenvelopeの外側だけ、Receiptにはrequest/repository/Decision/Plan/Approval identity、request_payload_hash、actor、requested_at、transaction/apply IDを置く。transaction/apply UUIDとrequested_atは初回durable受付時に一度だけ固定する。

request_payload_hashはversion/repository/request ID/Decision/Plan/Approval/actor/purposeのformal projectionをJCS/SHA-256でhashする。purposeは検証済みApprovalのexact literal canonical_applyをcopyするが、Receiptには重複保存せずschema v1から導出する。receipt_hashは`{schema_version:1,receipt}`のJCS/SHA-256。外側versionを含み、receipt_hash自身とprocessingを含めない。同ID同payload retryは元receiptの時刻/tx/apply IDを保持する。

processingはatomic replace可能なcacheであり、journal/Historyから照合・再構築する。受付拒否等のjournal開始前terminal結果はreceipt hashにbindingしたimmutable completion recordとして`staging/apply-requests/completions/<request_id>.json`へ保存する。cacheだけで実行済み/未実行を断定しない。

### 受付・retry・中断の契約

1. 認証/contextを確認し、既存requestを先に照会する。strict schema/両hashとformal semantic projectionを検証し、同ID同payloadは元receiptと現在状態/既存結果を返し、新dispatchしない。同ID異payloadはINTEGRITY_CONFLICT。新規受付preconditionより先にretryを判定し、stale/pendingでも照会を再実行許可と混同しない。
2. 新規要求は短い受付gate下でApproval存在/hash/actor/purpose/intended_request_id、有効性を検証する。他の未完了receipt/journal/ID pendingがあればBUSYまたはRECOVERY_REQUIRED。
3. receiptをexclusiveに完成・sync・no-clobber公開・directory syncして受付確定する。未完成fileや失敗は成功受付と返さない。受け付けたtransaction IDを以後変えない。
4. 初回受付者だけが同requestをexecution gate下で再検証しjournalへ進める。gate leaseを継続してもよい。新しいcallerによる同request再送は照会のみ。
5. stale/invalidでtransaction開始前に拒否する場合はcompletion recordをdurable保存してterminal化する。保存に失敗した場合は未完了要求として新規Applyを止める。
6. receipt後・journal前でcrashした場合は、他要求を開始せずrecoveryで元owner終了・元Plan・receipt・canonical/History/ID state/artifactsを検査する。副作用なしを証明できればABORTED completionを保存。証明不能ならSTOP。同requestのdispatchを推測で再開しない。
7. journal開始後は元transactionをrecoveryする。成功はHistory、途中はjournalが正式根拠。成功History/terminal journalがあればcompletion/cacheを修復できる。別request IDでも同Decision適用済み/進行中なら二重実行しない。

4〜7の承認再検証は、現在の新規利用可否と受付時のexact Approval bindingを区別する。[Invalidation contract](fn004-approval-request.md#approval-invalidation-contract-v1)のaccepted_requestが元receiptへexact bindする受付後eventだけを理由として、既存Requestをreject/cancel/rollbackしない。nullの受付前eventとreceiptの共存はINTEGRITY_CONFLICT。Invalidationはprocessing/Transaction/pending/Historyを変更せず、他の再検証・completion・Recovery契約は維持する。

receiptはGit非管理だが、未完了中は削除・GC禁止。完了後もv1は保管し、通常retryを照会可能にする。receiptが失われた場合も、approval・journal・Historyを照合せず新規実行しない。未適用を証明できなければSTOP。Historyにrequest identityを残すことで、local request cacheを失っても適用済みを判定できる。

## application service

| operation | 主入力・concurrency | 出力・副作用 |
| --- | --- | --- |
| listReviews / getReview | candidate ID / paging | source token付き支援DTO。判断の自動確定なし |
| getDecision | ID / revision | snapshot、有効confirmed、head token |
| saveDecisionDraft | input、base_revision/hash、source token、request key | gate下で新draft追記 |
| validateDecision | ID / revision/hash | field別diagnostics、confirm可否 |
| confirmDecision / cancelDecision | 表示snapshot/hash、base head、request key | 新immutable revision。再送は同結果 |
| generateApplyPlan / getApplyPlan | confirmed identity / Plan ID | immutable保存/取得 |
| approveApplyPlan | Plan identity、actor、確認token、intended request ID | immutable承認保存 |
| submitApplyRequest / getApplyRequest | receipt用payload / request ID | durable受付・初回dispatch / 結果照会 |
| inspectState / validatePlanForApply | repository / Plan identity | ready/busy/recovery、現時点診断 |
| executeTransaction | receipt・承認・固定Plan・gate lease | Design 3。browserへ直接公開しない |
| inspectRecovery / recoverTransaction | request/transaction ID、観測state hash、許可action | readonly診断 / 元要求の復旧 |
| initializeState / readCanonicalSnapshot | 監査hashの明示確認 / gate | bootstrap / 安定snapshot |

Decision保存schema・content hash・mutation key・source revisionのexact contractは[Decision](fn004-decision.md)、Plan payload/operation ID/orderは[Plan](fn004-apply-plan.md)、成功lookup/非初期state proofは[History](fn004-history.md)を正とする。Decision編集はbase headをserviceが比較し、古いtabを拒否する。変更操作のrequest keyは対象identity・actor・payloadへbindingし、duplicate confirmでrevisionを増やさない。未知versionはSTOP。runtimeの安全logicは共通serviceに置く。

## SCR-002 views・workflow

正式Feature IDはSCR-002だけ。内部viewへ新しい正式Feature IDを追加しない。viewは管理一覧、レビュー編集、Decision確認、Apply Preflight、Apply結果、System Statusの6つ。

```text
管理一覧 → レビュー編集 → Decision確認 → Apply Preflight → Apply → Apply結果
              ↑                 |               |
              +--- 判断修正 -----+               +→ stale → 必要な再レビュー/Plan再生成 → 再確認
任意view → system blocked → System Status → CLIの状態確認/復旧 → 通常操作再開
```

一覧はcandidate / draft / 有効confirmed / Plan / Historyから状態を導出する。共通workflow statusを新設しない。reviewはaggregate編集＋candidateごとのsource確認。共有entityを一度定義し、suggestionと人間判断を分離。draftは明示保存し未保存離脱警告を出す。古いtabのOCC conflictではbufferを保持して差分確認し、自動mergeしない。

Decision確認でcandidate全件、work/song/音源/version、creator/artist/performer、release/track、song初出日、prefix、evidence、未決を表示。「判断を確定する」はCSVを変更しないと説明する。新draftと既存confirmedを区別し、適用済み訂正を再Applyへ誘導しない。

confirmedから「反映内容を確認」でPlanを生成。entity/relation単位の新規追加・既存参照・追加不要を主表示し、raw CSV diffは詳細へ置く。予定IDは「反映成功時に確定」、timestamp bindingは「反映時刻」と表示する。sourceは判断ごとに紐付け、official_sourceとhuman_observationを区別する。

確認checkを入れて「反映する」を押す一連操作でApproval → Requestへ進む。名前/64文字hash再入力や多重dialogは通常不要。backendの確認tokenをrepository/actor/Decision/Plan hash/session/request/期限へbindingする。Planが変わればcheckとtokenを失効させる。clientが送るのはidentity/tokenでありrowではない。期限内でもDesign 3の再検証を省略しない。

### user state / errors

| 内部状態/code | 表示・主action | Apply / Decision保存 / recovery |
| --- | --- | --- |
| draft | 下書き。入力・判断確認 | 不可 / 可 / 不要 |
| confirmed | 判断確定済み。反映内容を確認 | Plan経由 / 新revision / 不要 |
| applicable | 反映予定を確認 | 再検証後可 / 新revision / 不要 |
| blocked / UNSUPPORTED_OPERATION | 要対応/対象外。判断へ戻る | 不可 / 新revision / 原則不要 |
| STALE_PLAN | 確認後にデータが変わった。再生成・再確認 | 不可 / 新revision / 原則不要 |
| APPROVAL_INVALIDATED | 承認は永久失効。現在のPlan/Historyを確認して新承認 | 新規受付不可 / 可否は既存条件 / 既存受付の取消しではない |
| CANDIDATE_FINGERPRINT_MISMATCH | 公式factsが変わった。Decisionから再確認 | 不可 / 新revision / 原則不要 |
| ALREADY_APPLIED | すでに反映済み。既存Historyへ | 不可 / 履歴修正のみ / 不要 |
| BUSY | 別処理進行中。状態再取得 | 不可 / 保存待ち・buffer保持 / 必要なら診断 |
| committed | 反映完了。確定ID・Git diff確認 | 同判断不可 / 新revision / 不要 |
| COMMITTED_PENDING_FINALIZATION | 反映済み、履歴等の後処理が必要 | 不可 / 保存停止 / 元tx finalize |
| cleanup_required | 反映完了、利用再開の後片付けが必要 | 不可 / gate依存 / cleanup |
| RECOVERY_REQUIRED | 前回処理の確認・復旧が必要 | 不可 / 保存停止 / CLI |
| rolled_back | 今回は元へ復元済み。原因確認・新Plan | 新確認後 / 可 / terminal整合済なら不要 |
| DECISION_HEAD_CONFLICT | 別画面で保存された。最新判断確認 | 不可 / 自動merge不可 / 不要 |
| APPROVAL_PLAN_MISMATCH / INTEGRITY_CONFLICT | 確認対象と要求が不一致 | 不可 / 原因確認 / 必要なら診断 |
| unknown_result | 結果確認中。再反映せずrequest照会 | 不可 / 状態確認 / 判定待ち |
| BOOTSTRAP_REQUIRED | 初期設定が必要。CLIへ | 不可 / 初期化待ち / bootstrap |

UIはmessage文字列で分岐せずcodeとallowed_actionsを使う。warningだけなら他の条件を満たす場合にApply可能だが、identity未決や必須evidence不足はerror。future releaseやoptional notes欠如でwarningを増やさない。

結果は追加entity/relation、確定ID、reuse/no_op、変更CSV、日時、Historyを主表示し、request/approval/transaction/apply/Decision/Plan identityは詳細へ。no-opのみは「既存と一致し、確認結果を記録した」と表示する。COMMITTED_PENDING_FINALIZATIONを単純な失敗へ変換したり再Applybuttonを出したりしない。

double clickは同request、refresh/backはGET相当の結果取得、timeoutは失敗と断定しない。UI button disableだけで二重実行を防いだと扱わない。busy中は安全なimmutable履歴・状態照会のみ可能。未完了時はblocking bannerとし、System StatusでCLIへ案内する。lock削除・force操作・recovery自由選択は提供しない。

## CLI（未実装の提案command）

新npm scriptを`canonical:manage`にまとめる。既存の`collect:candidates` / `prepare:reviews` / `rankings:generate`は維持する。以下は設計例で、現package.jsonには追加していない。

```text
npm run canonical:manage -- status
npm run canonical:manage -- init --check
npm run canonical:manage -- init --expect-audit-hash <hash>
npm run canonical:manage -- decision template --candidate <id>
npm run canonical:manage -- decision import --input <external-input.json>
npm run canonical:manage -- decision show <id>
npm run canonical:manage -- decision validate <id> --revision <n>
npm run canonical:manage -- decision confirm <id> --revision <n> --expect-head <hash>
npm run canonical:manage -- plan create --decision <id> --revision <n> --expect-decision-hash <hash>
npm run canonical:manage -- plan show <plan-id>
npm run canonical:manage -- plan check <plan-id>
npm run canonical:manage -- apply --plan <plan-id> --expect-plan-hash <hash>
npm run canonical:manage -- result --request <request-id>
npm run canonical:manage -- history show <apply-id>
npm run canonical:manage -- recovery inspect --request <request-id>
npm run canonical:manage -- recovery run --transaction <tx-id> --expect-state-hash <hash> --action <recommended-action>
```

CLI workflowはbootstrap監査/確認 → 外部template入力/import → draft表示/検証 → confirm → Plan生成/表示 → 人間確認 → 同Plan/hashのapproval → durable Request → transaction → 結果。外部入力documentは正式storeの手編集ではなくserviceで検証・取込し、ID/revision/actorはserviceが決める。

ApplyはTTYにrepository、Decision、追加内容、予定ID、reuse/no_op、warning、変更CSVを表示し`[y/N]`で一度確認。その後独立approval保存→request受付を行う。`--yes`だけの迂回、非TTY承認、CIからのcanonical Applyはv1対象外。Plan生成とApplyを暗黙連結しない。確認取消しは承認/受付前で終える。receipt後のSIGINT/通信切断では勝手にlock削除せず元要求を照会する。

bootstrapは[正式bootstrap契約](fn004-bootstrap.md)の必須external declaration・origin/main全reachable監査・expected audit hashを使う。check結果を表示し、人間確認後のinitializeで再監査する。CLIの外部declaration入力option名は実装sliceで決めるが、宣言の省略・自動補完は不可。片側state/markerや不一致を初期設定buttonへ誘導せず、BOOTSTRAP_INCOMPLETE / RECOVERY_REQUIREDとして案内する。

bootstrap・全recovery実行はCLIのみ。inspectで観測state hashと一意な推奨actionを示し、runで同hash/actionを再検証する。action不一致・状態不明ならSTOP。stale強制Apply、validation/lock bypass、arbitrary patch、force delete lockは提供しない。

`--json`のstdoutは単一JSON、prompt/進捗はstderr。outcome、canonical_effect、readiness、各identity、diagnostics、allowed_actionsを返す。exit codeは0=取得/操作成功（already_applied含む）、1=想定外/不明、2=引数、3=validation/blocked/unsupported、4=stale、5=busy、6=recovery、7=成功後finalize/cleanup待ち、8=OCC/integrity conflict、9=権限、10=実行前取消し、11=aborted/rolled_back、12=bootstrap required/incomplete。status/showは問題状態を正常取得できれば0で、Apply可能と同義ではない。

## traceability・Git・観測

Candidate → Decision revision → Plan → Approval → Request → Transaction → History → actual IDsを双方向に辿れるようにする。PlanとHistoryは常に1対1とは限らない。ログは補助診断であり新しい正本にしない。

Apply成功後はcanonical/Decision/Approval/History/stateのGit diff確認 → test/validation → 必要なsite buildと生成物diff → 通常commit/push/PR。自動Git操作はv1対象外。Git失敗・site build失敗で成功Applyをrollbackしない。未commitを未反映と表示しない。

## 実装順・検証

domain / validator → repository / gate → bootstrap/state → Decision → Plan → Approval/Request → transaction/History/recovery → CLI検証 → backend → frontend。CLIは各serviceの薄いadapterを段階追加するが、正常系commitだけで実Applyを公開しない。

| slice | 主対象・依存 | 完了条件 |
| --- | --- | --- |
| 1 | schema/hash・全14表validator | PR #56で実装済み。実canonical変更なし |
| 2 | repository・gate・persistence（1） | PR #57で実装済み。安定読込・排他・durability primitive |
| 3 | bootstrap / repository instance / ID state（1,2） | PR #59実装、#60 CI full history、#61 production genesis確立。正式CLIなし |
| 4 | Decision + Apply Plan（1〜3） | 完全schema/revision/OCC/指紋、immutable payload・mapping・stale、History readonly。CLIなし |
| 5 | Approval + Apply Request / idempotency（4） | hash binding、receipt前後の中断/重複を検証 |
| 後続 | transaction prepare/commit/rollback（1〜5） | journal/temp/backup/ID消費、fault injection。実Apply入口は非公開 |
| 後続 | History・forward finalize・recovery（transaction） | 全crash matrix、receipt-only復旧を含む |
| 後続 | CLI Apply/recovery統合（recovery検証後） | end-to-end/障害試験合格後に実Apply公開 |
| 後続 | backend adapter・管理者境界（CLI統合後） | 同service利用、認証未設定write拒否 |
| 後続 | SCR-002の6 view（backend後） | OCC・承認・再送・異常UXを検証 |

Slice 4をDecision + Plan、Slice 5をApproval + Requestとして統合し、後続slice/PR数は固定しない。大きければさらに分割し、単独review・復元・test可能性を優先する。frontend mockは先行可能だが実write接続はCLI実Apply統合完了後。認証providerの選定は別途でも、無認証writeを暫定公開しない。

interface testsはCLI success/stale/already_applied/busy/blocked/確認取消し/非TTY/wrong hash/exit・JSON、UI複数tab/refresh/back/double submit/timeout、approval actor/repository/hash不一致、同request異payload、承認後receipt前・receipt後journal前のcrash、結果不明時の照会を含む。transactionの全rename/sync/journal/History/state前後でfault injectionを行い、UIがpending finalizationを失敗へ潰さないことも検証する。

### Slice 5 runtime API

`src/fn004-approval-schema.js` defines the closed v1 Approval, Invalidation,
Request/Receipt validators, ID generators and the three projections from
[the formal contract](fn004-approval-request.md). `createApprovalRequestService`
in `src/fn004-approval-application.js` exposes `approveApplyPlan`, `getApproval`,
`checkApproval`, `invalidateApproval`, `getApprovalInvalidation`,
`getApprovalInvalidations`, `submitApplyRequest`, `getApplyRequest` and
`checkApplyRequest`. The service is a trusted in-process boundary: the second
argument supplies `{actor, gate?}` from operator/backend context, never directly
from an untrusted client's actor field. Caller inputs are captured before awaits.

Approval creation accepts `{approval_id, plan_id, plan_hash, intended_request_id}`;
Invalidation accepts `{event_id, approval_id, approval_hash, reason}`. Generate
random IDs once with the schema module's helpers and retain them across retries.
The application fixes publication timestamps. Submission takes the complete
closed RequestPayloadProjectionV1 command. Create/read/submit return the original
artifact; check APIs provide current diagnostics (Request check includes the
artifact and runtime readiness). Receipt presence means durable acceptance only.
Retry does not dispatch work, and a recovery diagnostic does not cancel receipt
acceptance. Repository methods retain immutable/no-clobber publication, strict
loads and full Invalidation listing under the common live lease.

Only initial `accepted` processing is generated. Unknown execution evidence,
missing referenced receipts and unresolved publication temps stop normal use;
no completion/journal validator, cancellation, cleanup or execution is inferred.
Receipt files are local and ignored by Git; Approval/Invalidation remain tracked.
Tests publish artifacts exclusively inside temporary fixture repositories.
