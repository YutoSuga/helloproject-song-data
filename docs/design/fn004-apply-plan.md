# FN-004 Apply Plan

本書はimmutable Plan artifact / execution payload / operation registryの**完全なv1実装契約**。runtime未実装。[Decision](fn004-decision.md)の共通型・closedness・normalization規則、[History readonly](fn004-history.md)、[Transaction](fn004-transaction.md)、[interface](song-admin.md)を参照する。Planは人間判断の自動代替ではなく、confirmed Decisionをcanonicalへの追加案に変換する。Plan生成でcanonical、Decision、History、state、高水位を変更・予約しない。

## artifact・identity・保存

rootの全fieldは`{schema_version:1, plan_id:PlanID, generated_at:Timestamp, payload:ExecutionPayload, plan_hash:Hash}`。`PlanID = ap_<64桁小文字Hash>`、`plan_hash=hashCanonicalJson(payload)`、plan_idのsuffixと一致。payload自身にplan_id/plan_hashを入れない。generated_atだけが表示metadataでhash外（PID/path/machine等を追加するfieldはない）。同じ全入力/rulesなら同payload/hash/ID。generated_atだけ違っても同identity。

`staging/apply-plans/<plan_id>.json`にno-clobberで保存する。derived/rebuildableで原則Git非管理。既存同IDのschema/hash/payloadを検証し同payloadなら既存artifact（元generated_at）を返す。異payloadは`PLAN_INTEGRITY_CONFLICT`、overwrite不可。pathはID grammarからのみ構成し、Slice 2 path safety / exclusive gate / durable persistenceを使う。承認/未完了transactionが参照するPlanの削除は禁止。

## ExecutionPayloadの完全schema

以下のfieldだけをすべて必須とする。すべてclosed、未知fieldをhashから除外するreaderは禁止。

| field | 型・制約 |
| --- | --- |
| schema_version | `1`（plan_payload） |
| repository_instance_id / bootstrap_hash | RepositoryID / Hash、検証済みstate/bootstrapと一致 |
| rules | 下記PlanRules |
| decision | `{identity:DecisionIdentity, scope_hash:Hash, registry_hash:Hash}` |
| candidate_preconditions | CandidatePrecondition[]、candidate_id ASCII順、Decision scopeと完全一致 |
| canonical_precondition | Manifest全体。全14 raw-byte entryとhashを保持 |
| id_state_precondition | `{schema_version:1,state_hash:Hash,generation:非負integer,high_water_marks:NamespaceMap,pending_transaction:null}` |
| history_precondition | 下記HistoryPrecondition |
| planned_id_mappings | PlannedIDMapping[]、下記allocation順 |
| operations | Operation[]、下記operation順。全要求の唯一の定義 |
| no_op_operations / conflicts / unsupported_operations | 各分類のoperation_id配列。operations内の出現順。重複/参照切れ/欠落禁止 |
| validation | HypotheticalValidation |
| applicability | Applicability |

stateのrepository/bootstrapはroot payload、baseline_manifest_hash/initialized_at/allocations/historyはstate_hashでbindingする。state_hashは[bootstrap正式契約](fn004-bootstrap.md)で全内容を検証する。stateの全snapshotを二重コピーする必要はない。generation/high_waterは表示と採番再検証にも使い、stateからの抜粋値と完全一致必須。

CandidatePreconditionは`{candidate_id:Nonempty, source_schema_version:1, projection_version:1, source_identity:SourceIdentity, fingerprint:Fingerprint, snapshot_hash:Hash}`。snapshot_hashはDecisionに保存した完全candidate projectionのhash（fingerprint.valueと同じ）。現在candidateからも同値を再計算する。candidate_id/source identityを別candidateへ付け替えない。

HistoryPreconditionは`{schema_version:1, bootstrap_hash:Hash, count:非負integer, head_hash:Hash, last_apply_id:ApplyID|null, semantic_hash:Hash}`。History validatorのreadyな結果と一致させる。count=0もgenesisを明示し、空文字やdirectory不存在だけで代用しない。後続成功追加でhead/count/semantic_hashが変わればstale。

PlanRulesの完全field setは次のJSON（各数値は固定1）。bootstrapのRuleVersions objectを拡張/書換えず、Plan専用registryとする。各schema/versionと対応値の一致を検証する。

