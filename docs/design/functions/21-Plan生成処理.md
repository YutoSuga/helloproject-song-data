# FN-004 内部処理設計｜Plan 生成

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`。判断から「既存の何を使い、どの列値の新規行をどこへ追加するか」を算出する仕様。完全な型・hash projection は [反映計画](FN-004-反映計画.md)、業務上の入口は [全体処理設計](FN-004-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

| 項目 | 内容 |
| --- | --- |
| 処理ID・名称 | FN-004-21 Apply Plan 生成 |
| 業務目的 | 有効な人間の判断から、既存実体の再利用、新規実体・関係の追加、既存関係の維持を具体的な行単位の計画に変換する。追加後の全表整合を評価し、承認すべき具体的な差分を確定する |
| 呼び出し元 | `createApplyPlanService().generateApplyPlan({decision_id})`。CLI `plan create` は管理サービス `createPlan` から生成、指定 Decision identity 照合、保存の順で呼ぶ |
| 実装 | `fn004-plan-application.js` の `context/input/generateApplyPlan`、`fn004-plan-generate.js` の `generatePlanFromInput/generatePlanFromTerminalInput/buildPlan/buildDecisionOperations` |
| 前提条件 | 共通 Gate の下で有効 confirmed、元観測、全表 snapshot、Bootstrap・ID state と履歴が確認でき、通常処理可能な READY / initialized |

## 2. 入力項目定義

| 項目 | 型 | 必須 | 説明 | 設定元 | 備考 |
| --- | --- | --- | --- | --- | --- |
| `decision_id` | `dec_<UUIDv4>` | 必須 | 計画対象 | caller | 単体生成の唯一の業務コマンド項目 |
| `revision, expected_decision_hash` | 正整数、64桁 hex | CLI 作成時必須 | 画面などで確認した版と content hash | caller | 管理サービスが生成結果と比較してから保存 |
| `decision.{decision_id,revision,content_hash,status}` | identity ＋ enum | 必須 | 確認版の identity、状態 | registry の有効確定版 | 最新 head が draft でも有効な confirmed が残り得る |
| `decision.scope.{scope_hash,candidate_ids}, decision.replaces[].target` | hash・ID配列・identity | 必須 | 判断範囲、既存判断の置換先 | 同 confirmed revision | 既適用範囲を照合 |
| `decision.candidate_bindings[]` | object 配列 | 必須 | `candidate_id, source_schema_version, projection_version, source_identity, source_facts, fingerprint` で元観測を照合。`work, song, release_track_refs` を起点に対象行を探索 | 同 confirmed revision | `performer_review` は Candidate と歌唱者関係の帰属にも使用 |
| `decision.entities.*[]` | object 配列 | 必須 | 新規5種の `local_ref, evidence_refs, distinct_from` と CSV 業務列。songs は作品 Ref と人間指定の `song_id_prefix` | 同 confirmed revision | 列対応は4節。空配列可 |
| `decision.relations.*[]` | object 配列 | 必須 | 音源・関連先の Ref、役割・順序・表示クレジット・収録位置・URL 等 | 同 confirmed revision | 型と主キーは [Decision 確認](11-Decision確認処理.md#3-参照データ定義) |
| 各既存 Ref | object | 該当時必須 | `existing_id, assertions, evidence_refs` | binding・実体・関係定義 | 既存マスター行への明示参照 |
| `registry.projection, registry_hash, active_confirmed` | object、hash、配列 | 必須 | 有効 confirmed の identity と scope の集合 | Decision store から計算 | Plan 前提条件に hash を記録 |
| `snapshot.tables / manifest / validation` | object | 必須 | CSV 行集合・ファイル指紋・全表検証結果 | Gate 下の checkout | 現行行の比較と仮想 target の基準 |
| `state.{repository_instance_id,bootstrap_hash,state_hash,generation,high_water_marks,pending_transaction,history}` | object の項目 | 必須 | 来歴、採番基準、保留取引、成功履歴位置 | ID state 原本 | `pending_transaction=null` |
| `history` または終端 context | object | 必須 | success-only の検証済み履歴・state proof または Bootstrap・成功 records・終端 proofs | runtime guard | Plan 生成は証明と現在 state を照合 |
| `generated_at` | timestamp | 成果物に必須 | 生成日時 | サービスの clock | payload の hash 対象外 |

## 3. 参照データ定義

| データ | ファイル・取得元 | 参照項目 | 検索・照合キー | 用途 |
| --- | --- | --- | --- | --- |
| 確定判断・registry | `staging/decisions.json` | revisions の status、content、parent/source、replaces、scope | Decision ID、有効な revision と hash | 現在も有効な確認を選択 |
| 元観測 | `staging/song-candidates.json` | schema、候補 ID、観測14項目 | Candidate ID・source identity・hash | 確認後の変更を検出 |
| 新規追加可能なマスター5表 | `data/{works,creators,artists,releases,songs}.csv` | `work_id,creator_id,artist_id,release_id,song_id` と全行。特に `title`（works/songs/releases）、`name`（creators/artists）、`songs.work_id` | 既存 Ref は ID、新規同名は title/name（songs は work ID も） | ID 最大値、既存参照比較、新規同名の検出 |
| メンバーマスター・主アーティスト | `data/members.csv`、`data/song_artists.csv` | `member_id,name`、`song_id,artist_id,role` | member ID、対象 song ID の `role=primary` | メンバー既存参照、音源 assertion |
| 関係4表 | `data/release_tracks.csv`、`song_artists.csv`、`song_creators.csv`、`song_performers.csv` | 4節の「CSV 列対応」に示す全列。Notes・URL 等も比較 | 収録位置、音源＋アーティスト＋role、音源＋作家＋role、音源＋メンバー。順序一意性は [Decision 確認の関係表](11-Decision確認処理.md#3-参照データ定義) | 行追加、同一行、上書き相当、順序衝突の判定 |
| 全14表 | `data/*.csv` | ヘッダー、全列、行内容とファイル bytes | スキーマ、主キー、外部キー、順序・その他の業務制約 | 元 snapshot と仮想 target の全表検証、canonical precondition |
| Bootstrap／state | `staging/fn004-bootstrap.json`、`staging/fn004-state.json` | repository identity、bootstrap/state hash、genesis、高水位、generation、pending、History head/count | repository、bootstrap hash、証明済み state | 初期化確認、ID 上限確認、計画時点を固定 |
| 成功履歴・終端証明 | `staging/apply-history/<apply_id>.json`、`staging/transaction-proofs/<tx_id>.json` | record/proof hash、前後 state、連鎖、Decision identity、適用 Candidate | repository、History chain、Decision ID/revision と Candidate ID | 過去の成功との重複排除、consumed IDs の検証 |
| Git 監査と中断証跡 | `origin/main` の到達履歴、ローカル Receipt／journal 等 | 既知 ID 列の使用上限、保留要求・復旧要否 | 監査 SHA、namespace、transaction/request ID | 現在 state を検証して計画を許可する |

## 4. 処理詳細

1. **安定した参照データを読む**。Gate を取得し、スキーマ対象の14表を読み込む。型、必須列、キー、参照整合などの全表判定と bytes ベースの manifest を確定する。origin/main の到達履歴を監査する。正常なら2へ。`GATE_BUSY/GATE_CORRUPT`、`CANONICAL_INVALID`、`BOOTSTRAP_AUDIT_INCOMPLETE` 等は例外。
2. **現在 state の来歴を検証**。Bootstrap と state の repository identity・hash・起点を照合し、高水位が canonical/Git 等の証明済み使用上限を下回っていないことを確認。成功履歴の count/head/last_apply_id と連鎖を state と照合。通常の success-only path では履歴の verified state hash が現在 state hash と一致すること、終端証明を使う path では Bootstrap から成功＋終端証拠を適用して再現した state が現在 state 全体と一致することを確認する。pending がなく READY / initialized なら3へ。高水位矛盾は `STATE_HIGH_WATER_INVALID`、未完了は `RECOVERY_REQUIRED`、証明不能は `STATE_TRANSITION_PROOF_REQUIRED` 等。
3. **対象 Decision と元観測を決める**。registry の `active_confirmed` から ID を選択し、確認版 identity と registry projection/hash を照合する。取消済み・置換失効・draft のみなど有効 confirmed がなければ `DECISION_NOT_EFFECTIVE`。履歴の同 ID・同 revision は hash 一致なら `ALREADY_APPLIED`、不一致なら `INTEGRITY_CONFLICT`。同 ID の他 revision は `APPLIED_DECISION_REVISION_UNSUPPORTED`、成功済み Decision を置換するか Candidate が既適用なら `APPLIED_CANDIDATE_COVERAGE_UNSUPPORTED`。Candidate は ID で1件に絞り、保存した source identity・fingerprint と現在投影を比較する。変更は `CANDIDATE_FINGERPRINT_MISMATCH`。すべて通過すれば4へ。
4. **判断を行要件へ展開し、予定 ID を算出**。`entities` と `relations` の定義を local_ref で索引し、binding の作品・音源・収録から参照を辿る。業務上同じ行を指す要件は table＋ref で集約し、参照元の Decision 内パス、Candidate ID、evidence_refs を記録する。`distinct_from` は同名区別の根拠。新規5種は作品・作家・アーティスト・リリース・音源の順、各種では namespace → local_ref の ASCII 順。prefix は W/C/G/L、音源は `song_id_prefix`。namespace ごとに `base=max(現在のマスターID最大数値,state.high_water_marks[namespace])`。n件目は `prefix + 5桁ゼロ埋め(base+n)`。base＋要求総数が99999を超えれば、その namespace 全体の予定 ID を作らず `ID_CAPACITY_EXHAUSTED` の conflict 対象とする。欠けた予定 ID に依存する行は診断対象に回し、5へ。
5. **行を組み立て分類**。既存 Ref は canonical ID、新規 Ref は予定 ID へ解決。下表の業務値を同名 CSV 列へ写し、空欄相当の null は空文字、整数は10進文字列にする。マスターの `created_at/updated_at` は `{system_binding:"apply_time"}`。関係の全列比較では整数を数値として比較し、その他の列は文字列を完全比較する。行ごとの結果は次の判定表。Plan 自体の不正や表現不能な整数は `PLAN_INTEGRITY_CONFLICT` / `PLAN_INTEGER_UNREPRESENTABLE` 等で停止。分類を終えたら6へ。
6. **依存と仮想 target を評価**。各行の外部キーを満たす insert/reuse 操作の ID を `dependencies` に設定。参照できる操作が無ければその行を除き `REQUIREMENT_UNPLANNED` を出す。除いたことによる後続の依存欠落も繰り返し確認する。操作を表・音源 prefix・subject・typed key 等の規則順に並べる。操作 ID は schema_version・Decision ID・表・subject の JCS/SHA-256 に `op_` を付けた値。仮想 target は元 snapshot の複製に insert だけを加える。必須項目・外部キー・主キー・順序・primary 等を全表評価し、検証用の時刻プレースホルダは固定値を使う。時刻の system binding を残した target をパス順・主キー順の projection にして JCS/SHA-256 を算出する。未計画要件または採番 conflict で target を組み立てられない場合は `performed:false / target_semantic_hash:null`。その他の全表エラーは `CANONICAL_TARGET_INVALID` 診断。エラー診断、conflict または未検証があれば `applicable:false` とし、7へ。
7. **Plan を梱包して返す**。repository/Bootstrap identity、rules、Decision identity/scope/registry hash、Candidate、canonical manifest、state、History の前提と、予定 ID・operations・検証結果を payload に格納。 `plan_hash=SHA-256(JCS(payload))`、`plan_id=ap_<plan_hash>`。生成時刻は envelope に保持。Plan schema、row template、依存、ID・hash 等を検証し、Gate 所有を再確認してオブジェクトを返す。不整合は `PLAN_INTEGRITY_CONFLICT` 等。正常でもこの段階の変更はメモリ上に限られる。
8. **CLI 作成の場合だけ別呼び出しで保存**。CLI の requested revision/hash が生成 Plan の Decision identity と比べて異なれば `STALE_PLAN`。一致すれば `saveApplyPlan` が別の Gate 取得で現在条件を再評価する。hash・適用済み履歴・rules・有効 Decision を確認し、再生成 payload と照合。現在の `APPLICABLE` または `BLOCKED` のときだけ、Git 監査が変化していないことを再確認して no-clobber 保存。同じ ID/payload があれば保存済み原本（元の generated_at）を返す。前提変化、既適用扱い、同一性破損、I/O 失敗はエラーで保存を完了しない。

### CSV 列対応（5）

| 対象 | 入力 → 生成 CSV 列 |
| --- | --- |
| `works` | 予定 ID → `work_id`。 `title,title_kana,notes,source_url` とシステム時刻列 |
| `creators` | 予定 ID → `creator_id`。 `name,name_kana,notes,source_url` とシステム時刻列 |
| `artists` | 予定 ID → `artist_id`。 `name,type,start_date,end_date,notes,source_url` とシステム時刻列 |
| `releases` | 予定 ID → `release_id`。 `title,release_type,release_date,catalog_number,notes,source_url` とシステム時刻列 |
| `songs` | 予定 ID → `song_id`、work Ref → `work_id`。 `title,version_name,version_type,release_date,notes,source_url` とシステム時刻列 |
| `release_tracks` | release/song Ref → `release_id/song_id`。 `disc_number,track_number,track_title,notes,source_url` |
| `song_artists` | song/artist Ref → `song_id/artist_id`。 `role,credit_order,source_url` |
| `song_creators` | song/creator Ref → `song_id/creator_id`。 `role,credit_name,credit_order,source_url`。作家マスターの name と credit_name は別の入力 |
| `song_performers` | song/member Ref → `song_id/member_id`。 `performer_order,notes,source_url` |

### 行判定（5）

| 要件 | 比較・条件 | 判定・処理 |
| --- | --- | --- |
| 既存実体 Ref | ID で1件。全 assertions（空欄は null、primary は全 ID の配列）が一致 | `reuse`。既存行と hash を計画に記録。不存在は `EXISTING_ID_MISSING`、値の差は `EXISTING_IDENTITY_CONFLICT` の conflict |
| 新規実体 | 予定 ID があり、同一 title/name（音源は同一 work 内）の既存候補すべてに根拠付き `distinct_from` があるか候補なし | `insert`。同名の未判断は `DUPLICATE_IDENTITY_UNREVIEWED`、ID不足は `ID_CAPACITY_EXHAUSTED` の conflict |
| 関係・同一主キーで差分あり | 現 canonical と全列比較で一列でも差がある | `conflict / RELATION_PK_CONTENT_CONFLICT` |
| 関係・別主キーの順序が衝突 | 同じ scope 内に同じ非空の順序値を持つ別主キーの行がある | `conflict / RELATION_ORDER_CONFLICT` |
| 関係・同一主キーで全列一致 | 上記の衝突がなく、列比較が全一致 | `no_op`。要求行、既存行と hash を記録 |
| 関係・新しい主キー | 上記の衝突がない | `insert`。複合主キーと新規行 template を記録 |

## 5. 登録・更新仕様

| 対象 | 操作 | 登録・更新項目 | 設定値の算出元 | 実行条件 |
| --- | --- | --- | --- | --- |
| 仮想 target | メモリ上で追加 | insert 行 template | 決定した列対応と予定 ID | target を評価できるとき |
| `staging/apply-plans/<plan_id>.json` | 新規追加／同 payload は変更なし | Plan envelope 全体 | 生成結果と保存時の再評価 | 明示保存、または CLI plan create の保存段階 |
| Candidate・Decision・canonical・Bootstrap・state・History・終端証明 | 参照のみ | — | 比較・証明・計画の参照元 | 生成、保存チェック |
| Approval、Receipt、journal | 変更なし | — | — | 生成・保存全体 |

既存 Plan の更新・削除、ID の予約／消費、state generation の加算、canonical 書き込みは発生しない。

## 6. 出力項目定義

| 項目 | 型 | 説明 | 設定条件 |
| --- | --- | --- | --- |
| 戻り値 `schema_version, plan_id, generated_at, plan_hash` | 1、ID、timestamp、hash | envelope の識別・表示項目 | 生成成功 |
| `payload.{repository_instance_id, bootstrap_hash, rules, decision}` | object 内の項目 | 来歴・ルール・Decision identity/scope/registry hash | 生成成功 |
| `candidate_preconditions[]` | 配列 | `candidate_id, source_schema_version, projection_version, source_identity, fingerprint, snapshot_hash`。snapshot_hash は fingerprint.value | binding ごと |
| `canonical_precondition` | manifest | 元 CSV のファイル別・全体指紋 | 生成成功 |
| `id_state_precondition / history_precondition` | object | state hash、generation、高水位、pending / Bootstrap hash、件数、head、last apply ID、semantic hash | 生成成功 |
| `planned_id_mappings[]` | object 配列 | `entity_type, local_ref, namespace, planned_id` | 予定値を算出した実体ごと |
| `operations[]` | object 配列 | `operation_id, schema_version, classification, table, source, dependencies, key, result`。result は分類に応じ template・既存行・差分理由等 | 計画できた行要件ごと |
| `no_op_operations / conflicts / unsupported_operations` | operation ID 配列 | 分類別索引。正式 v1 Plan の unsupported は空 | 生成成功 |
| `validation / applicability` | object | 実施有無、target semantic hash、診断 / 適用可否、ブロック診断、該当操作 ID | 生成成功。BLOCKED の計画でも返す |
| 保存成果物 | Apply Plan v1 JSON | 戻り値と同型。既存同 payload なら保存済み原本 | save 成功時のみ |
| 異常時 | 例外 | typed code。入力や前提が成立せず Plan を作れないとき | 分類で検出した業務衝突は通常、例外ではなく Plan の診断として返す |

仮想 target の全CSVはレスポンスに含まれない。再現に必要な元 snapshot の指紋、追加行 template、検証結果と target hash を保持する。 `checkApplyPlan` の戻り値は別契約の `{status,plan_id,applicable,diagnostics,history_match}`。

## 7. エラー仕様

| エラーコード | 発生条件 | 処理結果 | 再実行・復旧方法 |
| --- | --- | --- | --- |
| `DECISION_NOT_EFFECTIVE` / `CANDIDATE_FINGERPRINT_MISMATCH` | 有効確認版がない、元観測が変化・消失・重複 | 生成停止 | 現観測と判断を再確認 |
| `ALREADY_APPLIED` / `APPLIED_DECISION_REVISION_UNSUPPORTED` / `APPLIED_CANDIDATE_COVERAGE_UNSUPPORTED` | 成功済み identity・他版・Candidate 等との衝突 | 生成停止 | 成功履歴と対象範囲を調べる |
| `INTEGRITY_CONFLICT` / `PLAN_INTEGRITY_CONFLICT` | registry/成功履歴の矛盾、Plan の hash・列・依存破損 | 停止 | 正本と保存証拠を照合 |
| `CANONICAL_INVALID` / `PLAN_INTEGER_UNREPRESENTABLE` | 元全表が不正、または型付きキーの値等を安全に表現できない | 停止 | 診断対象の元データを調べる |
| `STATE_HIGH_WATER_INVALID` / `STATE_TRANSITION_PROOF_REQUIRED` / `RECOVERY_REQUIRED` 等 | 高水位、現在 state 証明、pending/recovery の不成立 | 停止 | Bootstrap・state・履歴・元取引の証拠確認 |
| `EXISTING_ID_MISSING` / `EXISTING_IDENTITY_CONFLICT` / `DUPLICATE_IDENTITY_UNREVIEWED` | 既存 Ref または同名区別の問題 | conflict、適用不可 | Decision を再確認 |
| `RELATION_PK_CONTENT_CONFLICT` / `RELATION_ORDER_CONFLICT` | 同一キーの値差、別キー間の順序衝突 | conflict、適用不可 | 既存行・役割・順序と人間の要求を再確認 |
| `ID_CAPACITY_EXHAUSTED` / `REQUIREMENT_UNPLANNED` / `CANONICAL_TARGET_INVALID` | namespace 枯渇、依存欠落、全表制約違反 | 診断、適用不可 | 採番上限か不足している行・参照を確認 |
| `STALE_PLAN` | Plan 作成の指定版違い、保存直前の再計算・監査で変更を検出 | 保存しない | 現在の判断・状態で計画を取り直す |
| `GATE_BUSY` / `GATE_CORRUPT` / `PERSISTENCE_WRITE_FAILED` 等 | Gate、I/O、同期異常 | 例外。同期失敗時は公開済みの可能性あり | 証跡・公開段階を調べ、保存先原本を照会 |

## 8. 処理例

### 新規音源・作品・作家の追加

検証 fixture の有効 confirmed で新規作品 `work:w1`、新規作家 `creator:c1`、新規音源 `song:s1`（prefix H）を明示し、primary と収録・作家関係を持つとする。既存最大または高水位の大きい方が W=1、C=0、H=0 なら、対応 ID は W00002、C00001、H00001。 `songs.work_id=W00002`、`song_creators.song_id=H00001 / creator_id=C00001` となり、該当マスター操作に依存する。全表検証を通過すれば `applicable:true`。メモリ上で ID が見えても実 CSV・state には反映されていない。 [新規実体・関係の回帰](../../../test/fn004-apply-plan.test.js)

### J00018 の既存収録参照と新規作家

現行 main では [Decision 確認の例](11-Decision確認処理.md#8-処理例) の同一収録行が全列一致なら確認できる。Plan はその既存収録を `no_op` とする。#109 マージ前は Plan 内部に同じ分類があっても、同一収録の新 draft は Decision 確認で止まった。

J00018 の作曲順序1〜3は既存。新規用の例示順序は4、5。下記は判断から列への変換例であり、実行コマンドや完全な公式クレジット入力ではない。

| 判断 | 検索・算出 | 計画結果 |
| --- | --- | --- |
| 作品 W00017、音源 J00018、リリース L00001 | 各 ID の既存行と assertion が一致 | `reuse`。元行を保持し、新しい ID を生成しない |
| Disc 2／Track 2 の既存収録 | PK `(L00001,2,2)`、song_id、track_title、notes、source_url を比較し全列一致 | `no_op`。例えば notes/URL に値の差があれば、Plan 分類器では PK 内容 conflict。#109 の確認経路でも一致しない入力は拒否 |
| `creator:c1`、`creator:c2` | C の最大・高水位の大きい方が86で、他に新規 C を要求しない場合、順に C00087、C00088 | `creators` へ insert 2件。 `creator_id` と入力した氏名等、apply_time binding を保持 |
| 新規作曲関係2件 | 1件目の例は `song_id=J00018, creator_id=C00087, role=composition, credit_name=<クレジット表記>, credit_order=4, source_url=<判断の出典>`。2件目は C00088、順序5 | PK・順序が空いていれば `song_creators` へ insert 2件。J00018 の reuse と各作家 insert に依存 |

#109 本文の隔離検証では、同一収録が `no_op`、新規作家2件＋関係2件が insert。確定後の C 上限が88となったのはその実行結果。現行 main の回帰には正式確認から同一収録 `no_op` までの経路が含まれる。 [PR #109](https://github.com/YutoSuga/helloproject-song-data/pull/109)・[対象差分](https://github.com/YutoSuga/helloproject-song-data/pull/109/files)

## 9. 実装・テスト対応

| ステップ | 対応実装 | 回帰の観点 |
| --- | --- | --- |
| 1 | `context`、`validatedSnapshot`、`auditGitIds` | apply-plan の current CSV bytes、canonical-validation の表・列・制約 |
| 2 | `inspectRuntimeState`、`verifySuccessfulHistory`、`generatePlanFromTerminalInput` | apply-plan の pending、History/state progression、history-proof の証明 |
| 3 | `input`、`buildPlan`、`lookupAppliedDecision`、`validateCandidateSource` | apply-plan の既適用区分・current candidate・有効版・later draft |
| 4 | `buildDecisionOperations`、`collectDecisionRequirements`、`allocatePlannedIds` | plan-primitives の max+1、ASCII 順、prefix、namespace 枯渇 |
| 5 | `classifyExistingReference`、`classifyNewEntity`、`classifyRelation`、`plannedRowTemplate` | plan-primitives の再利用・同名・全列 no_op・PK conflict、apply-plan の全種行 |
| 6 | `buildDecisionOperations`、`validateHypotheticalTarget` | plan-primitives の仮想 target・PK/FK/primary、apply-plan の未計画と依存検証 |
| 7 | `buildPlan`、`applyPlanHash`、`validateApplyPlan` | apply-plan の決定性・artifact 破損、plan-primitives の payload hash |
| 8 | `createPlan`、`saveApplyPlan`（サービス／リポジトリ）、`check` | apply-plan の生成・保存・取得・check、I/O 失敗、stale、原本保護 |

[Plan application](../../../src/fn004-plan-application.js)・[生成](../../../src/fn004-plan-generate.js)・[行分類](../../../src/fn004-plan-classification.js)・[採番と列変換](../../../src/fn004-plan-primitives.js)・[仮想 target](../../../src/fn004-plan-target.js)・[apply-plan テスト](../../../test/fn004-apply-plan.test.js)・[plan-primitives テスト](../../../test/fn004-plan-primitives.test.js)・[History proof テスト](../../../test/fn004-history-proof.test.js)

共通サービス契約では `generateApplyPlan / getApplyPlan` の行に保存も記載されている。実装は `generateApplyPlan` がメモリ上の生成、`saveApplyPlan` が再照合と保存を担当し、CLI の `plan create` が両者を合成する。
