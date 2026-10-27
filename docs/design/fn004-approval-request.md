# FN-004 Approval / Apply Request Hash Contract

Slice 5の実装前contract follow-up。Approval、Request semantic payload、durable Receiptの完全なv1 schema/hash契約を定義する。[interface / lifecycle](song-admin.md)、[Plan](fn004-apply-plan.md)、[Transaction](fn004-transaction.md)、[History](fn004-history.md)と併せて読む。本変更はdocs-onlyで、受付・実Apply・artifact生成を実装しない。

## 共通型・closedness・version

[Decision共通型](fn004-decision.md)のUUID、Hash、RepositoryID、DecisionIdentity、Actor、Timestamp、Nonemptyをそのまま使う。UUIDは小文字v4、Hashは小文字64 hex、revisionは正のsafe integer、PlanIDは`ap_<full plan_hash>`、ApprovalIDは`apr_<UUID>`、RequestIDはprefixなしUUID、TransactionIDは`tx_<UUID>`、ApplyIDは`apply_<同transaction UUID>`。IDはpath要素としてgrammar検証してから使い、任意pathを受け取らない。

以下のfield表とprojectionは省略例ではない。**列挙fieldはすべてrequired、全objectはnested objectもclosed**。`T|null`以外はnull不可、absent/undefinedは不可。stringは型で許した値のみで、Nonemptyは空文字・空白だけを拒否する。これらのschemaにはarray fieldがないため、空arrayも代替値にならない。未知field/version、duplicate JSON member、不正UTF-8/BOM、非有限数、孤立surrogateを拒否する。unknown fieldを削ってからhashを合わせる実装は禁止。

hash関数`H(x)`は既存`hashCanonicalJson(x)`、すなわちSHA-256(UTF-8(RFC 8785 JCS(x)))。pretty print、object key順、JSON escape表現の違いは同値だが、文字列値へtrim、Unicode NFC/NFKC、case fold、URL正規化、改行統一を暗黙適用しない。Timestampはtimezone付き実在日時を検証し、hashには保存した文字列をそのまま使う。同じ瞬間でも`Z`と`+09:00`等の表現を書き換えない。actorはtrusted application contextから得る完全な`{id,assurance}`で、client申告値や表示名へ置き換えない。hashは認証や署名の代わりではない。

| projection名 | 選択するwire version | 対象・互換性 |
| --- | --- | --- |
| ApprovalHashProjectionV1 | ApprovalArtifact.schema_version = 1 | 下記Approval artifact全体 |
| RequestPayloadProjectionV1 | ApplyRequestArtifact.schema_version = 1 | 下記semantic command identity |
| ReceiptHashProjectionV1 | ApplyRequestArtifact.schema_version = 1 | 外側versionとimmutable receipt |

この表はschema versionで選択されるprojectionの名前であり、新しいwire fieldや独立したversion registryではない。`projection_version`等のfieldは追加しない。未対応schema/projectionは拒否し、推測・fallbackしない。意味/required/projectionを変える場合は対応schema versionと明示migrationが必要。既存PlanRules / bootstrap RuleVersions / History rulesには値を追加・変更せず、Plan/Decision/Historyのhashも変更しない。

## Approval artifact / approval_hash

保存先は`staging/apply-approvals/<approval_id>.json`。ApprovalArtifactの全fieldは次のとおり。

| field | 型・制約 |
| --- | --- |
| schema_version | `1` |
| approval_id | ApprovalID。random UUID v4を一度発行。hashから導出しない |
| repository_instance_id | RepositoryID。承認対象Plan.payloadと検証済みstateに一致 |
| decision_id / revision / decision_content_hash | DecisionID / 正整数 / Hash。Plan.payload.decision.identityに一致 |
| plan_id / plan_hash | PlanID / Hash。ID suffixとhash一致、保存Planを再hashして照合 |
| approved_at | Timestamp。人間の明示承認時にserver/applicationが一度固定 |
| actor | Actor。承認者のtrusted identity |
| purpose | literal string `"canonical_apply"` |
| intended_request_id | RequestID。承認前にclient/applicationが生成し、同じ人間操作のretryで保持 |