```json
{
  "decision_store": 1, "decision_revision": 1, "decision_scope": 1,
  "candidate_source_schema": 1, "candidate_fingerprint": 1, "decision_registry": 1,
  "apply_plan": 1, "plan_payload": 1, "plan_operation": 1, "operation_order": 1,
  "id_allocation": 1, "planner": 1, "hypothetical_validation": 1,
  "canonical_schema": 1, "canonical_validator": 1, "canonical_manifest": 1,
  "id_namespace": 1, "state": 1, "bootstrap": 1, "git_id_audit": 1,
  "history_record": 1, "history_hash": 1, "history_chain": 1, "history_set": 1,
  "state_proof": 1, "serializer": 1,
  "canonical_json": "rfc8785", "hash_algorithm": "sha256"
}
```

## operation registry・型

operationsを唯一のrow/request定義とする。分類別arrayを別のrowコピーにしない。許可insert表の順序（TableRank）は**works, creators, artists, releases, songs, song_artists, song_creators, song_performers, release_tracks**。existing memberのreuseも記録するためmembersをこの後のrank=9（先頭rank=0）とする。unsupported対象表の残りはmember_affiliations, videos, video_songs, video_song_performersの順にrank=10〜13。

| 型 | 完全な定義 |
| --- | --- |
| Table | canonical全14表名のenum |
| Key(table) | canonical schemaのPK列だけをkeyとするclosed object。ID/enum/dateはstring、整数PKはcanonical column.minに従うsafe integer（start_secondsは0以上、disc/trackは1以上。canonical CSVの先頭0表現は数値として比較）。不足/余分なkey禁止 |
| Row(table) | canonical schemaの**全列だけ**をkeyとするclosed object、全値CSV string。列追加はcanonical_schema version更新。unknown列/欠落列不可 |
| Template(table) | Rowと同じ全列。new masterのcreated_at/updated_atだけ`{system_binding:"apply_time"}`（closed）を許す。他の全値はCSV string |
| RowHash | `hashCanonicalJson({table:Table,row:Row})`。CSV raw byte hashとは区別 |
| Subject | `{kind:"local"\|"existing"\|"relation"\|"unsupported", ref:Nonempty}`。順にmaster local_ref、canonical master ID、relation local_ref、unsupported request_ref |
| Source | `{subject:Subject, decision_paths:Nonempty[], candidate_ids:Nonempty[], evidence_refs:EvidenceRefs}`。pathsはrevision rootからのRFC 6901 JSON Pointer、ASCII昇順unique。candidate_idsはこの要求を利用する全binding ID、ASCII昇順unique |

Ref identityの比較は型とexisting_idまたはlocal_refの組で行い、assertions/evidenceはidentity一致後の別検証とする。要求graphのrootは各bindingのwork/song/release_track_refs。local songからworkを辿り、選択songと同Ref identityの全song relation、指定trackのreleaseへ辿る。existing Refでcanonical全relationの自動取込はしない。assertions.primary_artist_idsは検査値であり、これだけで別operationを要求しない。performer relationを辿るbindingはperformer_review=specifiedのものだけとし、各performer relationに少なくとも1件の指定bindingが必要。全new定義/relationはこのgraphから到達できなければconfirmed invalid。

Source.candidate_idsはこのgraphで当該要求へ到達する全binding。decision_pathsはmaster localなら定義objectと全Ref出現object、existingなら全Ref出現object、relationなら定義objectだけのPointerを列挙する。evidence_refsはこれらobject自身のevidence_refsのunion（distinct assertion等nested judgmentの根拠は元Decisionからも検証する）。Sourceのpathは保存済みDecisionのcanonical sorted array内位置へ解決し、subject/要求内容に一致する。shared existing masterは同table/IDに1 operationとし、全参照path/evidence/candidate利用者をunionする（矛盾assertionは許さない）。これは複数new local entityやrelation要求を自動統合する規則ではない。同じlocal_refは一度だけ定義、relation重複はerror。使われないnew entityはDecision confirmed検証で拒否する。

全Operationの共通fieldは`{schema_version:1, operation_id:OperationID, classification, table:Table, source:Source, dependencies:OperationID[], key:Key|null, result:Variant}`。classificationはreuse/insert/no_op/conflict/unsupported。result以外にrowを重複保存しない。dependenciesは操作に必要なmasterのinsert/reuse operation IDを重複なしASCII昇順で全列挙する（work依存、relationの全FK依存等）。existing member reuseも含む。自己参照/cycle/未解決参照はinvalid。key=nullはunsupported、または採番不可でまだPKを持てないconflictだけ。

### deterministic operation_id / ordering

