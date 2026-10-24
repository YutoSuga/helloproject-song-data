# FN-004 successful Apply History / readonly verification

本書はsuccessful Historyの**完全なv1保存schema・hash・chain/set・readonly proof契約**の正本。[Decision](fn004-decision.md)の共通型、[Plan](fn004-apply-plan.md)、[bootstrap/state](fn004-bootstrap.md)を利用する。publication、journal、rollback/recovery実行は[Transaction](fn004-transaction.md)の責務。本follow-upではHistoryを書かず、Slice 4が読み取りだけを推測なく実装できる境界を定義する。現runtimeのnon-genesis fail-closedを、この文書追加だけで解除しない。

## path・layout・closedness

Git-managed `staging/apply-history/<apply_id>.json`、ApplyIDは`apply_<小文字UUID v4>`。transaction_idは同UUIDの`tx_`形式。1成功1 immutable JSON、JSONL/一つのmutable全履歴fileにしない。完成tempのfile sync/reread→no-clobber公開→directory sync。同ID同検証済みsemantic record_hashは既存結果、異hashはintegrity STOP。保存済みrecord全内容を変更せず、metadataを含め上書きしない。

このdirectoryに許すentryは上記正規名のregular JSON fileだけ。subdirectory、symlink、未知file、temp、非JSON、重複apply_id/sequence/transaction IDは`HISTORY_CORRUPT`。同recordを別名で二重保存しても拒否する。filesystem listing順を使わず全件検証後にsequence順へ並べる。途中/破損recordをskipしない。失敗、ABORTED、ROLLED_BACK、進行中の処理は成功Historyに含めない。

本書の全objectはclosed、全field必須。null可否・array順は以下のとおり、未知versionはSTOP。厳密UTF-8/JCS、string無変換、safe integer、Hash/Manifest/Actorの型はDecision共通規則を使う。

## record schema / hash

artifact rootの全fieldは次のとおり。

| field | 型・契約 |
| --- | --- |
| schema_version | `1`（history_record） |
| payload | 以下のHistoryPayload |
| record_hash | `hashCanonicalJson(payload)` |
| decision_snapshot | 完全な保存済みconfirmed Revision（metadataも含む）。payload.decision identity/content_hashと一致 |
| plan_snapshot | 完全なPlan artifact（generated_atも含む）。payload.planと一致、Decision identity一致、applicable=true |
| metadata | `{published_at:Timestamp}`。最初のpublication intent時に固定する表示metadata |

HistoryPayloadの**全field**：

| field | 型・契約 |
| --- | --- |
| schema_version | `1`（history hash payload version。history_hash=1） |
| repository_instance_id / bootstrap_hash | RepositoryID / Hash |
| sequence / previous_history_hash | 正整数 / Hash |
| apply_id / transaction_id | ApplyID / 同UUIDのTransactionID |
| decision | DecisionIdentity |
| plan | `{plan_id:PlanID,plan_hash:Hash}`、ID suffix=hash |
| approval | `{approval_id:apr_UUID,approval_hash:Hash}` |
| request | `{request_id:UUID,request_payload_hash:Hash}` |
| actor | 実行受付のtrusted Actor |
| candidate_coverage | CandidateResult[]、candidate_id ASCII順 |
| id_mappings | FinalIDMapping[]、Planのplanned allocation順 |
| results | OperationResult[]、Plan.operations順 |
| before_manifest / after_manifest | 全14 Manifest（完全型・各hash検証） |
| state_transition | `{before:Fn004State, consumed:Fn004State, allocation_ranges:AllocationEvent[]}`。以下の遷移規則に従う |
| apply_time / applied_at | Timestamp / Timestamp、apply_time <= applied_at（実時刻比較）。前者target生成、後者COMMIT_DECIDED時に一度固定 |
| rules | `{plan:PlanRules,transaction:1,history_record:1,history_hash:1,history_chain:1,history_set:1,state_proof:1}` |