`approved_at`が正式field名であり、`created_at`や`submitted_at`という別名fieldはない。nullable/optional field、array、表示metadata追加用objectはない。`registry_hash`等も重複保存しない。registry/scope/candidate/History等のbindingはexact plan_hashを通じて保持する。

**ApprovalHashProjectionV1(A) = A**（検証済みApprovalArtifactの全fieldをそのまま使用）。`approval_hash = H(A)`。schema_version、approval_id、approved_at、actor、purpose、intended_request_idをすべて含む。artifact内にapproval_hash fieldはなく、自己参照しない。approval_hashはreceipt / invalidation / History等の参照側が保存する。hash対象外metadataはこのartifactには一切ない。外側JSONの書式だけはJCSによりhashへ影響しない。

同じ全field値ならdeterministicに同hash。approval_idまたはapproved_at等が違えば別の承認事実であり、同じPlan/actorでもhash一致を要求しない。approval_idはrandom identity、approval_hashはそのidentity/時刻を含む内容のintegrityで、両者を相互導出しない。

作成時は同gate lease内で保存Planのschema/hash、current Plan checkのAPPLICABLE、History/state readinessを確認する。STALE_PLAN、ALREADY_APPLIED、pending等なら新Approvalを保存しない。保存はimmutable no-clobber。同ID・検証済み同JCS内容なら既存artifactを返せる。同ID異内容はINTEGRITY_CONFLICT、時刻を差し替えたり上書きしない。変更する承認には新しいIDを発行する。

## Apply Request artifact / immutable receipt

保存先は`staging/apply-requests/<request_id>.json`。Requestはcommand、Receiptはそのcommandをdurable受理した事実。別のReceipt fileは作らず、次のenvelope内へ埋め込む。

| ApplyRequestArtifactの全field | 型・制約 |
| --- | --- |
| schema_version | `1`。**この外側だけに置く** |
| receipt | 下記Receipt。immutable |
| receipt_hash | Hash。下記ReceiptHashProjectionV1から再計算して検証 |
| processing | 下記ProcessingCache。hash外のadvisory cache |

| Receiptの全field | 型・制約 |
| --- | --- |
| repository_instance_id | RepositoryID。Approval/Plan/validated stateと一致 |
| request_id | RequestID。filenameとApproval.intended_request_idに一致 |
| request_payload_hash | Hash。下記RequestPayloadProjectionV1から再計算して検証 |
| decision | DecisionIdentity。Approvalの3fieldおよびPlan.payload.decision.identityと一致 |
| plan_id / plan_hash | PlanID / Hash。Approvalと保存Planの両方にexact一致 |
| approval_id / approval_hash | ApprovalID / Hash。保存ApprovalのIDおよびH(ApprovalArtifact)にexact一致 |
| actor | Actor。Requestのtrusted submitter。Approval.actorと完全一致 |
| requested_at | Timestamp。初回durable受付時にserver/applicationが一度固定 |
| transaction_id / apply_id | TransactionID / ApplyID。初回受理時に同じrandom UUID v4を一度発行 |

Receipt内にはschema_version、purpose、receipt_hash、status、resultを追加しない。全field非null、空文字不可、arrayなし。`requested_at`が正式field名であり、submitted_at / created_at / accepted_atの別名fieldはない。transaction/apply IDの生成は将来実行との対応を固定するだけで、transaction開始・ID高水位消費・canonical Applyを意味しない。

| ProcessingCacheの全field | 型・制約 |
| --- | --- |
| state | Nonempty。初回公開値は必ず`"accepted"` |
| journal_ref | `"staging/transactions/<receipt.transaction_id>/transaction.json"` またはnull |
| history_ref | `"staging/apply-history/<receipt.apply_id>.json"` またはnull |
| diagnostic_code | Nonemptyまたはnull。typed diagnosticのcache。空文字不可 |

