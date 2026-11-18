# 楽曲管理のアプリケーションサービス・CLI契約

本書はFN-004の共通アプリケーションサービスと公開CLIの正式v1契約を示す。FN-004 runtime と Slice 6F の公開 CLI は実装済み。コマンド構文・オプションと操作手順は[操作ガイド](../../management/FN-004-canonical操作ガイド.md)を参照する。SCR-101 と認証済み Web backend は設計済み・未実装であり、以下の Web 境界は将来の接続条件とする。[画面設計](../screens/SCR-101-楽曲管理画面.md)・[全体フロー](レビュー準備・canonical反映の全体フロー.md)を参照する。

## application boundary

```text
CLI ---------------------+
                         v
                 Application Service → FN-004 domain → repository/filesystem
                         ^
SCR-101 browser → authenticated backend
```

CLIとbackendが同じserviceを使う。revision/OCC、Plan hash、Approval、request idempotency、transaction/recoveryをadapterで重複実装しない。browserはCSV・JSON・lock・journal・Git・GitHub tokenを直接操作しない。任意pathやrowを実行用payloadとして受け取らない。

公開サイトは`site/`の静的公開を維持する。SCR-101 frontendは将来`admin/`等へ分離できるが、Pagesのstatic frontendだけでwriteは完結しない。管理機能を公開site artifactへ混ぜない。backend platform / hosting / DB / 認証provider / session / deployment / CSSは本設計の選定対象外。

SCR-101は閲覧から認証済み管理者専用。backendがtrusted actorを渡し、client申告actorを信用しない。CLIはfilesystemへアクセスできるlocal operatorを前提に、`local:<stable-id>, assurance: local_process`を記録する。将来のWeb actorは`admin:<stable-id>`等とし、個人情報は必要最小限。local実行をWeb認証済みと偽らない。未設定認証の公開backendはwriteを拒否する。

## Approval（人間の承認）

Decision confirmationは「identity判断は正しい」、Apply approvalは「この具体的Planを反映してよい」。異なる確認である。

`staging/apply-approvals/<approval_id>.json`へ独立immutable recordを保存しGit管理する。Decision/Planへ埋め込むと不変性と責務が混ざり、journalだけではtransaction前の承認を保存できないため採用しない。

Approvalの完全closed schema・approval_hashは[Approval / Request Hash Contract](../functions/FN-004-承認・反映リクエスト.md)を正とする。既存のschema_version=1、apr_UUID、exact repository/Decision/Plan binding、approved_at、actor、purpose=canonical_apply、intended_request_idを維持する。approval_hashはartifact全体（schema_version・approval_id・approved_atを含む）のJCS/SHA-256であり、artifactに自己hash fieldは置かない。request UUIDを先にclient/applicationで生成してApprovalへbindingし、一つのrequest IDだけに使用する。

新Planへ旧承認を引き継がない。失効は`staging/apply-approvals/invalidations/<event_id>.json`にschema/version、対象approval_id/hash、reason、actor、時刻を追記してGit管理する。used / stale / invalidatedはHistory・receipt・失効recordから導出し、承認を書き換えない。一度失効した承認はデータが元へ戻っても復活させない。未知version・hash不整合はSTOP。

