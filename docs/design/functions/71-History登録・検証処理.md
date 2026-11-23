# FN-004 内部処理設計｜History 登録・終端証明・読取検証

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](FN-004-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-71。実際に追加・再利用した行と ID 消費を成功履歴として固定し、clone や後続処理で現在 state と適用済み範囲を検証する。実行・復旧内部で登録。history show、readApplyHistory、lookupAppliedDecision で利用し、Plan と受付時の重複排除にも使う。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元・制約 |
| --- | --- | --- | --- |
| owner / intent / original | artifact / artifact / snapshot | 作成時必須 | exact binding、元／対象 manifest、元／消費 state、apply_time、元 bytes |
| inputs.decision/plan/approval/request | object | 作成時必須 | 元原本、受付後に固定された組 |
| bootstrap / records / proofs | artifact / 配列 / 配列 | 必須 | 同 repository の genesis、既存成功と終端証拠 |
| applied_at | timestamp | 作成時必須 | 成功方針確定時、apply_time 以降 |
| root / gate / apply_id | path / token / apply_UUID | 読取 | root に既定あり。CLI は apply_id 必須 |
| decision / candidate_ids / replaces | identity / 配列 / 配列 | 照合 | 後続の Plan 等。後2つは省略可 |

## 3. 参照データ定義

| データ | ファイル | 項目・キー | 用途 |
| --- | --- | --- | --- |
| 成功履歴 | staging/apply-history/<apply_id>.json | sequence、previous_history_hash、record_hash、repository、apply/tx ID | chain と重複検証 |
| Bootstrap/state | staging/fn004-bootstrap.json、fn004-state.json | bootstrap hash、state hash、high-water、generation、pending、history head/count | state を再現・照合 |
| 関係・マスター行 | Decision/Plan snapshot、owner/intent/backup | operation ID/key、row template、planned ID、収録キー | 成功行と実 ID を構成 |
| 終端証明 | staging/transaction-proofs/<tx_id>.json | phase、binding、前/後 state、journal 証明、manifest | 失敗時の消費と成功の完全終端 |
| canonical と Git | data/*.csv、origin/main audit | master ID の現在最大、履歴上の最大 | 高水位の下限 |
| ローカル証拠 | Receipt、completion、Gate 等 | 元要求と終端整合 | runtime readiness。成功 record は Receipt 非依存で検証可能 |

## 4. 処理詳細

1. archived inputs と intent を検証し、過去の成功・終端証拠を適用した結果が before state に一致し、Plan の history precondition が実 prefix の count/head/last/semantic hash と一致することを確認。元 snapshot から target を再構築して intent の manifest と比較。食い違いは `INTEGRITY_CONFLICT` 等。
2. 新 record の sequence=before.history.count+1、previous_history_hash=before.history.head_hash。repository/Bootstrap と Decision、Plan、Approval、Request、actor、apply/tx ID を確定。candidate_coverage は Candidate の identity/fingerprint と解決した作品ID・音源ID・収録キー。id_mappings は予定 ID を canonical_id とする。results は操作分類、表と主キー、実行時刻を組み込んだ実行行（reuse/no_op は保存既存行）と row_hash。before/after manifest、state_transition の before/consumed/ranges、両時刻と rules を payload に入れる。
3. `record_hash=SHA-256(JCS(payload))`。外側に Decision/Plan snapshot と metadata.published_at。構成後に schema と追加後の chain・一意性を検証する。候補 record を束縛した COMMIT_DECIDED が durable となった後だけ、成功側が History を no-clobber 公開する。後続に HISTORY_COMMITTED、成功 state、COMPLETED。
4. 終端 proof は成功／失敗とも exact binding と前後 state、終端 phase、元証拠・journal、最終 manifest に基づき生成。proof の envelope hash は schema_version・kind・payload の JCS/SHA-256。終端 journal を同期してから proof → completion を確認し、その後で cleanup。ABORTED は元 state、ROLLED_BACK は消費を保持して pending を解消した state、COMPLETED は成功 head/count を反映。失敗を成功履歴の連鎖に追加しない。
5. 読取時は filename と record identity、schema/hash、埋込み Plan/Decision の対応、行・参照・割当を検証。sequence を1から連続させ、最初の前 hash=bootstrap hash、それ以降=直前 record hash。repository/Bootstrap identity の一致と、apply/tx/Decision/Request/Plan/Candidate の重複を禁止。semantic hash は version/repository/bootstrap と sequence・apply_id・record_hash の順序付き集合を JCS hash 化。各古い Plan の履歴 prefix を照合。
6. genesis から state 遷移を再現。成功 record の before と Plan の id_state_precondition がその時点の state に一致し、ID は namespace ごとに before high-water+1 から連続。範囲に従う consumed state（generation+1、pending=tx）を再計算。成功でさらに generation+1、history={count:sequence,head_hash:record_hash,last_apply_id:apply_id}、pending=null。失敗消費を含む場合は composite proof を使用。再現 state と現在 state の完全一致および genesis・現在CSV・Git使用上限以上を確認する。
7. CLI history show は READY / initialized と成功履歴の証明を要求し、composite proof も扱う。standalone の readApplyHistory と lookupAppliedDecision は success-only proof を要求。履歴索引は Decision ID/revision/hash、他版、置換対象、Candidate 範囲を比較し、適用済み・矛盾・対象外の再適用を判定する。

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・算出元 | 更新順序 |
| --- | --- | --- | --- |
| apply-history/<apply_id>.json | 成功時のみ追加 | payload、record_hash、組み込み snapshot、metadata | COMMIT_DECIDED 後、state の成功 head 更新前 |
| fn004-state.json | terminal state 更新 | generation、pending、head/count/last | [Apply](41-Apply実行処理.md)／[Recovery](42-Recovery処理.md) が実行 |
| transaction-proofs/<tx_id>.json | 追加 | exact 終端証跡 | 終端 state/journal の後、completion の前 |
| 採番・CSV | 参照のみ | 元・対象、検証済み範囲 | History の構成・読取では変更なし |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| 保存 record | History envelope v1 | 元取引の成功確定時 |
| 保存 proof / completion | immutable artifacts | 終端確定時。completion は binding、phase、proof_hash、terminal_journal、ended_at、diagnostics、result を持つ。成功時のみ result に apply_id/record_hash |
| readApplyHistory | 検証結果、records、diagnostics、state_proof、索引等 | 通常利用と success-only proof を通過 |
| lookupAppliedDecision | {code,apply_id} | 照合結果。未適用なら両方 null |
| CLI history show | record を含む表示 envelope | 指定 apply ID が検証済み |
| エラー | typed code | 不正な履歴・遷移・利用条件 |

## 7. エラー仕様

| コード | 条件 | 結果・対応 |
| --- | --- | --- |
| HISTORY_CORRUPT | schema・hash・filename 不整合 | 読取停止、原本照合 |
| HISTORY_CHAIN_MISMATCH / HISTORY_IDENTITY_CONFLICT | prefix、連鎖、ID の重複 | 書込・通常使用停止 |
| STATE_TRANSITION_PROOF_REQUIRED / STATE_HIGH_WATER_INVALID | 現 state を再現できない、使用済み ID 未満 | 元 state、消費範囲、終端証拠を調査 |
| ALREADY_APPLIED / APPLIED_DECISION_REVISION_UNSUPPORTED / APPLIED_CANDIDATE_COVERAGE_UNSUPPORTED | 同決定、別版、範囲が既に成功 | 履歴を参照、二重実行を防止 |
| PERSISTENCE_NOT_FOUND | 指定 apply ID 不在 | ID と証拠を確認 |

## 8. 処理例

成功件数0、generation=0で作家IDを2個消費した初回成功は、sequence=1、previous=bootstrap_hash、consumed generation=1、終端 generation=2。最終 head は record_hash、count=1。続く取引が消費後に rollback した場合、成功件数は1のまま、消費と generation の進行は終端証明で示す。成功履歴だけを使う reader ではその進行を証明できない。

## 9. 実装・テスト対応

| 段階 | 実装 | 回帰 |
| --- | --- | --- |
| 1–3 | constructHistoryRecord、publishSuccessfulHistory | history-record、terminal reader/publisher、成功公開境界 |
| 4、6 | terminalProof、proveTerminalHistory、proveHistoryState | history-proof、失敗復旧・終端中断 |
| 5、7 | validateHistoryRecord/Chain、buildHistoryIndexes、readApplyHistory、management.history | history-readonly、CLI e2e |

[構成](../../../src/fn004-history-construction.js)・[chain](../../../src/fn004-history-projections.js)・[読取検証](../../../src/fn004-history-verify.js)・[composite](../../../src/fn004-terminal-history.js)・[読取回帰](../../../test/fn004-history-readonly.test.js)・[state 証明回帰](../../../test/fn004-history-proof.test.js)・[詳細仕様](FN-004-成功履歴・読取検証.md)