payloadはrecord_hash自身を持たない。decision_snapshotはDecision content_hash、plan_snapshotはplan_hashを通じてsemantic contentをbindingし、snapshotの表示metadataはHistory hashへ混ぜない。readonly検証では保存当時のschema/hash/参照/Plan内部整合を検査し、過去Decisionが現在もeffectiveであることや過去candidateが今も同じことを要求しない。過去Planのstatic検証はschema/hash/ID/row-template/mapping/dependency/applicabilityの内部整合までとし、before CSV全bytesを持たないHistory readerに過去whole target再生成やtarget_semantic_hashの再計算を要求しない。そのhashの元検証はpublication前writerがbefore/target snapshotで証明する。source draft/registry全体の当時の操作検証もpublication前のwriter責務で、confirmed snapshot単独の構造検証とstore全履歴transition検証を混同しない。before/consumed stateはstate_hashだけでなく**全state document（initialized_at含む）**がpayload内のhash対象。Historyは自分を参照する最終state_hashを保存しないので循環しない。

外部path、PID、machine、現在時刻を再計算してpayloadへ足さない。apply_time/applied_at/actorは一度確定した成功事実としてhashに含む。published_at/Plan.generated_at/Decision.metadataは表示情報としてhash外だが、保存後の手編集は認めない。record hashは署名やoperator認証の代替ではない。

### 最小Approval / Request参照境界

Historyに必要なのは上記immutable identity/hash参照だけであり、Approval/Receiptの完全snapshotやprocessing cacheを要求しない。これらのfull schema / approval hash / request payload hashの実行時照合は[interface契約](song-admin.md)を正とし、本書は新しい受付方式を定義しない。

future writerはpublication前に元Approvalが同repository/Decision/Plan・purpose=canonical_apply・intended_request_id=request_id、元receiptが同approval/hash/request payload/actor/tx/apply identityであることを検証する。readonly History validatorはreference grammarと同record/Plan内のlinkを検証し、GC済み非Git receiptの不在を成功取消しと扱わない。Approval原本を現在の有効性で再承認する操作でもない。逆に、参照Hashの形式だけでreceiptを復元/再dispatchしてよいとは意味しない。

### candidate / final ID / operation results

CandidateResultの全fieldは`{candidate_id:Nonempty,source_identity:SourceIdentity,fingerprint:Fingerprint,work_id:W ID,song_id:Song ID,release_track_keys:Key(release_tracks)[]}`。Decision scopeと集合一致し、projection/identity/fingerprintはsnapshotと一致。work/song/track keysはDecision refsをPlan mappingで解決した結果と一致させる。release_track_keysはPK comparator順、重複なし。同じsongが複数candidate/trackから使われることは正常。

FinalIDMappingの全fieldは`{entity_type,local_ref,namespace,canonical_id}`。PlanのPlannedIDMappingのplanned_idだけcanonical_idに名称変更したもの。全件対応・値一致必須、partial成功不可。existing IDのreverse lookupはresultsのreuse/keyで可能。relation refはPlan.operationsのsource.subject.refから実keyへ追跡する。

OperationResultの全fieldは`{operation_id,classification:"reuse"|"insert"|"no_op",table:Table,key:Key,row:Row,row_hash:RowHash}`。全Plan operationを一度ずつ同順に含む（conflict/unsupportedがあるPlanは成功recordにできない）。insertはTemplateの指定timestampだけapply_timeで置換した完全row、reuse/no_opは元existing_rowを全列不変で保存。row_hashは`hashCanonicalJson({table,row})`。FK、PK、planned ID、candidate mappingと一致を再検証する。

before_manifestはPlan.canonical_preconditionと完全一致。after_manifestはcommit後の全14実path再読込/whole validationで確定したもの。insertが0件ならbefore=after必須。readonlyで過去CSV blobの全bytesを再取得することは要求せず、保存Manifestの構造/hashとPlan/resultsを検証する。現在canonicalの独立whole validation/raw manifest・Git完全監査も必要であり、保存済み成功記録だけで現在bytesをvalidにしない。

## chain / semantic set

sequenceは1からcountまで連続、欠番なし。sequence=1のprevious_history_hashはbootstrap_hash、以後直前record_hash。全recordは同repository/bootstrap。fork/branch/複数head、未連結record、重複sequence、cycle、余分な未参照recordは`HISTORY_CHAIN_MISMATCH`。record内Plan.history_preconditionは**そのrecord以前のprefix**のcount/head/last/semantic_hashと一致させる。

semantic set projectionの完全schemaは`{schema_version:1,repository_instance_id,bootstrap_hash,records:[{sequence,apply_id,record_hash}]}`。recordsはsequence数値昇順。`semantic_hash=hashCanonicalJson(projection)`。ファイル名/空白/metadata/mtime/listing順をhash対象にしない。semantic record改変・追加・除去・順序入替を検出し、各record_hash経由で結果/判断/Plan/stateをbindingする。空集合もrecords=[]のprojectionをhashする。