`operation_id = op_<Hash>`、Hash対象は`{schema_version:1,decision_id,table,subject}`。revision/hash、classification、planned ID、配列index、時刻を含めない。同Decisionの同じsemantic要求は再生成/後続revisionでも同ID、要求を別entityへ流用してはならない。既存参照のsubjectはexisting canonical ID、new masterはlocal_ref、relationはrelation local_ref。hash collision/重複IDが別内容を表せばintegrity STOP。source pathが変わってもIDは変わらないがPlan payload/hashは変わり得る。全Ref/PK/整数がこの型で表現不能（safe integer超過）ならtyped `PLAN_INTEGER_UNREPRESENTABLE`でartifact生成前に停止し、丸めない。

operation順のexact comparatorはtuple：

1. TableRank（上記数値）。
2. table=songsならresolved IDのprefix、未採番local songならDecision.song_id_prefix（ASCII）。他表は空文字。
3. Subject.kind rank：local=0、existing=1、relation=2、unsupported=3。
4. local/existing/unsupportedはsubject.ref ASCII。relationはkeyのPK列をcanonical PK列順に比較（整数は数値、他はASCII）。key=nullは全keyより後。
5. 同値ならsubject.ref ASCII、最後operation_id ASCII。

classificationでsortしない。dependenciesは上の出現順より遅いoperationを参照できる（member等）が、実行はTransactionの固定table順とFK依存で検証する。filesystem順、input配列順、locale、title、発売日をsortに使わない。

## operation variantsの完全schema

| classification | resultの全field・制約 |
| --- | --- |
| reuse | `{existing_id:CanonicalID, assertions:当該DecisionのAssertions, existing_row:Row, row_hash:RowHash, reason_code:"EXPLICIT_EXISTING_REFERENCE"}`。masterのみ。key/row/ID一致、assertionsを現canonicalへ照合。writeなし |
| insert | `{local_ref:masterまたはrelation local_ref, planned_id:CanonicalID\|null, row_template:Template, reason_code:"NEW_ENTITY"\|"NEW_RELATION"}`。masterはmappingとplanned_id一致、relationはplanned_id=null。keyはtemplateから抽出したPKと一致 |
| no_op | `{requested_row:Row, existing_row:Row, row_hash:RowHash, reason_code:"RELATION_ALL_COLUMNS_EQUAL"}`。relationのみ。正規整数比較を除き全列一致、key一致、hashはexisting_rowをhash。writeなし |
| conflict | `{code:ConflictCode, requested:Requested, existing_rows:Row[], evidence_refs:EvidenceRefs}`。requestedは下記closed union。同PK異内容/identity等を黙ってreuseにしない |
| unsupported | `{code:UnsupportedCode, request_ref:Nonempty, description:Nonempty}`。実行rowを持たない。key=null |

Requestedは`{kind:"reference",ref:ExistingRef}`、`{kind:"row",row_template:Template}`、`{kind:"allocation",local_ref:master LocalRef,namespace:prefix}`のいずれか。既存row未発見/採番不可ならexisting_rows=[]。複数existing_rowsはKey comparator順、同PKのduplicate元入力はcanonical invalidとしてPlan生成前にSTOP。

ConflictCodeは`EXISTING_IDENTITY_CONFLICT, EXISTING_ID_MISSING, DUPLICATE_IDENTITY_UNREVIEWED, RELATION_PK_CONTENT_CONFLICT, RELATION_ORDER_CONFLICT, ID_CAPACITY_EXHAUSTED, DUPLICATE_DECISION_REQUIREMENT`のenum。UnsupportedCodeは`NEW_MEMBER, EXISTING_UPDATE, DELETE, MEMBER_AFFILIATION, VIDEO, LARGE_CORRECTION`のenum。機械codeをmessage分岐の代用にしない。

confirmed v1 Decisionはunsupported_requests=[]必須なので、正常生成経路でunsupported operationは0件。防御的planning/diagnostic APIはdraft/不正confirmed入力のunsupported要求を上記型で返せるが、**それを正式Planとして保存/承認対象にしない**。draft/不正schema・source binding失敗時はdiagnosticsだけの失敗結果。型の網羅と、invalid Decisionを正式confirmedとして受け入れることを区別する。existing assertions不一致からfield patchを生成せずconflictにする。

### reuse / row / relation比較

同じ要求に複数問題がある場合の分類優先順も固定する。existing masterはID missing→assertions conflict→reuse、new masterはcapacity exhausted→distinct未確認→insert、relationは同PK異内容→order conflict→同PK全列一致no_op→insert。該当分類のcodeをresultへ持ち、追加で検出した問題も全件error diagnosticへ記録する。未解決依存のためrowを構成できない要求はREQUIREMENT_UNPLANNED diagnostic（当該Decision path）で表し、偽のpartial rowを作らない。