初回公開のprocessingは`{state:"accepted",journal_ref:null,history_ref:null,diagnostic_code:null}`と完全一致。acceptedは「receiptをdurable保存した」のみで、実行開始・成功・未実行証明ではない。processingは既存設計どおりatomic replaceできるが、**非accepted値をSlice 5が生成したり、cacheだけで実行/完了を断定しない**。stateは表示cache用文字列でexecution状態のenumではなく、認識できない値も通常実行許可に使わずunknown resultとして照会/診断する。journal/History/completionの正式根拠と照合・再構築する責務、terminal completionのschemaや新しいexecution状態は後続Transaction契約が担う。本follow-upはそれらを発明しない。未知field/version/hash不整合はcache扱いでも黙認しない。

## RequestPayloadProjectionV1 / purpose

同じRequestのsemantic identityは次の**全fieldだけ**。これは組み立て後のcommandの完全closed schemaでもあり、各fieldの型・required/null規則は上表の同名fieldに従う。purposeだけは下記literalをrequiredとする。`E`を検証対象envelope、`R = E.receipt`とする。submit時は同じfieldをtrusted context・保存Plan・保存Approval・指定request_idから組み立て、既存receiptがあればこのprojectionと比較する。

```text
RequestPayloadProjectionV1(E) = {
  schema_version: E.schema_version,
  repository_instance_id: R.repository_instance_id,
  request_id: R.request_id,
  decision: R.decision,
  plan_id: R.plan_id,
  plan_hash: R.plan_hash,
  approval_id: R.approval_id,
  approval_hash: R.approval_hash,
  actor: R.actor,
  purpose: "canonical_apply"
}
request_payload_hash = H(RequestPayloadProjectionV1(E))
```

purposeは**schema v1のconstant command value**。新規受付時、保存Approval.purposeが正確に`"canonical_apply"`であることを検証し、その値をsemantic projectionへcopyする。Request独自の自由入力purposeはなく、Receiptへは重複保存しない。readonly hash検証ではschema v1から同じliteralを導出できるが、hashだけを再計算できることはApproval存在/有効性検証を省く理由にならない。入力adapterがpurposeを受け取る場合もこのliteralとのexact一致のみ許す。null、empty、空白前後、別case、Unicode互換文字は拒否し、trim/正規化しない。Planには独立purpose fieldがなく、Apply Planの具体的内容をこのcommandで要求する。ApprovalとRequestで別purposeを選べない。

request_id、repository、Decision、Plan、Approval ID/hash、actor、purpose、schema_versionはhash対象。requested_at、transaction_id、apply_id、request_payload_hash自身、receipt_hash、processing（全field）、呼出し時刻や表示/通信metadataはhash外。metadataを新しいartifact fieldとして無断追加することはできない。初回受理時刻が未確定でもsemantic projectionは構築できる。

## ReceiptHashProjectionV1

```text
ReceiptHashProjectionV1(E) = {
  schema_version: E.schema_version,
  receipt: E.receipt
}
receipt_hash = H(ReceiptHashProjectionV1(E))
```

**外側schema_versionをhashへ含む**。Receipt内へversionを移動/複製しない。R.request_payload_hash、全binding、actor、requested_at、transaction_id、apply_idもhashに含む。receipt_hash自身およびprocessingは含めない。semantic request hashと異なり、初回受理のidentity/時刻を固定したhashである。独立したhash版fieldを追加しない。

ReceiptHashProjectionV1はacceptedというprocessing.stateを含まない。durableに検証済みimmutable receiptが存在することが受付事実であり、cache stateの書換えを受付の取消し/再受付や実行証明にしない。結果は将来のHistory/journal/completionへの参照で導出し、immutable receiptへresult metadataを追加しない。

## binding・retry・errorの検証順

Approval → exact Plan、Request → exact Approval + exact Plan、Receipt → exact Request semantic identityを以下で結ぶ。

