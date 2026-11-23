# FN-004 内部処理設計｜Apply 実行

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](FN-004-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-41。固定された Plan の追加行を canonical に反映し、消費IDと成功を証拠化する。CLI apply は preflight → TTY承認 → Approval → Request → 同一 lease の executeAcceptedRequest。初回 durable 受付、確定元 snapshot、元 lease が前提。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元・制約 |
| --- | --- | --- | --- |
| plan_id / expected_plan_hash | ID / hex64 | CLI 必須 | 実行者が確認した計画 |
| artifact.receipt | object | 必須 | 受付済み repository/Decision/Plan/Approval/Request/tx/apply identity、actor、要求 hash、requested_at |
| artifact.receipt_hash | hex64 | 必須 | receipt 包絡の hash |
| root / gate | 文字列 / live token | 必須 | 受付と同じ checkout・lease |
| original / before_state | snapshot / state | 必須 | 受付時に照合した rawBytes・manifest・tables と state |
| evaluateTerminal / apply_time | callback / timestamp | 内部 | 前者は終端応答評価。後者は prepare 前に時計で固定 |

## 3. 参照データ定義

| データ | 参照元 | 項目・照合キー | 用途 |
| --- | --- | --- | --- |
| 受付原本と判断 | apply-requests / apply-approvals / apply-plans / decisions.json | Receipt hash と Decision ID/revision/hash、Approval/Plan ID/hash、actor | exact binding、適用前提の再検査 |
| canonical | data/*.csv | ファイル別 byte length/hash、主キー列、列一覧は21 | 元データを確保し target と比較 |
| state / Bootstrap / History | staging の追跡原本 | state hash、high_water_marks、generation、pending、head/count | 更新前提・消費・成功確定 |
| transaction | transactions/<tx_id>/ | owner/intent、journal prefix、元・対象 bytes、changed_paths | 作業の根拠と中断判定 |

## 4. 処理詳細

1. 初回 Receipt を元 state/manifest、Gate の inode/bytes、binding に結び付け、owner を公開。既存 owner から通常処理を再開すると `RECOVERY_REQUIRED`。Decision は完全 identity で選択し、Plan/Approval/Request 原本、現行 Candidate、失効と全来歴を所有 context で再検証。変化は `STALE_PLAN` 等。
2. apply_time を固定。Plan の operations を元 snapshot に適用する仮想 target を再構築。insert は主キーが未登録で書込可能表に限る。row template の時刻 binding を apply_time に置換して追加。reuse/no_op はキーで選んだ既存行と保存行が完全一致することを確認して保持。conflict 等は実行不可。追加行は型付き主キー順に既存行の後へ。更新対象表のみスキーマ列順、UTF-8、LF、CSV引用規則で変換し、再パースで元の列値・行と一致することを確認。全14表の検証と target manifest を確定。
3. 予定ID一覧から namespace 別連続範囲を作る。first=元 high-water+1、last=その namespace の最終 ID。元 state を複製し generation+1、pending=tx_id、範囲を allocation_events に追加、該当 high-water=last、state hash 再計算。新規IDゼロでも pending と generation は変わる。prepare はこの時点では state を書かない。
4. PREPARING を追記して対象 manifest と変更パスを束縛。元 CSV 全表と元 state の backup、Decision/Plan/Approval/Request の作業原本の順に永続化し、backup 完了を記録。変更 CSV の temp とその参照を順に確定し、Intent を公開して hash を journal に束縛した後、PREPARED を追記。Intent は元／消費予定 state と消費範囲を含む。各 journal は sequence+1、前 entry hash（初回 owner.hash）と binding を持つ。キャッシュだけで進行を断定しない。
5. COMMITTING を追記し、`staging/fn004-state.json` を消費済み state に原子的置換。同期後に id_consumed を記録。各更新前後に、自分が予定した path/bytes の変化だけか検査する。未予定の変化や古い前提は停止。
6. 変更パスのみ works → creators → artists → releases → songs → song_artists → song_creators → song_performers → release_tracks の順。元 byte と temp の期待値を確認して置換し、同期と置換進捗を記録。対象外表・insert がない表は元 byte を保持。全表が対象 manifest と一致し意味検証も正常であることを確認。
7. 成功確定は対象 bytes と消費 state の同期を再確認し、履歴候補を含む `COMMIT_DECIDED` を durable に公開。この境界以後は rollback 不可。成功 History の公開 → HISTORY_COMMITTED → state の generation+1、history head/count 更新・pending=null → COMPLETED。終端証明と completion を固定し、所有している残存物を片付けて解放する。 [成功確定](../../../src/fn004-success-finalization.js)・[終端実行](../../../src/fn004-recovery-executor.js)
8. 実行失敗時に正常処理は新 ID を割り当てない。既知エラーで現在の所有証拠が明確なら同一元 lease で許可された終端経路を通る。証拠不足なら Gate 等を保持して明示 Recovery。再送は照会であり実行再開ではない。正常終了と後処理未完了は Request readiness と canonical effect で見分ける。

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・算出元 | 順序 |
| --- | --- | --- | --- |
| Receipt | 変更なし | 受付原本 | 実行の前提 |
| tx journal、owner/intent、backup/temp | 追加、完了後の所定 cleanup | binding・元／対象 bytes・progress | 1、4、5〜7 |
| state | 原子的更新 | 高水位・消費イベント・pending・generation。その後に成功 head・pending 解消 | 先に消費を同期、その後 CSV、最後に成功 state |
| canonical | ファイル置換（論理的には新規行追加） | insert 行、既存行保持 | 6 |
| History / proof / completion | 追加 | 成功 record、終端 state、Receipt binding | COMMIT_DECIDED 後。失敗経路は成功 History を作らない |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| 内部実行 | 初回 acceptance の executor | 元 lease 内で終端評価 callback。公開結果を決めるのは submit と management |
| Request DTO | {artifact,readiness,diagnostics,result} | 成功参照は検証済み History |
| CLI | outcome / canonical_effect / readiness / data | 成功・未完了・復元を区別。終了コード7は効果を証明した成功確定待ち |
| 保存成果物 | CSV、state、History、終端証跡 | 成功経路。部分実行は証跡を残す |
| 例外 | typed code | 不正・I/O・復旧待ち |

## 7. エラー仕様

| コード | 条件 | 結果・対応 |
| --- | --- | --- |
| STALE_PLAN / APPROVAL_INVALIDATED | 前提更新、承認条件不成立 | 受付前停止または受付済み要求の終端化 |
| INTEGRITY_CONFLICT | 想定外 bytes、phase・binding 不一致 | 上書きを止めて元証拠を照合 |
| PERSISTENCE_WRITE_FAILED / GATE_RELEASE_FAILED | 同期・置換・解放失敗 | マーカーだけで効果を推測せず元要求を照会 |
| RECOVERY_REQUIRED | 未解決 transaction、所有証拠不足 | 元 ID から42の手順 |

## 8. 処理例

C の上限が86で C00087/C00088 の作家と各1作曲行を追加する場合、先に state の C=88 と tx pending が永続化される。creators.csv → song_creators.csv の順で置換し、既存収録の no_op は変更対象外。両方一致して成功固定・履歴登録する。一方、作家表だけ置換された時点で中断した場合は known-mixed の復旧判定を行い、rollback しても消費済みの上限を86に戻さない。

## 9. 実装・テスト対応

| 段階 | 実装 | 回帰 |
| --- | --- | --- |
| 1–2 | executeAcceptedRequest、materializeCanonicalTarget | normal-apply-guards、prepare-target |
| 3–4 | deriveConsumedState、createTransactionPreparer | durable-prepare、prepare-crash |
| 5–6 | commitPrepared、replaceCanonicalBytes | normal-apply-crash、normal-apply-io |
| 7–8 | finalizeSuccessfulTransaction、createRecoveryExecutor | terminal-crash、normal-apply-lifecycle |

[実行](../../../src/fn004-normal-apply.js)・[prepare](../../../src/fn004-durable-prepare.js)・[実行回帰](../../../test/fn004-normal-apply-io.test.js)・[クラッシュ回帰](../../../test/fn004-normal-apply-terminal-crash.test.js)・[詳細契約](FN-004-反映処理・復旧.md)