new masterの全canonical列をTemplateへ展開し、IDはmapping、work等はRef解決、optional nullは空文字、integerはbase10 string。created_at/updated_atだけapply_time bindingを使い、Plan生成時刻を埋めない。existing masterはreference-only。assertionsはoriginal snapshotへ照合し、追加予定relationで変わるtargetの集合をoriginalの期待値と混同しない。new artist/release/creatorも自動reuseせず、人間のdistinct判断と候補集合を再検証する。

relation PKはcanonical schemaから導出する。song_artists=(song_id,artist_id,role)、song_creators=(song_id,creator_id,role)、song_performers=(song_id,member_id)、release_tracks=(release_id,disc_number,track_number)。orderはsong+roleのcredit_order、songのperformer_orderで非空値がunique。

canonical整数列は比較時だけbase10正規形へ変換する。他の全列（notes/source_url含む）は無変換で比較。不存在insert、全列同値no_op、同PK異内容conflict。no_op既存行の保存bytesや表現は書き換えず、requested_rowは要求の正規形、existing_rowはsnapshotの元CSV stringを保存する。row_hashは元existing_row。別PKのorder競合もconflict。track_titleとsong.titleの差は同一性の自動否定材料にしない。

## planned ID registry・allocation

PlannedIDMappingの全fieldは`{entity_type:"work"|"creator"|"artist"|"release"|"song", local_ref, namespace:prefix, planned_id:CanonicalID}`。local_refごとに一意、reverse lookupもplanned_id一意を検証する。relation local_refにはcanonical master IDを採番しない。operationのIDと重複定義せず一致検証する。

exact allocation順はentity_type rank **work=0,creator=1,artist=2,release=3,song=4**、次にnamespace ASCII、次にlocal_ref ASCII（w10はw2より前）。namespaceはW/C/G/L、songだけ人間指定M/A/J/T/B/O/R/H。各namespaceで`max(current master numeric maximum, state.high_water_marks[N])+1`から順に+1、5桁zero-pad。P/Vへ採番しない。欠番は再利用しない。prefixをcollector/artistから推測しない。

上限99999超過は該当namespaceの**全new要求**をID_CAPACITY_EXHAUSTED conflictにし、当該namespaceのmappingを一切作らない（部分採番なし）。他namespaceのmappingは診断用に計算可だがPlan全体applicable=false。FKが解決不能な従属要求もblocking diagnosticにし、偽IDを作らない。計画値は予約/確定でなく、stateを変更しない。別Planが同じ予定IDを持ち得る。実行時に番号だけ差し替えず、先行成功でstateが進めばstaleとして再生成する。

## diagnostics・hypothetical target・applicability

Diagnosticの全fieldは`{severity:"error"|"warning", code:DiagnosticCode, target:OperationID|null, decision_path:Text|null, evidence_refs:EvidenceRefs, canonical:CanonicalDiagnostic|null}`。codeは上記ConflictCode/UnsupportedCodeに加え`CANONICAL_TARGET_INVALID, REQUIREMENT_UNPLANNED, DECISION_NOT_EFFECTIVE, CANDIDATE_FINGERPRINT_MISMATCH, STALE_PLAN, UNSUPPORTED_OPERATION`。canonical非nullはcode=CANONICAL_TARGET_INVALIDだけ。

CanonicalDiagnosticの全fieldは`{code:Nonempty,file:Text|null,table:Table|null,row:正整数|null,column:Text|null,key:Text|null}`。既存whole validatorのcode/file/table/row/column/keyを転記、存在しない値はnull、keyがobjectならJCS(key)文字列、数ならbase10、stringならそのまま。messageは含めない。validator version=1のcode集合をそのまま利用し独自に意味を再定義しない。diagnostics順は`JCS(Diagnostic)`のUTF-16 code unit辞書順、完全重複は1件にする。

message/resolutionの人間向け文はcode→表示adapterの責務で、execution payloadへvolatile proseを混ぜない。serviceの表示DTOだけ`{diagnostic, message:Text, resolution:Text}`を付加できる。保存artifactには追加しない。既存説明のdiagnostic表示項目をこのDTOで満たす。

HypotheticalValidationの全fieldは`{schema_version:1, validator_version:1, performed:boolean, target_semantic_hash:Hash|null, diagnostics:Diagnostic[]}`。解決可能な全insertを含めた完全targetを作れるときだけperformed=true。未採番/FK未解決等で作れなければfalse/hash=null、blocking diagnostic必須。各conflict/unsupported operationにつき対応code/targetのerror diagnosticを必ず1件生成する。既存row変更・削除は一切認めない。再利用rowを置換して検証を通さない。

