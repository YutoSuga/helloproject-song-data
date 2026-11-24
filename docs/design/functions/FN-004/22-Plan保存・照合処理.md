# FN-004 内部処理設計｜Plan 保存・照合

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](00-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-22。生成済み Plan の同一性と現在の適用可否を判定し、後続の人間承認が参照する原本を固定する。CLI plan create/show/check、サービス save/get/checkApplyPlan と preflight が入口。メモリ生成は [FN-004-21](21-Plan生成処理.md)。READY / initialized が前提。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元・制約 |
| --- | --- | --- | --- |
| plan_id / plan_hash | ap_hex64 / hex64 | 必須 | 生成成果物、参照時は ID、preflight は期待 hash も指定 |
| schema_version / generated_at / payload | 1 / timestamp / object | Plan 入力で必須 | generateApplyPlan の戻り値 |
| payload.decision / candidate_preconditions | identity・scope/registry hash / 配列 | 必須 | 有効確定版と Candidate 投影 |
| canonical_precondition / id_state_precondition / history_precondition | object | 必須 | manifest、generation・high-water・state hash、成功履歴の count/head/semantic hash |
| payload.operations / planned_id_mappings / validation / applicability | 配列・object | 必須 | 行分類・依存・予定 ID・target 診断 |
| gate | live token | check の任意入力 | 既に所有している内部 caller |

## 3. 参照データ定義

| データ | ファイル | 照合キー・項目 | 用途 |
| --- | --- | --- | --- |
| 保存 Plan | staging/apply-plans/<plan_id>.json | filename、plan_id/hash、payload | 不変の承認対象 |
| Decision・Candidate | staging/decisions.json、song-candidates.json | 有効 identity、scope、registry、Candidate ID/fingerprint | 判断・元観測の変更検出 |
| canonical・state・History | data/*.csv、staging の状態・証明 | raw bytes manifest、state hash、高水位、履歴 prefix・semantic hash | 予定値と適用前提を再計算 |
| Git | origin/main 到達履歴 | audit identity と maxima | 保存直前の変化検出 |

## 4. 処理詳細

1. generate はメモリだけ。CLI createPlan は生成 Plan の Decision revision/content_hash を指定値と比較し、不一致は `STALE_PLAN`。save は入力を複写して別 Gate で開始。
2. get は厳格 JSON と closed schema を読み、filename と ID を比較。check/save は version、`plan_hash=SHA-256(JCS(payload))`、`plan_id=ap_<hash>` を確認。generated_at は payload の外。同一性違反は `PLAN_INTEGRITY_CONFLICT`。
3. 既適用 lookup を先に行う。同 Decision/revision/hash は `ALREADY_APPLIED`、同版異 hash は `INTEGRITY_CONFLICT`。別版・Candidate coverage 衝突は typed error。次に rules と有効 confirmed identity を照合し、変更なら `STALE_PLAN`。
4. 同じ生成日時を渡して現 snapshot から Plan を再計算。Candidate fingerprint エラーは check の `STALE_PLAN` 診断に変換。それ以外は payload の全項目を JCS 比較し、差があれば stale。raw CSV のみの変更や無関係な成功履歴進行も前提差になる。有効版を変えない追加 draft は通常この比較差にならない。
5. payload が一致すれば applicability に従い `APPLICABLE` または `BLOCKED`。preflight は期待 hash 一致と APPLICABLE を要求し、insert/reuse/no_op と変更対象 CSV を表示。計画の保存は両 status を許可する。
6. save は Git 監査を再取得し、最初の監査との完全一致を確認して公開。既存同 ID は全 payload 一致の場合に原本を返す。前提不成立、公開失敗、原本破損はエラーを返す。

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・値 | タイミング |
| --- | --- | --- | --- |
| apply-plans/<plan_id>.json | 追加 | envelope 全体 | Gate 所有下で検証後に temp 完成・同期・排他的公開・親同期 |
| 同 ID 原本 | 変更なし | 同 payload のとき元 generated_at を保持 | no-clobber。差は conflict |
| canonical、state、Decision、History、Approval | 参照のみ／変更なし | 計画条件・来歴 | 計画の保存や check で反映しない |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| save/get 結果 | Plan envelope | 保存原本 |
| check 結果 | {status,plan_id,applicable,diagnostics,history_match} | 現時点の評価、保存しない |
| preflight 結果 | {plan,check,display} | 適用可能。display に予定 ID・行分類・警告・変更CSV |
| CLI / 例外 | 表示 envelope / typed code | CLI は上記 DTO を data に含める |

## 7. エラー仕様

| コード | 条件 | 結果・対応 |
| --- | --- | --- |
| PLAN_INTEGRITY_CONFLICT | hash、filename、artifact、期待 hash の不一致 | 保存せず原本照合 |
| STALE_PLAN | 再計画 payload、指定版、監査の変化 | 現在の判断で再生成 |
| BLOCKED | 現 Plan が業務 conflict 等を含む | 診断用保存可、承認不可 |
| ALREADY_APPLIED / RECOVERY_REQUIRED | 既適用 / 通常利用不能 | 元履歴または要求を照会 |
| PERSISTENCE_WRITE_FAILED | temp/sync/公開エラー | 段階と保存原本を確認 |

## 8. 処理例

時刻A/Bで同じ入力から計画すると同じ ID。A を保存した後に B を保存しても A の原本が返る。関係行の同キー内容差がある場合は、変化のない BLOCKED Plan を確認資料として保存できる。Candidate の観測事実が変わった場合は、旧 Plan 保存・承認を止める。

## 9. 実装・テスト対応

| 段階 | 実装 | 回帰 |
| --- | --- | --- |
| 1–2 | createPlan、getApplyPlan、validateApplyPlan | 決定性・原本破損 |
| 3–5 | check、checkApplyPlan、preflight | later draft、canonical/Candidate 変化、履歴進行 |
| 6 | saveApplyPlan、repository savePlan | immutable、no-clobber、同期失敗 |

[サービス](../../../../src/fn004-plan-application.js)・[リポジトリ](../../../../src/fn004-repository.js)・[回帰](../../../../test/fn004-apply-plan.test.js)・[反映計画](20-反映計画.md)