state.historyはvalidated chainの`{count,head_hash,last_apply_id}`と完全一致。count=0のhead=bootstrap_hash、last=null。count>0のhead=最終record_hash、last=最終apply_id。countとrecord実数の不一致、directory欠落（count>0）は`HISTORY_CHAIN_MISMATCH`。hashの衝突で異semantic内容が同値と見える場合も受理せずintegrity STOP。

## state transition proof v1（success-only readonly boundary）

Fn004State / AllocationEventは[bootstrapのexact schema](fn004-bootstrap.md#mutable-fn004-state-v1)をそのまま使う。current stateのschema/hashがvalidなだけではREADYにしない。非初期stateに対しこのreadonly verifierが証明するprofileを**success-only chain**と明示する。Journal/recoveryの実装やpending bypassをSlice 4へ持ち込まない。

1. bootstrap record全schema/hash、repository ID、initialized_at、baseline、genesis high-waterを検証し、そこからgeneration=0/events=[]/pending=null/history genesisの初stateを再構成しhashを計算する。
2. sequence順に各record.beforeを検証する。最初は上の初state、以後は直前recordから計算したterminal stateと**JCS全内容一致**。ここでのbefore/consumed検証は既存のstate schema/hashとbootstrap lineage fieldの検査であり、genesis-onlyなvalidateBootstrapLinkをそのまま非初期stateへ適用しない。過去beforeの上限を未来のcurrent/Git maximaと比較せず、それらのlower bound検査は最終current stateにだけ行う。Plan.id_state_preconditionのhash/generation/high-waterはbeforeと一致し、pending=null。Plan.repository/bootstrap、record.payload.repository/bootstrap、入力bootstrapがすべて一致し、record.rules.planと保存Plan.payload.rulesも一致。
3. allocation_rangesはそのPlanのplanned mappingsをnamespace別にまとめた`{transaction_id,namespace,first,last}`のarray（namespace ASCII順）。各namespace一range、first=before.high_water[N]+1、last=当該mapping最大numeric値、予定IDは連続かつ全rangeと一対一。範囲なしなら[]。P/VなどPlanが採番しないnamespaceにrangeを作らない。
4. consumedはbeforeを基に、generationを**+1**、pending_transactionを当該tx、high_waterを各range.lastへ増加、allocation_eventsへrangesをこの順でappendしたもの。history/head/baseline/time/lineageは不変。state_hashを自己field除外で再計算し全内容一致。IDなしno_opでもgeneration+1と本人pendingを確立する。
5. 成功terminal stateをメモリだけで計算する。consumedからgenerationを**+1**、pending=null、history.count=sequence、head=このrecord_hash、last=apply_id。他field不変、state_hash再計算。recordにはこのfinal hashを保存しない。
6. 最終terminalとcurrent stateの全内容一致が必要。Historyなしなら初stateと一致。current high-waterはgenesis、全event、current canonical maxima、完全origin/main historical maximaのどれよりも小さくしてはならない。全eventはnamespaceごと連続range・単調増加・重複消費なし。最新stateまでのgeneration減少/省略/上限だけ変更も受理しない。

これは既存「durable state遷移ごとにgeneration増加」の具体化であり、成功transactionのstate更新点を消費/pending確立と成功head確定の2回に固定する。PREPARING/PREPARED等のjournal保存やreceipt/cache保存ではfn004-stateを更新しない。recovery再送は同stateの確認だけでgenerationを再加算しない。high-water消費済み状態はrollbackで戻さない。

**rollback/ABORTED・別のterminal state遷移が介在した場合**はHistoryだけで全遷移を証明できない。unmatched event、record.beforeのgeneration gap、成功chainから導けないcurrent stateは`STATE_TRANSITION_PROOF_REQUIRED`、readiness=recovery_required、Plan生成/checkをblockする。失敗を成功Historyへ偽装してchainを埋めない。これは既知のterminal transactionを未完了と断定するcodeではなく、成功Historyのみのproof profileでは不足という境界である。

その場合の通常利用再開は後続Transaction/Recoveryのterminal journal/receipt/owner検証の責務。公開boolやcaller提供の「完了済み」flagをproofとして受け取らない。後続validator実装までこの状態をREADYにしない。既存Design 3の「terminal整合を検証したrollback後は通常利用可」と矛盾せず、必要な追加検証を省略しない。成功Historyを持つだけで全rollback・journalの正当性まで証明したと主張しない。

現在canonicalのmanifestが最後のafter_manifestと異なることだけでは過去の成功を抹消しない。以後の別途許可されたcanonical編集もあり得るため、通常Planは現在のvalid snapshot/raw manifestとstate high-water条件へ独立にbindingする。ただし**未完了journalが要求するtargetとの不一致**は通常readiness guardでblockし、Historyがあることをbypassに使わない。非協調writer/Git台帳巻戻しまでhashだけで防ぐ保証はない。

## readonly validator contract

readonly domain APIの入力contractは`verifySuccessfulHistory({bootstrap,state,history_directory,snapshot,git_audit})`。bootstrap/stateは上記完全型、snapshotはSlice 1のvalidated CanonicalSnapshot、git_auditはSlice 3の`{git:GitAuditIdentity,maxima:NamespaceMap}`。GitAuditIdentityのorigin/main・全parent・complete/shallow等はbootstrap契約のexact schemaを検証し、serviceが実際に完全監査した結果だけを渡す。history_directoryは`{present:boolean,entries:[{name:Nonempty,kind:"file"|"directory"|"symlink"|"other",document:HistoryRecord|null}]}`、name ASCII順。present=falseならentries=[]、kind=fileだけdocument非null（読込/parse失敗はtyped error）、他はnull。安全なknown pathのlisting＋同bytesからparseしたreadonly snapshotをrepositoryが用意する。全入力はcommon gate下で一貫取得する。成功History schema/hash/chainとstate proofの責務を一つの曖昧なgeneric JSON validatorへ委ねない。

戻り値の完全schema：

```text
{
  schema_version: 1,
  valid: boolean,
  readiness: "ready" | "recovery_required",
  count: nonnegative integer | null,
  head_hash: Hash | null,
  last_apply_id: ApplyID | null,
  semantic_hash: Hash | null,
  successful_records: HistoryRecord[],
  indexes: Indexes | null,
  state_proof: {profile:"success-only-v1", verified:boolean, terminal_state_hash:Hash|null},
  diagnostics: [{code:HistoryCode, sequence:positive integer|null, apply_id:ApplyID|null}]
}
```

順序はsuccessful_records=chain順、diagnostics=(code ASCII, sequence数値null後, apply_id ASCII null後)、重複なし。HistoryCodeは`HISTORY_CORRUPT, HISTORY_CHAIN_MISMATCH, HISTORY_IDENTITY_CONFLICT, STATE_CORRUPT, STATE_BOOTSTRAP_MISMATCH, STATE_HIGH_WATER_INVALID, STATE_TRANSITION_PROOF_REQUIRED, RECOVERY_REQUIRED`。read/parse/path安全性・Git完全性・canonical validation失敗は既存typed RepositoryErrorを伝播する。

validは全History schema/hash/chain/setがvalidであること。state側のschema/hash/high-water/pending/proof失敗は別診断とstate_proof.verified=falseで表し、検証できたHistory自体を成功stateの根拠へ自動昇格しない。これがfalseならcount/head/semantic_hash=null、records=[]、indexes=null、state_proof.verified=false/hash=null、readiness=recovery_required。valid=trueでもpending/非success state遷移未証明ならverified=false、terminal_state_hashは成功chain全体から導出できた場合のhash、途中のproof gapで導出不能ならnull、readiness=recovery_required。READYとして使うにはvalid=true AND state_proof.verified=true AND readiness=readyに加え、外側runtime guardのrequest/journal/lock/cleanup検査成功が必要。

pending_transaction!=nullなら`RECOVERY_REQUIRED`、Plan生成/check不可。通常readerもblockする。current state hashを期待する本人のCOMMITTING stateとして扱えるのはTransaction内部の所有lease＋元intent検証のみで、このreadonly APIにskip/bypass flagを作らない。

### initial empty History

bootstrap/stateの完全genesisが証明され、count=0/head=bootstrap_hash/last=null、gen0/events=[]/pending=nullの場合だけ、空directoryまたはcloneでdirectory自体が不在でもvalidated empty chainを返す。空setのsemantic_hashとempty Indexesを明示する。非初期state、未知file、片側marker/state、既知record欠損、count>0ではdirectory不在を空と解釈しない。validatorはdirectory作成/修復/削除をしない。

## lookup・indexes・Plan precondition

Indexesの全fieldは以下。すべてarrayで、filesystem順やobject挿入順の意味を持たせない。

| field | 要素の完全schema / 順序 |
| --- | --- |
| by_decision_revision | `{decision_id,revision,content_hash,plan_id,plan_hash,apply_id,sequence}`。decision_id ASCII→revision数値 |
| by_candidate | `{candidate_id,decision_id,revision,content_hash,apply_id,sequence}`。candidate_id ASCII |
| by_request | `{request_id,request_payload_hash,apply_id,sequence}`。request_id ASCII |
| by_plan | `{plan_id,plan_hash,apply_id,sequence}`。plan_id ASCII |

validated successful setではDecisionIDごと成功は1回、candidate coverageごと成功も1回、request_id/plan_idも一意。重複ならHistory自体`HISTORY_IDENTITY_CONFLICT`、どちらか一方を選ばない。by_candidateからcandidate→Decision→Plan→Approval/Request→History→canonical IDs、id_mappings/resultsから逆向きに追跡できる。Decision/Planの外部derived fileが失われてもrecord内snapshotを用いる。

Plan生成/checkでのlookup順を固定する（先にHistory/readiness検証が必要）。

1. 同decision_id+revisionがあってcontent_hash違い：`INTEGRITY_CONFLICT`。metadata/hash再生成で回避しない。
2. 同decision_id+revision+content_hashあり：`ALREADY_APPLIED`＋apply_id。同plan_hashなら同具体計画、異plan_hashでも同判断は再Apply不可。Plan同一性は結果説明/traceに使い、再実行許可に使わない。
3. 同decision_idの別revision成功あり：`APPLIED_DECISION_REVISION_UNSUPPORTED`。
4. replaces先の成功、または同candidate coverageの別Decision成功あり：`APPLIED_CANDIDATE_COVERAGE_UNSUPPORTED`。新ID/置換による二重適用を拒否。
5. 未適用だけが新Plan生成対象。

History preconditionはこのvalidatorのcount/head/last/semantic_hashとbootstrap identityをbindingする。prefix set hashを各recordのPlanにも検証する。Approval/receipt/journal raw bytesの追加をこのset hashへ混ぜない。新History追加なら既存Planはstale。History record publication、terminal journal proofの実装、state mutationは後続sliceのままである。

## Slice 4 implementation readiness / cross-review

| STOP項目 | validatorが参照する完全contract | 決定済みの境界 |
| --- | --- | --- |
| A: store/revision/status | Decisionのstore/revision表、transition表、OCC command、evidence/new/ref/relation表 | 全field/型/null/closedness、immutable保存、confirm/cancel sourceとreplaces、content projectionを確定 |
| A: source | candidate-source-v1の14 facts＋credits projection | source schemaとprojectionをversion化、無関係metadataを除外、意味変更を再確認 |
| B: registry | active effective confirmed setの全体projection | 無関係draftは非stale、active claim変更はstale、永久失効は全store検証で証明 |
| B: Plan | artifact/payload/PlanRules/5 operation variants/Subject/Key/Row/Template/diagnostic | op IDはDecision+table+subject、全sort comparator・ID registry・applicability・hash/IDが確定 |
| C: History | 本書record/payload/result、chain/set/index schema | sequence連鎖、自己hash除外、Plan prefix binding、初期emptyの証明を確定 |
| C: state | before→consumed→terminalの2遷移とsuccess-only proof | 非初期success chainを再構成、不明/rollback/pendingはreadonlyで明示block。recovery proofを偽造しない |
| 将来機能 | Approval/Requestは最小identity/hash参照、publicationはDesign 3 | Slice 4に受付/実Apply/state mutation/CLIを要求しない |

実装時の最低検証vectorは、metadataだけ変更→Decision/Plan/History semantic hash不変、判断/actor/evidence/fingerprint/operation/manifest/state/History prefix/rules変更→対応hashまたはstale、draft追加→registry不変、active取消し→registry変更、replacement取消し→元claim復活なし、同sequence fork/record欠落→blocking、noninitial hashだけvalid→proofなしではblockingとする。これらのruntime/test実装は本docs-only PRに含めない。