performed=trueでは元全14表のrow順を維持し、各表のinsertをtyped PK順で末尾へ追加してメモリtargetを構築し、master system timestampだけ固定検査値`2000-01-01T00:00:00Z`へ一時置換して既存whole canonical validatorを実行する。この値は実行row/CSVへ出さない。target_semantic_hash対象は`{schema_version:1,tables:[{table,rows:Template[]}]}`。table順は**canonical path ASCII順**、rowsはtyped PK comparator順、元rowは全string、新rowのtimestampはbinding objectのまま。error結果でも完全targetを構成できればこのhashを保存する。これはraw-byte target Manifestではない。実適用の日時/serialized bytes/target ManifestはTransactionが決め直し、Planと一致すべきsemantic row templateを変更しない。

Applicabilityは`{applicable:boolean, blocking_diagnostics:Diagnostic[], conflict_operation_ids:OperationID[], unsupported_operation_ids:OperationID[]}`。idsは分類indexesと完全一致、blocking_diagnosticsはvalidation.diagnosticsのseverity=errorだけを同順で含む。applicable=true iff confirmed/effective/not-applied・全precondition検証成功・全要求計画化・performed=true・blocking=[]・conflicts=[]・unsupported=[]。一つでも問題があればfalse、部分Applyなし。reuse/no_opだけでも初回判断の記録としてapplicableになれる。identity未決をwarningにせず、未来release/optional欠如だけでwarningを出さない。

## generation / readonly check・gate

同じ共通gate lease内でDecision store全検証/effective registry、candidate、canonical snapshot、bootstrap/state/History proof、existing assertions、allocation、operations、whole target検証まで行う。暗黙nested gateを取らず既存leaseを明示伝播する。長いGit auditの検証済み結果は固定HEAD/objects/rulesがpublication直前も同じ場合のみ再利用可。snapshot読込/hash/parseは同bytesを使う。

生成順はDecision/sourceの構造と同一性→History/state proofと適用済みlookup→全14 canonical→existing/duplicate→planned mapping→operations→hypothetical validation→applicability→hash→immutable保存。構造/lineage/source/履歴不正、draft/cancelled/non-effectiveは正式artifactを生成せず失敗DTOを返す。完全binding済みconfirmedに対するcanonical競合/capacity/target invalidはapplicable=falseの診断Planとして保存可。

`checkApplyPlan`はreadonlyで保存schema/hash/ID/rules/全preconditionとoperation再生成を照合する。service結果の完全schemaは`{status:"APPLICABLE"|"BLOCKED"|"STALE_PLAN"|"ALREADY_APPLIED"|"INTEGRITY_CONFLICT"|"RECOVERY_REQUIRED", plan_id:PlanID, applicable:boolean, diagnostics:Diagnostic[], history_match:ApplyID|null}`。gate/persistence/canonical/Git/History検証のtyped errorは元codeのRepositoryErrorとして伝播し、曖昧なfalseへ潰さない。candidate mismatchはdiagnosticを付けたSTALE_PLAN、Decision非有効/identity変更・canonical bytes/state/History/rules/registry変化もSTALE_PLAN。元payloadを更新しない。

先にHistory全検証・state readinessを確認し、[History lookup](fn004-history.md)を適用する。同Decision/revision/hash成功は別PlanでもALREADY_APPLIED、同identity異hashはINTEGRITY_CONFLICT、別revisionはAPPLIED_DECISION_REVISION_UNSUPPORTEDのtyped error。未適用の場合だけ現在inputから同payloadが再生成されるか照合する。別Planだから同Decisionをもう一度Applyできるとは扱わない。

approval/request/journalの追加はDecision registry、canonical Manifest、History semantic hashへ含めない。pending transaction/未完了receipt/journalは独立readiness guardで通常Plan生成/checkをblockする。History追加/state更新はstaleになる。実Applyの本人pending遷移はTransaction内部だけの期待遷移検証であり、一般Plan checkのbypass optionはない。

Approval/Requestのexact Plan bindingとhashは[Hash Contract](fn004-approval-request.md)を正とする。Approvalはplan_id/plan_hashとDecision identityを保存し、Planのregistry等はplan_hash経由でbindingする。Plan.generated_atだけの違いは承認対象を変えない。Planのschema/payload/PlanRulesへApproval/Request用fieldやversionを追加せず、receiptの追加によるreadiness blockingとPlan payloadのstaleを区別する。
