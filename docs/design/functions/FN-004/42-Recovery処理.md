# FN-004 内部処理設計｜Recovery 観測・復旧

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](00-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-42。元要求と永続証拠を照合し、中断した処理を証明可能な終端へ進める。CLI recovery inspect/run、同名の management 操作が入口。外部からの明示実行には元 Receipt と最新の観測 hash が必要。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元・制約 |
| --- | --- | --- | --- |
| request_id | UUIDv4 | inspect に必須 | 元受付時の ID |
| transaction_id | tx_UUID | run に必須 | inspect した元 transaction |
| expected_observed_state_hash | hex64 | run に必須 | 直近 inspect |
| action | abort / rollback / finalize_success / finish_terminal / cleanup | run に必須 | 観測から返った唯一の値 |
| actor / binding | actor / exact identity | 内部 | 実行者、Receipt と Bootstrap から構成 |

## 3. 参照データ定義

| データ | 参照元 | キー・項目 | 用途 |
| --- | --- | --- | --- |
| Receipt、completion | apply-requests/ | request/tx ID、receipt_hash、元承認 | 元の取引を一意に選択 |
| owner/intent/journal、元・対象 bytes | transactions/<tx_id>/ | binding、sequence、前 hash、manifest、消費予定 state、進捗 | phase、許可された物理状態 |
| canonical と state | data/*.csv、fn004-state.json | 各ファイルの長さ・SHA-256、before/consumed/after | 実際の置換・消費有無 |
| Gate・mutex・所有権記録 | staging の lock と recovery-ownership | owner PID、host、boot、namespace、開始識別子、inode、claim/retirement | 生存確認と移譲 |
| History と terminal proof | apply-history / transaction-proofs | apply/tx/binding、head、state、manifest | 成功方針と終端の証明 |

## 4. 処理詳細

1. inspect は ID で一意の元 Receipt を取得し、Bootstrap の repository ID と照合。状態と証拠を二重観測し、binding・ファイル hash・journal 連鎖・所有者の OS 証明を検証。元 owner が生存なら active、別環境・不明・観測が不安定なら実行候補を出さない。
2. 元／対象 manifest で実ファイルを分類し、各 bytes が想定範囲にあることと、phase・進捗がその組合せを許すことを確認。state 全体を before/consumed/終端候補と比較。journal の進捗が遅れた場合は bytes と state の証明を要求。消費済み表記なのに state=before、未知 bytes、hash不整合は停止。
3. 許可 action は下表で最優先の一つだけ。Receipt のみの経路は元 Plan・canonical・state・History、残存 evidence、元所有者の終了から未開始を証明する。通常経路をもう一度 dispatch しない。
4. run は transaction ID で元証拠を再収集し、観測 hash と唯一の action が入力と一致する場合だけ開始。復旧 mutex と元 Gate の所有権を証明・移譲し、その後も許可された bytes の変化だけか再観測する。
5. rollback では ROLLING_BACK を記録し、変更済みファイルを対象順の逆順で verified backup から復元・同期。全表が original manifest に戻れば終端 state を確定する。COMMITTING 開始後は実 state が消費予定値と一致するかを journal に反映。消費済みなら範囲と高水位を保持して generation をさらに1進め、pending を解除する。未消費なら before state を保持し、復旧のためだけに消費を新設しない。abort も未消費の before state を保持する。
6. finalize_success は全対象 bytes・消費 state が確定しているとき、または durable COMMIT_DECIDED から成功確定を進める。未置換の CSV を新たに適用する方式はない。成功 state/History の処理は41。終端 phase と状態を検証して proof/completion を固定し、元所有者・復旧所有者の証跡を保持したまま所定の cleanup・解放・退役を行う。途中再停止は最新 inspect から判断し直す。

| 観測条件 | action・結果 |
| --- | --- |
| 未開始／PREPARING／PREPARED、元 CSV・before state を証明 | abort。ABORTED |
| COMMITTING で未完成または既知混在。成功方針なし、復元可能 | rollback。ROLLED_BACK |
| COMMITTING の変更パスなしで before state のまま | 証拠が揃えば rollback。元 state を保持 |
| COMMITTING で全対象、消費 state、現在入力が valid、rollback 不在 | finalize_success。all-target 例外。no-op でも消費 state の証明が必要 |
| COMMITTING の全対象だが入力 stale、成功方針未確定 | 条件を満たす場合 rollback |
| COMMIT_DECIDED 以後、対象 bytes と状態を証明 | finalize_success。元の成功方針を完了 |
| 終端 phase 等があるが proof/completion 未確定 | finish_terminal。終端値を照合して補完 |
| 終端確定、所定の残存物だけ | cleanup |
| 稼働中、不明、異常な証拠、既に正常終端 | 空。手動調査または既存結果の参照 |

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・算出元 | 条件 |
| --- | --- | --- | --- |
| canonical | rollback の置換 | verified 元 bytes | 逆順・同期。成功確定のみの経路は参照 |
| state | 条件付き更新 | 消費 state、成功または失敗の終端 state | 比較で現在段階を証明。消費値は保持 |
| journal / proof / completion / History | 追加 | 元 identity と観測で証明した phase・結果 | 終端順序を遵守。成功 History は成功側のみ |
| lock、temp、backup | 所有操作・所定の削除 | exact owner と path/bytes | cleanup で自分に許可されたものだけ |
| inspect | 参照のみ | 観測 DTO | 復旧実行なし |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| classification / observed_state_hash / allowed_actions | 文字列 / hash / 配列 | inspect の現在観測 |
| readiness / diagnostics | enum / 配列 | 状態、busy・停止理由 |
| run の結果 | outcome と観測等の DTO | aborted、rolled_back、completed 等。CLI は effect と exit も表示 |
| 保存成果物 | 終端証明・completion・所定の所有権証跡 | 元取引についてのみ |
| 例外 | typed code | 古い観測、不明・不整合、I/O |

## 7. エラー仕様

| コード | 条件 | 対応 |
| --- | --- | --- |
| RECOVERY_REQUIRED | 未完了、hash/action が最新観測と違う | inspect を再取得 |
| GATE_BUSY / GATE_OWNERSHIP_MISMATCH | 生存 owner、移譲証明不可 | 待機または手動調査。lock 削除で迂回しない |
| INTEGRITY_CONFLICT / STATE_TRANSITION_PROOF_REQUIRED | 未知 bytes・chain/state の矛盾 | 原本保持、手動調査。候補のない復旧を強行しない |
| PERSISTENCE_NOT_FOUND | 元 Receipt がない | 元 ID と保存原本を確認 |

## 8. 処理例

creators.csv だけ target、song_creators.csv は original、state は消費済み、成功方針なしと証明できる場合、inspect は rollback を返す。元 owner の終了を確認した最新 hash で run すると creators.csv が original に戻り、high-water は消費後のまま、pending は解除、結果は ROLLED_BACK。未知の編集が入った場合は allowed_actions が空になり得る。

## 9. 実装・テスト対応

| 段階 | 実装 | 回帰 |
| --- | --- | --- |
| 1–3 | collectRecoverySnapshot、classifyRecoverySnapshot、probeRecoveryOwner | recovery-decision、known-mixed、ownership-runtime |
| 4 | runRecovery、createRecoveryExecutor | CLI crash、所有権と stale hash |
| 5–6 | createFailureRecoveryService、createSuccessRecoveryService | failure/success-recovery、recovery-durability |

[判定](../../../../src/fn004-recovery-classifier.js)・[実行](../../../../src/fn004-recovery-executor.js)・[判定回帰](../../../../test/fn004-recovery-decision.test.js)・[混在回帰](../../../../test/fn004-known-mixed.test.js)・[詳細契約](40-反映処理・復旧.md)
