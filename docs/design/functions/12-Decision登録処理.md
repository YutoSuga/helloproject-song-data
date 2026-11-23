# FN-004 内部処理設計｜Decision 登録・編集・取消・置換

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](FN-004-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-12。Candidate に対する人間の判断を版として保存し、確認済み判断の有効範囲を管理する。CLI は template/import/show/validate、信頼済みサービスは saveDecisionDraft/cancelDecision/buildDecisionRegistry も使用する。確認による追記は [FN-004-11](11-Decision確認処理.md)。通常操作は READY / initialized と共通 Gate が前提。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元・条件 |
| --- | --- | --- | --- |
| template の candidate ID | 文字列 | 必須 | 現 Candidate のキー。1件のみ |
| import の schema_version / decision_id | 1 / dec_UUID または null | 必須 | 新規は null。編集は既存 ID |
| base_revision / base_content_hash | 正整数・hex64 または両方 null | 必須 | 編集・取消は表示時の head。新規は両方 null |
| mutation_key / actor | UUIDv4 / {id,assurance} | 必須 | 同じ要求は同じキーを保持。actor は信頼済み実行環境 |
| content.scope / candidate_bindings | object / 配列 | 必須 | Candidate ID 集合と、各 ID の source identity、facts、fingerprint、作品・音源・収録等の判断。判断値の一部は draft で null 可 |
| content.entities / relations / evidence / human_note | object / object / 配列 / 文字列 | 必須 | 新規実体・関係、公式出典／人間観測、メモ。型・列の詳細は11 |
| content.replaces / derived_from_revision / unsupported_requests | 配列 / identity または null / 配列 | 必須 | 置換先 identity・理由・evidence_refs、派生元、対象外要求 |
| source_revision / cancellation | identity または null / object または null | 直接 API で必須 | draft は両方 null。取消は source=現在 head、cancellation={target,reason} |

## 3. 参照データ定義

| データ | ファイル | 参照項目・検索キー | 目的 |
| --- | --- | --- | --- |
| Candidate | staging/song-candidates.json | candidate_id で1件、投影14項目・schema | template と現在 fingerprint |
| Decision | staging/decisions.json | ID 別最大 revision、全 mutation key、parent/source、scope、replacement target | 採番・再送・競合・有効版 |
| canonical | data/*.csv | 既存参照 ID、name/title 等の assertions、song_artists の song_id/role/artist_id | draft の指定済み既存参照を比較 |
| runtime | Bootstrap・state・History・ローカル証跡 | READY/initialized | 通常操作の許可 |

## 4. 処理詳細

1. template は現 Candidate を投影し、scope を1件で作る。decision_id/base は null、mutation_key は新 UUID。作品・音源・version・音源同一性は null、関係・実体・証拠は空、performer_review は unreviewed。存在しない・重複 Candidate は `CANDIDATE_FINGERPRINT_MISMATCH`。
2. import は外部 JSON のキーと version を検査し、新規は null base を要求。新規 ID は dec_UUID。既存 mutation key があれば元 ID を再使用して要求 hash を比較できるようにする。編集の対象 ID がなければ `DECISION_HEAD_CONFLICT`。直接 API は完全 mutation command を受ける。
3. Gate 下で全 store を検証し、意味上の配列を整列。観測の credit.names 順は維持。action/version と正規化コマンド（mutation_key を除く）の JCS/SHA-256 を計算し、同キー同 hash は元 revision を返す。同キー異 hash は `INTEGRITY_CONFLICT`。続いて base の版/hash を head と比較。不一致は `DECISION_HEAD_CONFLICT`。
4. 同 ID の scope と replaces は固定。局所参照は型・定義・参照先を照合し、一度廃止した local_ref は再導入不可。draft は元 Candidate を再照合し、指定済み既存参照を canonical と比較する。未選択は null で保持できる。取消は元 head の content と完全一致させ、現 Candidate の読取を行わず、現在の有効 confirmed（なければ head）を cancellation.target とする。cancelled からの直接再取消は `DECISION_INVALID`。
5. 新規は revision=1、編集・取消は head+1。parent は head identity（新規 null）、source は draft=null、取消=head identity。content_hash は自身と metadata を除く revision の JCS/SHA-256。created_at を引継ぎ、saved_at、必要時 cancelled_at を処理時刻に設定する。
6. 有効 confirmed は ID 内最後の confirmed/cancelled event で選ぶ。後続 draft は無視し、最後が取消なら有効確定版なし。異なる scope の置換判断は最初の確認で対象 identity を再照合し、成功すると旧 ID を永久失効する。置換先の取消でも復活しない。同じ Candidate を複数の有効確定版が主張すると `COMPETING_CONFIRMED_DECISION`。
7. 旧 revision を保持し新 record をソートして公開。show は head と指定版（省略時 head）、validate は現在 head の元観測・確認条件の診断を返す。保存操作は6まで通った場合だけ実施。

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・値 | 条件・順序 |
| --- | --- | --- | --- |
| decisions.json | revision 追加 | 5の値、content、actor、metadata.mutation | 最初は排他的作成、以後旧 record 不変を検査して原子的置換 |
| 旧 Decision / 置換対象 | 変更なし | 失効は registry の導出結果 | 個別 record の書換・削除なし |
| Candidate、CSV、state、History | 参照のみ | 3の照合項目 | 取消は現在 Candidate を要求しない |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| template | 外部 draft 入力 | テンプレート取得。保存成果物なし |
| revision / replayed | record / boolean | 新規追記 false、元結果 true |
| head / revision、valid / confirmable / diagnostics | DTO | show / validate の結果。CLI は data に格納 |
| registry | projection、registry_hash、active_confirmed、invalidated_decision_ids | 読取時に計算。個別ファイルなし |
| エラー | typed exception | 失敗時。公開段階を I/O エラーで確認 |

## 7. エラー仕様

| コード | 条件 | 結果・対応 |
| --- | --- | --- |
| DECISION_HEAD_CONFLICT | 古い base / source、置換先の変更 | 保存停止。head を取得し直す |
| DECISION_INVALID / INTEGRITY_CONFLICT | 不正な遷移、同キー異内容 | 停止。元コマンドと判断を照合 |
| CANDIDATE_FINGERPRINT_MISMATCH / EXISTING_IDENTITY_CONFLICT | 元観測、既存参照差分 | 現在データを再確認して再編集 |
| PERSISTENCE_WRITE_FAILED | 公開・同期失敗 | show で公開済みか調べ、元要求を照合 |

## 8. 処理例

rev2 が confirmed の ID に、base=2/hash2 で rev3 draft を保存しても有効版は rev2。rev3 を head として明示取消すると rev4 の parent/source は rev3、cancellation.target は rev2。以前の record は保持し、registry の有効版だけがなくなる。rev2 を base とする別要求は競合する。

## 9. 実装・テスト対応

| 段階 | 実装 | 既存回帰 |
| --- | --- | --- |
| 1–2 | createDecisionTemplate、importDecisionDraft | CLI e2e の外部入力 |
| 3–6 | inspectDecisionMutation、proposeDecisionRevision、buildDecisionRegistry | lifecycle の再送、scope、取消、置換、並行競合 |
| 7 | writeDecisionStore、getDecision、validateDecision | core の atomic/no-clobber、CLI の show/validate |

[application](../../../src/fn004-decision-application.js)・[lifecycle](../../../src/fn004-decision-lifecycle.js)・[テスト](../../../test/fn004-decision-lifecycle.test.js)・[判断モデル](FN-004-判断モデル.md)