1. trusted authentication/contextと入力grammarを検証。同request IDの既存artifactを、受付用gate内で**新規受付preconditionより先に**読む。strict schemaと両request hashを検証し、filename/request_idを照合。既存artifactの破損を新規Requestで置換しない。
2. 既存があれば保存値と今回のRequestPayloadProjectionV1をJCSで比較し、双方のrequest_payload_hashも再計算する。同ID・同projectionは保存済みreceipt/receipt_hashと現在の検証済み状態/結果を返す。requested_at、transaction_id、apply_idは再生成せず、dispatch・新artifact・新承認を自動生成しない。processingだけの相違は異commandではない。cacheだけで完了を断定しない。
3. 同ID・異projectionはINTEGRITY_CONFLICT。Plan、Approval、actor、repository、Decision、purposeのいずれの変更も別payloadで、既存receiptを書き換えない。hash値だけを信用したり、別payloadへ既存hashを流用したりしない。正常retry後にPlanがstale/pending/適用済みでも再受付せず、既存receiptとそのcurrent blocked/recovery/History状態を照会する。照会成功は実行許可ではない。
4. 既存がない新規Requestは、保存Approvalの全schema/H(A)、intended_request_id、actor、purpose、repository、Decision、plan_id/hashを照合。保存Planのschema/hashとApprovalの全bindingを検証し、Planを現在inputへreadonly checkする。APPLICABLE以外、失効/既使用Approval、History適用済み、他の未完了receipt/journal、pendingを通常受理しない。存在するApprovalをhashだけから再構築しない。
5. 初回だけ時刻とtx/apply UUIDを固定し、semantic hash、receipt hashを構築。temp完成・file sync・exclusive no-clobber公開・directory syncが成功して初めてaccepted。既存同ID競合は再読込して1〜3へ戻り、同commandなら元receipt、異commandならconflict。並行double-clickでも1 durable receiptのみ。gate競合中は既存gateのBUSY系codeを伝播し、callerは同IDでretryする。lockを強制削除したりnested gateを取らない。

Approval checkはPlan checkを再利用し、Planがstaleなら旧Approvalを別Planへ付け替えない。既存の失効recordによる永久失効も維持し、データが戻っただけで復活させない。同requestの再照会は認可されたcallerだけに許可し、actorを差し替えた再submitは同payloadとして受け入れない。

| 条件 | 正式code / 扱い |
| --- | --- |
| 壊れたApproval/Receipt、参照approval_hash・request_payload_hash・receipt_hash不一致、同ID異payload/異immutable Approval | INTEGRITY_CONFLICT |
| 新規RequestのApprovalは単体validだがPlan/Decision/repository/actor/purpose/intended_request_idが要求と不一致 | APPROVAL_PLAN_MISMATCH（既存interfaceのcodeを使用） |
| 同request IDのactor/Plan/Approval等を変更して再submit | INTEGRITY_CONFLICTを優先。idempotency conflictの概念に別名codeを追加しない |
| current Plan checkがSTALE_PLAN | STALE_PLAN。新Approval/新Request不可、replan/reapprove |
| pending / 未完了receipt等で通常利用不可 | RECOVERY_REQUIRED、live gate競合は既存gateのBUSY系code |
| History同Decision/revision/hash成功 | ALREADY_APPLIED |
| History同Decision/revision異hash / 別revision成功 | INTEGRITY_CONFLICT / APPLIED_DECISION_REVISION_UNSUPPORTED |

`APPROVAL_MISMATCH` / `IDEMPOTENCY_CONFLICT`という新codeを導入せず、上表へ統一する。Plan自体の破損は既存PLAN_INTEGRITY_CONFLICT、非applicableは既存Plan checkのBLOCKED/診断、その他のtyped errorは元codeを保持しmessageで分岐しない。Receiptが消失した場合、未適用/未受付を証明せず再発行しない。[既存中断契約](song-admin.md)とTransaction/Recoveryのsafe-stopを維持する。