完全なversioned schema、ainv_UUID identity、受付前後のReceipt参照、全件readonly validation、duplicate/conflict、immutable persistenceは[Approval Invalidation Contract v1](../functions/FN-004-承認・反映リクエスト.md#approval-invalidation-contract-v1)を正とする。新規受付の永久失効はAPPROVAL_INVALIDATED。durable受付後も失効eventは作成できるが、既存Requestの取消しにはならない。受付前失効とreceiptの矛盾はINTEGRITY_CONFLICTとする。

UIでは確認check＋「反映する」を一連にするが、内部はapproveApplyPlan → submitApplyRequest → executeTransaction。Approvalだけ保存してprocessが落ちた場合はApply未受付であり、GETや再読込によって自動実行しない。明示submitで元承認・元request ID・全preconditionを検証する。

## durable Apply Request（実行要求）

`staging/apply-requests/<request_id>.json`をtransaction journal開始前にdurable保存する。Requestは承認の証跡でも成功の証拠でもなく、実行要求と唯一のtransactionの対応を固定する。UUIDのrequest_idをclient/applicationで生成する。

ApplyRequestArtifactは`{schema_version:1,receipt,receipt_hash,processing}`。完全closed schemaと省略なしの例は[Hash Contract](../functions/FN-004-承認・反映リクエスト.md)を正とする。schema_versionはenvelopeの外側だけ、Receiptにはrequest/repository/Decision/Plan/Approval identity、request_payload_hash、actor、requested_at、transaction/apply IDを置く。transaction/apply UUIDとrequested_atは初回durable受付時に一度だけ固定する。

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

4〜7の承認再検証は、現在の新規利用可否と受付時のexact Approval bindingを区別する。[Invalidation contract](../functions/FN-004-承認・反映リクエスト.md#approval-invalidation-contract-v1)のaccepted_requestが元receiptへexact bindする受付後eventだけを理由として、既存Requestをreject/cancel/rollbackしない。nullの受付前eventとreceiptの共存はINTEGRITY_CONFLICT。Invalidationはprocessing/Transaction/pending/Historyを変更せず、他の再検証・completion・Recovery契約は維持する。

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
| submitApplyRequest | receipt用semantic payload | 初回durable受付／同payload retry。共通Request response DTO。retryはdispatchしない |
| checkApplyRequest | request ID | readonly current-state照会。submitと同じRequest response DTO |
| getApplyRequest | request ID | strict/static検証済み保存artifact原本だけを取得 |
| inspectState / validatePlanForApply | repository / Plan identity | ready/busy/recovery、現時点診断 |
| executeTransaction | receipt・承認・固定Plan・gate lease | Design 3。browserへ直接公開しない |
| inspectRecovery / recoverTransaction | request/transaction ID、観測state hash、許可action | readonly診断 / 元要求の復旧 |
| initializeState / readCanonicalSnapshot | 監査hashの明示確認 / gate | bootstrap / 安定snapshot |

Decision保存schema・content hash・mutation key・source revisionのexact contractは[Decision](../functions/FN-004-判断モデル.md)、Plan payload/operation ID/orderは[Plan](../functions/FN-004-反映計画.md)、成功lookup/非初期state proofは[History](../functions/FN-004-成功履歴・読取検証.md)を正とする。Decision編集はbase headをserviceが比較し、古いtabを拒否する。変更操作のrequest keyは対象identity・actor・payloadへbindingし、duplicate confirmでrevisionを増やさない。未知versionはSTOP。runtimeの安全logicは共通serviceに置く。

### Apply Request response

初回submit成功・same-payload retry・checkの完全response契約は[Apply Request application response contract v1](../functions/FN-004-承認・反映リクエスト.md#apply-request-application-response-contract-v1)を正とする。全field requiredの`{artifact,readiness,diagnostics,result}`を返す。artifactは保存原本、readinessは現在のrepository利用可否、diagnosticsは現在の検証code、resultはnullまたは検証済みsuccessful Historyへの`{apply_id,record_hash}`参照。HistoryRecord全体を含めず、詳細は既存History readonly APIから取得する。

保存artifactのprocessingはadvisory cacheのままで、responseへ合わせて書き換えない。result非nullとrecovery_requiredは共存し、成功Historyだけでjournal完了・pending解消・cleanup完了を断定しない。accepted/completed/already_appliedをreadiness enumに追加しない。Slice 5 時点ではRequest存在が通常runtimeをblockするため、初回受付直後でもrecovery_required / RECOVERY_REQUIREDを返し得る。受付成功と通常利用可能は別である。

既存Request照会では元Receiptを維持し、新規受付preconditionを再適用しない。受付後失効は現在診断として返し、Plan staleは既存guardを迂回せず検証できた場合だけ診断する。同ID異payload・原本破損・参照不整合は引き続きtyped error。code別のthrow/diagnostic境界、評価順、null resultの意味はリンク先matrixに従う。初回submitだけartifactを直接返す旧実装説明は採用しない。Transaction dispatch/execution、Recovery、History publicationをこのresponse評価に含めない。

### Web の確認 token

将来の backend は確認 token を repository、trusted actor、Decision、Plan hash、session、request、期限に結び付ける。Plan 変更時は確認と token を失効させる。client が渡すのは identity と token であり、実行用 row ではない。期限内でも Transaction の再検証を行う。この確認は Decision confirmation や CLI の TTY 確認とは別の画面接続条件である。

## CLI（設計例とSlice 6F接続）

公開CLIの入口は `npm run canonical:manage -- <command>`。既存の`collect:candidates` / `prepare:reviews` / `rankings:generate`は維持する。以下はSlice 6F接続前の設計例。現行の実行構文、オプション、外部入力の例は[操作ガイド](../../management/FN-004-canonical操作ガイド.md)を参照する。

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

bootstrapは[正式bootstrap契約](../functions/FN-004-初期化・ID状態.md)の必須external declaration・origin/main全reachable監査・expected audit hashを使う。check結果を表示し、人間確認後のinitializeで再監査する。外部declarationの入力オプションは操作ガイドを参照する。宣言の省略・自動補完は不可。片側state/markerや不一致を初期設定buttonへ誘導せず、BOOTSTRAP_INCOMPLETE / RECOVERY_REQUIREDとして案内する。

bootstrap・全recovery実行はCLIのみ。inspectで観測state hashと一意な推奨actionを示し、runで同hash/actionを再検証する。action不一致・状態不明ならSTOP。stale強制Apply、validation/lock bypass、arbitrary patch、force delete lockは提供しない。

`--json`のstdoutは単一JSON、prompt/進捗はstderr。outcome、canonical_effect、readiness、各identity、diagnostics、allowed_actionsを返す。exit codeは0=取得/操作成功（already_applied含む）、1=想定外/不明、2=引数、3=validation/blocked/unsupported、4=stale、5=busy、6=recovery、7=成功後finalize/cleanup待ち、8=OCC/integrity conflict、9=権限、10=実行前取消し、11=aborted/rolled_back、12=bootstrap required/incomplete。status/showは問題状態を正常取得できれば0で、Apply可能と同義ではない。

## traceability・Git・観測

Candidate → Decision revision → Plan → Approval → Request → Transaction → History → actual IDsを双方向に辿れるようにする。PlanとHistoryは常に1対1とは限らない。ログは補助診断であり新しい正本にしない。

Apply成功後はcanonical/Decision/Approval/History/stateのGit diff確認 → test/validation → 必要なsite buildと生成物diff → 通常commit/push/PR。自動Git操作はv1対象外。Git失敗・site build失敗で成功Applyをrollbackしない。未commitを未反映と表示しない。

## 実装順・検証

以下は導入時に定めた順序と検証条件。Transaction・History・Recovery・公開CLIはSlice 6Fまでに接続済み。管理Web BackendとSCR-101は未実装。

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
| 後続 | SCR-101の6 view（backend後） | OCC・承認・再送・異常UXを検証 |

Slice 4をDecision + Plan、Slice 5をApproval + Requestとして統合し、後続slice/PR数は固定しない。大きければさらに分割し、単独review・復元・test可能性を優先する。frontend mockは先行可能だが実write接続はCLI実Apply統合完了後。認証providerの選定は別途でも、無認証writeを暫定公開しない。

interface testsはCLI success/stale/already_applied/busy/blocked/確認取消し/非TTY/wrong hash/exit・JSON、UI複数tab/refresh/back/double submit/timeout、approval actor/repository/hash不一致、同request異payload、承認後receipt前・receipt後journal前のcrash、結果不明時の照会を含む。transactionの全rename/sync/journal/History/state前後でfault injectionを行い、UIがpending finalizationを失敗へ潰さないことも検証する。

### Slice 5 導入時点の runtime API

`src/fn004-approval-schema.js` defines the closed v1 Approval, Invalidation,
Request/Receipt validators, ID generators and the three projections from
[the formal contract](../functions/FN-004-承認・反映リクエスト.md). `createApprovalRequestService`
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
closed RequestPayloadProjectionV1 command. Approval create/read and Request get
return the original artifact. Request submit (initial/retry) and check return the
common response DTO defined above, including current diagnostics and a verified
History reference. Receipt presence means durable acceptance only.
Retry does not dispatch work, and a recovery diagnostic does not cancel receipt
acceptance. Repository methods retain immutable/no-clobber publication, strict
loads and full Invalidation listing under the common live lease.

Only initial `accepted` processing is generated. Unknown execution evidence,
missing referenced receipts and unresolved publication temps stop normal use;
no completion/journal validator, cancellation, cleanup or execution is inferred.
Receipt files are local and ignored by Git; Approval/Invalidation remain tracked.
Tests publish artifacts exclusively inside temporary fixture repositories.

## Slice 6 ownershipとRecovery actionの正本

[TransactionのSlice 6 evidence contract v1](../functions/FN-004-反映処理・復旧.md)で初回submitの同live lease継続、immutable completion/terminal proof、readonly inspectと明示runのclosed action/観測hashを定義する。retry/checkは引き続き非dispatch、Request response DTOとCLI既存exit tableは不変。初回接続は6E/F、公開CLIは6Fで実装済み。bootstrap/Recovery実行のCLI-onlyを維持し、Browser/API用実行入口は追加しない。ProcessingCacheの将来更新許容を、この接続での保存原本更新要件にしない。


### FA-M01 Gate公開異常の扱い

[Gate公開契約](../functions/FN-004-Gate公開契約.md)を適用する。安定valid BUSYはexit 5、不正finalは8、取得/公開不明は1、permissionは既存優先規則で9、release失敗は6。freshな正式証拠で成功効果を証明できるfinalization待ちだけ既存exit 7となる。candidateの存在から結果を推測しない。内部の観測値と公開 JSON の項目は異なる。CLI の公開項目と優先順は [CLI 出力実装](../../../src/canonical-cli-output.js)、容量監視と手動停止は[操作ガイド](../../management/FN-004-canonical操作ガイド.md#fa-m01-gate公開異常の扱い)を参照する。
