# FN-004 内部処理設計｜Approval 作成・照会・失効

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](FN-004-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-31。確認された具体的 Plan を単一 Request に対して承認する。CLI apply は表示と TTY 確認後に approveApplyPlan を呼ぶ。独立作成・照会・失効は信頼済みサービス。実装は createApprovalRequestService。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元・制約 |
| --- | --- | --- | --- |
| approval_id / plan_id / plan_hash | apr_UUID / ap_hex64 / hex64 | 作成時必須 | caller の生成 ID と画面で確認した Plan |
| intended_request_id | UUIDv4 | 作成時必須 | Request ID を先に生成 |
| context.actor | {id,assurance} | 必須 | trusted caller、CLI は local_process |
| context.gate | live token | 任意 | 同一 checkout の既存 lease |
| event_id / approval_id / approval_hash / reason | ainv_UUID / ID / hex64 / 文字列 | 失効時必須 | caller、対象原本の hash、非空理由 |
| approval_id / event_id | ID | 個別照会時必須 | get/check または失効取得の対象 |

## 3. 参照データ定義

| データ | 参照元 | 項目・キー | 用途 |
| --- | --- | --- | --- |
| Plan / Decision | apply-plans と decisions.json | plan_id/hash、Decision identity | 現在の適用可否と binding |
| Approval / 失効 | apply-approvals と invalidations | approval ID、hash、intended request ID、actor、event ID | 再送、永久失効、全件整合 |
| Receipt / その他証拠 | apply-requests・History・transaction | request ID、receipt_hash、受付済みの有無 | 失効の前後を区別 |

## 4. 処理詳細

1. trusted actor と closed command を検証。既存 approval ID があれば原本の Plan ID/hash、intended_request_id、actor を比較。同一なら原本、違えば `INTEGRITY_CONFLICT`。
2. 新規は READY / initialized が必要。Plan を ID で読み、指定 hash を比較し、`checkApplyPlan` が APPLICABLE のときだけ作成。期待 hash 不一致は `APPROVAL_PLAN_MISMATCH`、stale 等は check の status。
3. Approval に schema_version=1、approval_id、repository_instance_id、decision_id/revision/decision_content_hash、plan_id/hash、actor、approved_at、purpose=canonical_apply、intended_request_id を設定。全 artifact の JCS/SHA-256 を approval hash とし、自己 hash 列は持たない。Gate 内で排他的に公開。
4. getApproval は保存原本と静的 binding を検証。checkApproval はさらに actor が承認者と一致すること、失効集合と現在 Plan を検証する。失効集合を検証後、Plan が適用不能ならその status を返す例外に失効診断を添え得る。Plan が適用可能でも失効ありなら `APPROVAL_INVALIDATED`。
5. 失効は対象原本 hash を比較し、同 event ID・hash・理由・actor の再送なら元結果。新規は不明な実行証拠がないことを確認し、元 Receipt が無い場合は未受付を証明して accepted_request=null、有る場合は exact binding を確認して {request_id,receipt_hash} を記録する。全失効集合と参照を検証して公開。
6. 受付前失効は以後の新規受付を永久に禁止。受付後失効は元 Request の取消や巻戻しを起こさない。受付前 event と Receipt の共存、受付後 event の参照先相違は `INTEGRITY_CONFLICT`、必要な Receipt の欠落は `RECOVERY_REQUIRED`。

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・算出元 | 条件 |
| --- | --- | --- | --- |
| staging/apply-approvals/<approval_id>.json | 追加 | 手順3の独立原本 | 新規承認成功。同期・no-clobber 公開 |
| 同 invalidations/<event_id>.json | 追加 | repository、approval ID/hash、event ID、reason、actor、invalidated_at、accepted_request | 手順5を通過 |
| 既存承認・失効・Request、CSV、state | 変更なし | 承認結果や失効を元ファイルに転記しない | 全操作 |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| 作成・取得 | Approval 原本 | 作成成功、同一再送、取得 |
| check | {approval,approval_hash,status,diagnostics} | 現在利用可能。不可は typed exception |
| 失効操作 | event 原本または全件配列 | 作成・個別取得・全件取得 |
| CLI | apply の処理内 | 承認専用コマンドなし。最終表示は Request 結果 |

## 7. エラー仕様

| コード | 条件 | 対応 |
| --- | --- | --- |
| APPROVAL_PLAN_MISMATCH / STALE_PLAN | 期待 hash・actor、または計画前提の差 | 確認対象を取り直す |
| APPROVAL_INVALIDATED | 永久失効 | 新規受付停止。現在 Plan への承認を別途判断 |
| INTEGRITY_CONFLICT / RECOVERY_REQUIRED | key 再利用、event と Receipt の矛盾・欠落 | 証拠を保持し元要求を確認 |
| PERSISTENCE_NOT_FOUND | 指定 event・原本なし | ID と対象 checkout を確認 |

## 8. 処理例

Plan P を request R に承認した直後に中断すると Approval は残るが元 Receipt はない。照会は Apply を開始しない。未受付を証明して失効すれば、同承認から R の新規受付はできない。R が先に受付済みなら、その receipt_hash を失効 event に保存し、R の結果は元 Request として照会できる。

## 9. 実装・テスト対応

| 段階 | 関数 | 回帰 |
| --- | --- | --- |
| 1–3 | approveApplyPlan、approvalHash、saveApproval | 原本保存、stale・pending、actor/hash |
| 4 | getApproval、checkApproval、current | 適用性と失効診断 |
| 5–6 | invalidateApproval、scan、getApprovalInvalidation(s) | 永久失効、互換性、Receipt との矛盾 |

[実装](../../../src/fn004-approval-application.js)・[型](../../../src/fn004-approval-schema.js)・[回帰](../../../test/fn004-approval-application.test.js)・[交差承認回帰](../../../test/fn004-cross-approval.test.js)・[詳細仕様](FN-004-承認・反映リクエスト.md)