## 完全例とhash projection

次の例の外部Plan/Decision hashは説明用参照値で、対応Planの存在やapplicabilityを証明するものではない。Approval/Request/Receipt自身のhashは記載JSONから既存JCS/SHA utilityで再計算した値。object keyの記載順はhashへ影響しない。

### 1. Approval artifact

```json
{
  "schema_version": 1,
  "approval_id": "apr_22222222-2222-4222-8222-222222222222",
  "repository_instance_id": "repo_11111111-1111-4111-8111-111111111111",
  "decision_id": "dec_33333333-3333-4333-8333-333333333333",
  "revision": 3,
  "decision_content_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "plan_id": "ap_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "plan_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approved_at": "2026-10-16T10:00:00+09:00",
  "actor": {
    "id": "local:operator-1",
    "assurance": "local_process"
  },
  "purpose": "canonical_apply",
  "intended_request_id": "44444444-4444-4444-8444-444444444444"
}
```

### 2. ApprovalHashProjectionV1

```json
{
  "schema_version": 1,
  "approval_id": "apr_22222222-2222-4222-8222-222222222222",
  "repository_instance_id": "repo_11111111-1111-4111-8111-111111111111",
  "decision_id": "dec_33333333-3333-4333-8333-333333333333",
  "revision": 3,
  "decision_content_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "plan_id": "ap_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "plan_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approved_at": "2026-10-16T10:00:00+09:00",
  "actor": {
    "id": "local:operator-1",
    "assurance": "local_process"
  },
  "purpose": "canonical_apply",
  "intended_request_id": "44444444-4444-4444-8444-444444444444"
}
```

`approval_hash = 4e2a1737cfad8ebb06b6fbd7c90b84d60cd5c899d30d7574ae2e334f71740d7c`。このhashはApproval artifactへ追加せず、次のRequestが参照する。

### 3. Apply Request artifact

```json
{
  "schema_version": 1,
  "receipt": {
    "repository_instance_id": "repo_11111111-1111-4111-8111-111111111111",
    "request_id": "44444444-4444-4444-8444-444444444444",
    "decision": {
      "decision_id": "dec_33333333-3333-4333-8333-333333333333",
      "revision": 3,
      "content_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "plan_id": "ap_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "plan_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "approval_id": "apr_22222222-2222-4222-8222-222222222222",
    "approval_hash": "4e2a1737cfad8ebb06b6fbd7c90b84d60cd5c899d30d7574ae2e334f71740d7c",
    "actor": {
      "id": "local:operator-1",
      "assurance": "local_process"
    },
    "request_payload_hash": "bc0140034af0f210f32a72906b53fa4fe8dc365a43f07fe4b9db0d92f41145d2",
    "requested_at": "2026-10-16T10:00:01+09:00",
    "transaction_id": "tx_55555555-5555-4555-8555-555555555555",
    "apply_id": "apply_55555555-5555-4555-8555-555555555555"
  },
  "receipt_hash": "69024a028f80c30396118b31088e3dfd0f0c86d0a859a270e3e8214da19f72ec",
  "processing": {
    "state": "accepted",
    "journal_ref": null,
    "history_ref": null,
    "diagnostic_code": null
  }
}
```

### 4. RequestPayloadProjectionV1

```json
{
  "schema_version": 1,
  "repository_instance_id": "repo_11111111-1111-4111-8111-111111111111",
  "request_id": "44444444-4444-4444-8444-444444444444",
  "decision": {
    "decision_id": "dec_33333333-3333-4333-8333-333333333333",
    "revision": 3,
    "content_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "plan_id": "ap_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "plan_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approval_id": "apr_22222222-2222-4222-8222-222222222222",
  "approval_hash": "4e2a1737cfad8ebb06b6fbd7c90b84d60cd5c899d30d7574ae2e334f71740d7c",
  "actor": {
    "id": "local:operator-1",
    "assurance": "local_process"
  },
  "purpose": "canonical_apply"
}
```

