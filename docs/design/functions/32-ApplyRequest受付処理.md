# FN-004 内部処理設計｜Apply Request 受付・結果照会

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](FN-004-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-32。承認対象と実行要求を一対一で紐づけ、初回受付と再送を区別する。submit/check/getApplyRequest、CLI apply 内の受付と result が入口。createApprovalRequestService の既定は受付専用。CLI は createCanonicalApplyService が実行 executor を組み込む。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元・制約 |
| --- | --- | --- | --- |
| schema_version / repository_instance_id | 1 / repo_UUID | 受付時必須 | Approval と同一 |
| request_id | UUIDv4 | 必須 | Approval の intended_request_id。照会ではこれを指定 |
| decision | {decision_id,revision,content_hash} | 受付時必須 | 承認した確定版 |
| plan_id / plan_hash | ID / hex64 | 受付時必須 | 承認原本 |
| approval_id / approval_hash | ID / hex64 | 受付時必須 | 承認原本全体の hash |
| actor / purpose | {id,assurance} / canonical_apply | 受付時必須 | 原本の値。actor は trusted context と一致 |
| context.actor / gate | object / live token | actor 必須 | caller、gate は任意 |

## 3. 参照データ定義

| データ | ファイル | 比較項目・キー | 用途 |
| --- | --- | --- | --- |
| Receipt | staging/apply-requests/<request_id>.json | request ID、request_payload_hash、receipt_hash、actor | 再送・照会 |
| Approval / Plan / Decision | 31・22・12の保存原本 | 承認 ID/hash・Plan ID/hash・Decision 三つ組 | 正式要求の再構成 |
| state・canonical・History / 終端証跡 | staging、data/*.csv | repository、manifest、state hash、pending、request/apply/transaction ID | 受付時 snapshot と結果証明 |

## 4. 処理詳細

1. 受付は厳格 v1 payload と trusted actor を検証。request ID で既存原本を先に探す。元 Receipt から schema/purpose を補って投影した semantic payload と入力を完全比較。同一なら結果照会だけ、差は `INTEGRITY_CONFLICT`。この分岐は新規受付時の失効・stale 判定に先行する。
2. 新規では受付 namespace、Approval の原本と hash を確認。原本の repository、意図した request ID、Decision、Plan、actor、purpose から期待 payload を組み、入力と比較。差は `APPROVAL_PLAN_MISMATCH`。現在 APPLICABLE、失効なし、READY / initialized、元要求が未受付と矛盾しないことを確認。
3. canonical manifest と state hash が Plan の前提と一致する snapshot を同じ Gate で得る。差は `STALE_PLAN`。request_payload_hash=JCS/SHA-256(semantic payload)。時刻 requested_at と同じ新 UUID の tx_ / apply_ ID を一度だけ割当。
4. Receipt は payload から schema_version/purpose を除いた項目に request_payload_hash・時刻・両 ID を加える。receipt_hash は {schema_version:1,receipt} の hash。processing は初期 accepted の補助 cache。保存原本の processing 値から完了を推定せず、同一原本を保持する。受付原本を同期、排他的公開、親同期した後だけ初回 executor へ渡す。同じ live lease を継続する。
5. get は静的検証済み原本を返す。check/result/同一再送は runtime と失効を照合し、History を request/tx/apply ID で検索。複数一致、または1件でも Decision、Plan、Approval、actor、request hash 等の exact binding が違えば `INTEGRITY_CONFLICT`。一致なら result={apply_id,record_hash}。他は null。成功と recovery_required は共存し得る。通常利用可能な場合に現在 Plan を照合し、診断コードを一意化・整列。
6. CLI result は終端証拠も参照し、成功・中断・abort/rollback 等を表示。読み取り・同一再送は dispatch や cleanup を起こさない。受付後、journal 前の中断も元要求を [Recovery](42-Recovery処理.md) で扱う。

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・値 | 条件 |
| --- | --- | --- | --- |
| apply-requests/<request_id>.json | 追加 | schema_version、receipt、receipt_hash、processing | 初回受付、executor 呼出より前 |
| Receipt 原本 | 変更なし | 時刻・identity・hash を保持 | 再送、照会、通常実行 |
| completions/<request_id>.json | 追加 | 終端結果と Receipt binding | 実行・復旧の終端処理 |
| CSV・ID state | 参照のみ | 元 snapshot | 受付自体は更新しない |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| artifact | Request 原本 | submit / check の DTO。get は原本だけ |
| readiness / diagnostics | enum / {code}配列 | 現在の通常利用可否・診断 |
| result | {apply_id,record_hash} または null | 検証済み成功の参照のみ |
| CLI result | outcome・canonical_effect・readiness 等と data | result/apply の表示契約 |
| 例外 | typed code | 受付拒否または証拠矛盾、実行失敗 |

## 7. エラー仕様

| コード | 条件 | 結果・対応 |
| --- | --- | --- |
| APPROVAL_PLAN_MISMATCH / APPROVAL_INVALIDATED | binding 差・失効 | 新規受付停止 |
| INTEGRITY_CONFLICT | 同 ID 異内容、Receipt/History 矛盾 | 上書きなし。元原本を照合 |
| STALE_PLAN / RECOVERY_REQUIRED | snapshot 変更、未完了要求 | 再計画または元 ID で観測 |
| PERSISTENCE_NOT_FOUND / PERSISTENCE_WRITE_FAILED | 原本不在・I/O 失敗 | 受付時の表示と元 ID、公開段階を確認 |

## 8. 処理例

R の Receipt に tx_X/apply_X を保存した直後にプロセスが止まったとする。同 ID・同 payload の再送は同じ時刻と両 ID の原本を返し、別取引を作らない。journal が無くても処理結果を推測せず、Recovery が before state と元 CSV・所有者等を照合する。

## 9. 実装・テスト対応

| 段階 | 関数 | 回帰 |
| --- | --- | --- |
| 1–3 | submitApplyRequest、staticRequest、current、requestPayloadHash | 冪等性、失効、受付前の競合 |
| 4 | receiptHash、saveApplyRequest、createCanonicalApplyService | 受付同期、中断、初回実行 |
| 5–6 | requestResponse、check/getApplyRequest、management.result | 原本・現在状態・成功証跡の独立、CLI crash |

[受付実装](../../../src/fn004-approval-application.js)・[応答回帰](../../../test/fn004-request-response.test.js)・[CLI中断回帰](../../../test/fn004-cli-crash.test.js)・[詳細仕様](FN-004-承認・反映リクエスト.md)
