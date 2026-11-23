# FN-004 内部処理設計｜Bootstrap 初期化・runtime 診断

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](FN-004-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-51。過去も含めた使用済みIDの境界を確定し、repository の初期状態を作る。CLI status / init --check / init。createBootstrapService、auditGitIds、inspectRuntimeState が実装。初期化はローカル TTY 確認と明示外部宣言を要する。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元・条件 |
| --- | --- | --- | --- |
| root | path | 任意 | 既定 cwd |
| external_declaration.schema_version / statement | 1 / 固定文言 | 監査・初期化で必須 | 運用者の外部 JSON。文言は契約の定数 |
| external_declaration.namespaces | map | 必須 | 全 namespace の過去利用上限、0..99999 |
| external_declaration.evidence[] | {kind,value}配列 | 必須 | url または human_note。URL は HTTPS |
| external_declaration.note | 文字列 | 任意 | 運用者 |
| expected_audit_hash / actor | hex64 / {id,assurance} | 初期化で必須 | check の hash とローカル実行者 |

## 3. 参照データ定義

| データ | 取得元 | 項目・キー | 用途 |
| --- | --- | --- | --- |
| 現行 canonical | data/*.csv | 主マスターの ID 列、全表 bytes | namespace 別現在値、manifest |
| 過去 canonical | origin/main 全到達 commit の CSV blob | 既知 ID 列（関係・外部参照も含む）、commit・object ID | 削除済みを含む使用範囲 |
| 既存 Bootstrap / state | staging/fn004-bootstrap.json、fn004-state.json | repository、hash、genesis、高水位、pending | 初期化済み判定 |
| History・終端、実行証跡 | staging の成功・終端・ローカル領域 | chain、state、Receipt、transaction/cleanup | status と利用可否 |

## 4. 処理詳細

1. status は Gate で runtime を観測。双方不在かつ残留証拠なしなら BOOTSTRAP_REQUIRED。片側不在、初期化途中の痕跡、整合破損を未初期化として上書きしない。既存状態は hash・repository・高水位・成功／終端 state 証明と活動中の証跡を確認する。
2. check では初期化が必要な場合、宣言を厳格検証し、origin/main の完全到達範囲を監査して Git identity と maxima を得る。不完全履歴・ref 不明や既知 ID 列の不足／解析失敗は `BOOTSTRAP_AUDIT_INCOMPLETE`。対象 root の現在 CSV と manifest を Gate 下で取得し、監査 identity の変化を確認する。
3. namespace ごとに ID の先頭文字を区分とし、後続数値の最大（未使用は0）を取る。`known=max(current,historical)`。宣言が known 未満なら `EXTERNAL_DECLARATION_CONTRADICTION`。通過時 `high_water=max(current,historical,declared)`。監査 payload に rule version、manifest hash、Git identity、両 maxima、宣言、結果を格納し、JCS/SHA-256 を audit_hash とする。
4. initialize は宣言・local actor を検証し、Gate 下で現在状態を判定。既に READY なら既存 identity を返す。新規は監査を再実施して期待 hash と照合し、公開直前にも Git HEAD/object format と manifest の一致を確認。不一致は `BOOTSTRAP_AUDIT_MISMATCH`。
5. repo_UUID と initialized_at を固定。Bootstrap に監査 hash・宣言投影・manifest・高水位・operator 証跡を固定。genesis state は generation=0、allocation_events=[]、history.count=0、head_hash=bootstrap_hash、last_apply_id=null、pending=null。state_hash は自身を除く state の JCS/SHA-256。
6. 初期化 intent → state → 空 History ディレクトリ確保・同期 → Bootstrap marker の順で確定。marker 公開後に再検証し、自分の intent だけを削除・同期。cleanup が失敗した場合は完了 identity と cleanup_required を返す。
7. runtime は通常操作を READY / initialized のときに許可。ready でも残存 cleanup は cleanup_required、未完了や遷移証明不足は recovery_required、破損は blocked。実取引の復旧は [FN-004-42](42-Recovery処理.md)。初期化コマンドに一般の復旧機能はない。

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・値 | 順序 |
| --- | --- | --- | --- |
| transactions/bootstrap_UUID/intent.json | 追加、成功後に所定削除 | marker と初期 state の両予定原本 | 先行証拠 |
| fn004-state.json | 排他的追加 | genesis | marker より先 |
| apply-history/ | 作成・同期 | 空 | 既存レコードがあれば停止 |
| fn004-bootstrap.json | 排他的追加 | 完成 marker | 最後に公開 |
| CSV・Git履歴 | 参照のみ | 現行／過去 IDs | check・initialize。チェックだけで業務ファイルを書かない |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| status/readiness/diagnostics | DTO | 現在状態に応じる |
| audit_payload/audit_hash/canonical_manifest | object/hash/object または null | 初期化可能な check 結果 |
| existing_identity / high_water_marks | object / map | 初期化済み・成功。repository/bootstrap/state hash 等 |
| CLI | data と診断、prompt は別出力 | status/check/init |
| エラー | diagnostics/cause または例外 | check は失敗 DTO、initialize は検証・I/Oを例外化し得る |

## 7. エラー仕様

| コード | 条件 | 対応 |
| --- | --- | --- |
| BOOTSTRAP_REQUIRED / BOOTSTRAP_INCOMPLETE | 未開始／不完全証拠 | 前者は監査、後者は原本調査 |
| EXTERNAL_DECLARATION_INVALID / EXTERNAL_DECLARATION_CONTRADICTION | 形式違反、既知最大未満 | 根拠と宣言を再確認 |
| BOOTSTRAP_AUDIT_INCOMPLETE / BOOTSTRAP_AUDIT_MISMATCH | 履歴不足／確認後に変更 | 完全履歴・最新監査を確認 |
| STATE_HIGH_WATER_INVALID / STATE_TRANSITION_PROOF_REQUIRED | 高水位不足または過去遷移未証明 | 履歴・終端証明・CSV を調査 |

## 8. 処理例

例として C の現在最大86、過去最大88、宣言90なら C の高水位は90。宣言87なら監査で矛盾となり初期ファイルは生成しない。check 後に checkout が変われば、旧 audit hash による初期化は失敗する。

## 9. 実装・テスト対応

| 段階 | 実装 | 回帰 |
| --- | --- | --- |
| 1、7 | inspectBootstrapStatus、inspectRuntimeState | READY、片側、中断証跡 |
| 2–3 | auditGitIds、currentIdMaxima、resultingHighWater | 過去使用、宣言、shallow 履歴 |
| 4–6 | initializeBootstrap、createBootstrapRecords | hash、no-clobber、marker 最終公開 |

[サービス](../../../src/fn004-bootstrap.js)・[Git監査](../../../src/fn004-git-audit.js)・[state](../../../src/fn004-state.js)・[回帰](../../../test/fn004-bootstrap.test.js)・[詳細仕様](FN-004-初期化・ID状態.md)