`request_payload_hash = bc0140034af0f210f32a72906b53fa4fe8dc365a43f07fe4b9db0d92f41145d2`。purposeは検証済みApprovalから得るv1 literal、schema_versionはenvelopeから得る。

### 5. 埋込みReceipt

```json
{
  "repository_instance_id": "repo_11111111-1111-4111-8111-111111111111",
  "request_id": "44444444-4444-4444-8444-444444444444",
  "decision": {
    "decision_id": "dec_33333333-3333-4333-8333-333333333333",
    "revision": 3,
    "content_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "plan_id": "ap_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "plan_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approval_id": "apr_22222222-2222-4222-8222-222222222222",
  "approval_hash": "4e2a1737cfad8ebb06b6fbd7c90b84d60cd5c899d30d7574ae2e334f71740d7c",
  "actor": {
    "id": "local:operator-1",
    "assurance": "local_process"
  },
  "request_payload_hash": "bc0140034af0f210f32a72906b53fa4fe8dc365a43f07fe4b9db0d92f41145d2",
  "requested_at": "2026-10-16T10:00:01+09:00",
  "transaction_id": "tx_55555555-5555-4555-8555-555555555555",
  "apply_id": "apply_55555555-5555-4555-8555-555555555555"
}
```

これは例3のreceiptの全体であり、独立した保存artifactではない。schema_versionは外側にだけ存在する。

### 6. ReceiptHashProjectionV1

```json
{
  "schema_version": 1,
  "receipt": {
    "repository_instance_id": "repo_11111111-1111-4111-8111-111111111111",
    "request_id": "44444444-4444-4444-8444-444444444444",
    "decision": {
      "decision_id": "dec_33333333-3333-4333-8333-333333333333",
      "revision": 3,
      "content_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "plan_id": "ap_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "plan_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "approval_id": "apr_22222222-2222-4222-8222-222222222222",
    "approval_hash": "4e2a1737cfad8ebb06b6fbd7c90b84d60cd5c899d30d7574ae2e334f71740d7c",
    "actor": {
      "id": "local:operator-1",
      "assurance": "local_process"
    },
    "request_payload_hash": "bc0140034af0f210f32a72906b53fa4fe8dc365a43f07fe4b9db0d92f41145d2",
    "requested_at": "2026-10-16T10:00:01+09:00",
    "transaction_id": "tx_55555555-5555-4555-8555-555555555555",
    "apply_id": "apply_55555555-5555-4555-8555-555555555555"
  }
}
```

`receipt_hash = 69024a028f80c30396118b31088e3dfd0f0c86d0a859a270e3e8214da19f72ec`。同request retryでこのreceipt/時刻/tx/apply identityを固定し、processingは最新の照会結果と独立に扱う。

## Slice 5 readiness review

| 問い | 一意な答え |
| --- | --- |
| A. approval_hashのJSONは？ | 検証済みApprovalArtifact全体。hash自己fieldなし、schema_version/approval_id/approved_atも含む |
| B. purposeはどこから？ | v1 literal canonical_apply。保存Approvalのexact一致を検証してprojectionへcopy、Receiptに追加しない |
| C. receipt_hashのversionは？ | 外側の1を`{schema_version,receipt}`へ含む。processing/receipt_hash自身を除外 |
| D. 同ID同payloadで何を返す？ | strict検証後のsemantic projection/hashを比較し、元receipt/hashと現在の根拠に基づく状態。時刻/tx/apply再発行なし |
| E. 同ID異payloadは？ | projectionの差をINTEGRITY_CONFLICT。上書き・再dispatchなし |
| F. exact bindingの検証は？ | Approval全hashとPlan再hash、repository/Decision/Plan/actor/request一致、両request hash、current Plan/History/stateを照合 |

このfollow-upはApproval/Request/Receiptのhashと受付契約を確定する。actual Apply、journal/completion publication、Recovery実行、canonical/state writeは後続sliceの責務のまま。
