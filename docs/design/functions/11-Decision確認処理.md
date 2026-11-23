# FN-004 内部処理設計｜Decision 確認

基準は main `cd46677e62c89814b99c751aedaf05515f9a73cd`。本書は確認要求を受けてから保存するまでの判定とデータ操作を規定する。型・正規化・ハッシュの完全定義は [判断モデル](FN-004-判断モデル.md)、操作全体は [全体処理設計](FN-004-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

| 項目 | 内容 |
| --- | --- |
| 処理ID・名称 | FN-004-11 Decision 確認 |
| 業務目的 | Candidate がどの作品・音源・収録位置に対応するか、新規または既存の実体をどの根拠で使うかを、人間が編集済みの draft に対して確定する |
| 呼び出し元 | `canonical:manage -- decision confirm <id> --revision <n> --expect-head <hash>`。信頼済み Node.js 呼び出し元は `confirmDecisionHead` または `confirmDecision` |
| 実装 | `createDecisionService` の `confirmDecisionHead` / `confirmDecision` → `mutate`、`inspectDecisionMutation` → `proposeDecisionRevision` → `validateDecisionCanonicalContext` → `writeDecisionStore` |
| 前提条件 | 対象の draft が保存済み、runtime が READY / initialized、共通 Gate を所有。CLI の validate は事前点検として任意。確認時は同じ判定を新たな入力状態で行う |

## 2. 入力項目定義

「必須」はキーの存在を示す。「確認時非null」は draft に null を保存できるが確認時には値が必要な項目。

| 項目 | 型 | 必須 | 説明 | 設定元 | 備考 |
| --- | --- | --- | --- | --- | --- |
| `decision_id` | `dec_<UUIDv4>` | 必須 | 確認対象 | 利用者が show 結果から指定 | ID は変更しない |
| `revision` / `expected_head` | 正整数 / 小文字64桁 hex | 必須 | 表示した draft の版と content hash | show 結果 | head ラッパー用。直接呼び出し名は `base_revision` / `base_content_hash` |
| `actor.id / assurance` | 文字列 / enum | 必須 | 確認者 | CLI のローカル実行者、または信頼済み caller | CLI は `local_process` |
| `mutation_key` | UUIDv4 | 必須 | 要求同定キー | CLI が呼び出しごとに生成。直接 API は caller が保持 | 直接 API の厳密な再送には同じキーと内容が必要 |
| `source_revision` | Decision identity | 必須 | `decision_id, revision, content_hash` が元 draft と一致する参照 | head ラッパーが draft から取得、直接 API は caller | `parent` にも元 draft を設定 |
| `cancellation` | null | 必須 | 取消情報 | ラッパー / caller | 確認時は null |
| `content.scope` | object | 必須 | 対象 Candidate ID 集合と scope hash | 保存 draft | 同じ Decision ID のまま対象集合を変更できない |
| `content.replaces[] / derived_from_revision` | 配列 / identity または null | 必須 | 置換先の identity・理由・根拠 / 派生元 | 保存 draft | 初回確認の置換先は現在有効な確定版 |
| `candidate_bindings[].candidate_id / source_schema_version / projection_version` | 文字列 / 1 / 1 | 必須 | 元観測の同定 | Candidate からテンプレート取得時 | scope の ID 集合と対応 |
| `candidate_bindings[].source_identity / source_facts / fingerprint` | object | 必須 | 収録の観測キー・観測内容・比較用 hash | テンプレート取得時 | 現在の Candidate で再計算 |
| `candidate_bindings[].work / song` | typed Ref | 確認時非null | どの作品・音源を登録または再利用するか | 人間の判断 | 既存参照は `existing_id, assertions, evidence_refs`。新規参照は `local_ref` |
| `candidate_bindings[].audio_identity / accepted_version_type` | enum | 確認時非null | 同音源・別録音の判断 / 採用する音源種別 | 人間の判断 | 既存は `same_audio`。新規 local 音源には少なくとも一つの `distinct_recording` |
| `candidate_bindings[].release_track_refs / performer_review / evidence_refs / human_note` | 配列 / enum / 配列 / 文字列 | 必須 | 収録の参照、歌唱者レビュー指定、根拠、メモ | 人間の判断 | 収録参照と根拠は確認時非空 |
| `entities.*[]` | 新規実体定義 | 必須 | 後掲の作品・作家・アーティスト・リリース・音源属性 | 人間の判断 | 定義ごとに `local_ref, evidence_refs, distinct_from`。IDはここで採番しない |
| `relations.*[]` | 新規・再利用候補の関係定義 | 必須 | 後掲の収録、アーティスト、作家、歌唱者属性 | 人間の判断 | 各行に `local_ref, evidence_refs` |
| `evidence[]` | object 配列 | 必須 | `evidence_id, kind, url, publisher, official_basis, checked_at, facts, candidate_ids, source_fingerprints, human_note` | 確認した公式情報・観測 | 公式証拠は URL・発行元・公式性根拠が必須 |
| `unsupported_requests[] / human_note` | 配列 / 文字列 | 必須 | 対象外要求 / 全体メモ | 保存 draft | 前者は確認時に空配列 |

直接 `confirmDecision(command)` に渡す `content` は保存 draft の判断内容を複写する。並び順を正規化した後、保存内容と全項目が一致する必要がある。確認要求に更新したクレジット等を混ぜる場合は、先に draft を保存する。

| `entities` の配列 | 定義の業務項目（共通項目を除く） |
| --- | --- |
| `works` | `title, title_kana, notes, source_url` |
| `creators` | `name, name_kana, notes, source_url` |
| `artists` | `name, type, start_date, end_date, notes, source_url` |
| `releases` | `title, release_type, release_date, catalog_number, notes, source_url` |
| `songs` | `work, title, version_name, version_type, release_date, notes, source_url, song_id_prefix` |

各属性の値の型は、タイトル・氏名・読み・注記・品番・クレジット表記が文字列、出典が HTTPS URL、日付が暦日、種別と role が canonical の列挙値、disc/track・各順序が正の安全整数。確認時は canonical 必須属性と判断固有の必須値を設定する。必須でない値は null を保持し、後続の Plan が CSV 空欄へ変換する。作家のマスター名と関係の credit_name、収集した disc_index と正式 disc_number はそれぞれ別項目。

## 3. 参照データ定義

| データ | ファイル・取得元 | 参照項目 | 検索・照合キー | 用途 |
| --- | --- | --- | --- | --- |
| Decision store | `staging/decisions.json` | revision、status、content_hash、parent/source、scope・replaces、metadata.mutation | `decision_id` の最新 revision、mutation key、置換先 identity、candidate ID | head・再送・有効確認の競合検出 |
| Candidate | `staging/song-candidates.json` | `schema_version`、`candidates[].candidate_id` と下記14項目 | `candidate_id` で1件 | 元観測との比較 |
| 作品／作家／アーティスト | `data/works.csv`、`creators.csv`、`artists.csv` | `work_id,title`／`creator_id,name`／`artist_id,name,type` | 各既存 ID、同名検索は title / name | assertions と新規実体の区別を確認 |
| 音源 | `data/songs.csv`、`song_artists.csv` | `song_id,work_id,title,version_name,version_type`、主アーティスト `artist_id` | song ID。主アーティストは `song_id + role=primary`。同名検索は work ID と title | 音源 identity 確認 |
| リリース／メンバー | `data/releases.csv`、`members.csv` | `release_id,title,release_type,release_date,catalog_number`／`member_id,name` | 各既存 ID、release 同名検索は title | assertions 確認 |
| 関係 | 次表の `data/<table>.csv` | 主キーと順序に関わる列 | 次表 | main の確認で既存キー・順序と比較 |
| runtime | Bootstrap・state・History・終端証明、Gate とローカル実行証跡 | repository identity、state hash、高水位、pending、連鎖、未完了証跡 | bootstrap hash、state/History head、transaction identity | 通常操作を許可するか判定 |

観測14項目のうち、`source_artist_slug, source_release_url, media_type, edition, product_number, disc_index, track_number` は source identity にも使用する。残りは `title, release_title, release_date, release_type, artist_name, source_url, credits`。

| 関係テーブル | 入力定義（共通項目を除く） | CSV 主キー | 順序一意性 |
| --- | --- | --- | --- |
| `release_tracks` | `release, disc_number, track_number, song, track_title, notes, source_url` | `release_id, disc_number, track_number` | 収録位置を主キーで判定 |
| `song_artists` | `song, artist, role, credit_order, source_url` | `song_id, artist_id, role` | `song_id, role, credit_order` |
| `song_creators` | `song, creator, role, credit_name, credit_order, source_url` | `song_id, creator_id, role` | `song_id, role, credit_order` |
| `song_performers` | `song, member, performer_order, notes, source_url` | `song_id, member_id` | `song_id, performer_order` |

## 4. 処理詳細

1. **入力の確保と排他**。渡された JSON を複写し、同じ Gate の下で CSV 全表の snapshot と runtime を検査する。妥当な snapshot、READY / initialized が揃えば2へ。取得中の一時的な `GATE_BUSY` は取得予算5秒内で再試行し、期限または取得後の失敗は返す。`GATE_CORRUPT`、`CANONICAL_INVALID`、runtime の診断コードは処理停止。
2. **対象と再送を判定**。全 revision のスキーマ・hash・順序・遷移を検証して registry を構築。head ラッパーは指定 ID の最新 revision と `revision/expected_head` を比較し、存在しなければ `PERSISTENCE_NOT_FOUND`、違えば `DECISION_HEAD_CONFLICT`。一致した draft の content と identity で正式コマンドを組む。直接コマンドは意味上の配列を整列し、`schema_version=1, action=confirm` とキーを除く正規化済み入力の JCS/SHA-256 を求める。同じ mutation key・同じ request hash が既にあれば、保存済み revision を `replayed:true` で返す。キーが同じで hash が違えば `INTEGRITY_CONFLICT`。新規要求は base と現在 head、source と head identity、scope と保存 scope、content と保存内容を照合し、現在 draft なら3へ。OCC 不一致は `DECISION_HEAD_CONFLICT`、改変した確認 content は `INTEGRITY_CONFLICT`、型・状態・置換失効は `DECISION_INVALID`。初回確認で置換先 identity が現在の有効版と違えば `DECISION_HEAD_CONFLICT`。
3. **Candidate の元観測を固定**。schema v1 の現 Candidate から該当 ID を一意に選び、14項目を投影。欠落項目を既定値に補い、credit の names 順と値は維持する。保存された source facts と現在の投影の双方を JCS/SHA-256 で再計算し、保存 fingerprint と比較。identity 7項目も一致が必要。未存在・複数件・変化は `CANDIDATE_FINGERPRINT_MISMATCH`。一致なら4へ。厳格 JSON の読取・解析自体に失敗した場合は persistence のエラーを返す。
4. **確認候補を組み立て、業務ルールを照合**。対象 draft と同じ content で revision を +1、status を confirmed とする。未対応要求は `UNSUPPORTED_OPERATION`。各 binding で作品・音源・version_type・audio_identity が決まり、収録参照が同じ音源を指すことを確認。全新規実体が判断から到達可能で、関係が対象音源・収録に結び付くこと、新規音源には primary が1件以上あることを確認。既存参照と新規定義の型、根拠参照、公式 URL と根拠の一致、Decision 内の主キー・順序重複、同名新規同士の区別をチェックする。候補 revision の完全性違反は `DECISION_INCOMPLETE`。追記候補で registry を再構築し他の有効 Decision と Candidate が競合すれば `COMPETING_CONFIRMED_DECISION`。正常なら5へ。
5. **canonical と照合**。既存 ID は対象 CSV の主キーから検索し、assertions を列値と比較。空欄は null、primary ID は `role=primary` の全 ID をソートした配列と照合。不存在または不一致は `EXISTING_IDENTITY_CONFLICT`。新規実体は name/title 完全一致（音源なら同一作品内）を走査し、一致した各既存 ID について根拠付き `distinct_from` がなければ `DECISION_INCOMPLETE`。関係ごとに canonical の主キー・順序組を登録してから判断側を照合。判断側の ID 項目は existing ID または型付き local_ref、CSV 整数は safe integer として比較、空欄は null。順序組に null がある場合は順序重複を数えない。main は既存関係と同じ主キーを全列の値に関わらず拒否し、異なる主キーの順序衝突も拒否する。いずれも `DECISION_INCOMPLETE`。正常なら6へ。
6. **確認済み revision の公開**。Gate 所有を再確認し、保存済み revision の内容を保持したまま新 revision を加え、ID・revision 順に並べて store 全体を原子的に置換する。正常時は `{revision, replayed:false}`。I/O 失敗はエラーと公開段階を返す。保存エラーでも rename 後の同期失敗なら新 revision が既に見える可能性がある。

## 5. 登録・更新仕様

| 対象 | 操作 | 登録・更新項目 | 設定値の算出元 | 実行条件 |
| --- | --- | --- | --- | --- |
| `staging/decisions.json` の `revisions[]` | 1件追加、JSON ファイル全体は原子的に置換 | `schema_version, decision_id, revision, status, parent, source_revision, cancellation, content, actor, content_hash, metadata`。content は展開フィールドとして保存 | 同一 ID、draft + 1、confirmed。parent/source は元 draft、cancellation は null。created_at は引継ぎ、saved_at/confirmed_at は処理時刻、cancelled_at は null。mutation key と request hash を保存。content_hash は自身と metadata を除く revision projection の JCS/SHA-256 | 新規要求で1〜5が成功 |
| 既存 Decision revisions | 変更なし | 保存済み行の値・版番号を保持 | append-only store 検証 | 常時 |
| Candidate・canonical・Bootstrap・state・History／終端証明 | 参照のみ | 照合用 snapshot | 実ファイル | 常時 |
| Plan・Approval・Receipt・journal | 変更なし | — | — | 常時 |

## 6. 出力項目定義

| 項目 | 型 | 説明 | 設定条件 |
| --- | --- | --- | --- |
| 戻り値 `revision` | DecisionRevision v1 | 確認済み revision 全項目 | 新規保存成功、または厳密再送で元の保存結果 |
| 戻り値 `replayed` | boolean | 元結果の再利用有無 | 再送 true、新規保存 false |
| 保存成果物 | DecisionStore v1 | 最新・過去 revision を持つ JSON | 新規保存成功。再送時に新行を追加しない |
| CLI 出力 | 表示／JSON envelope | `data` にサービス結果。エラーは code と限定した診断情報 | adapter の表示契約に従う |
| エラー | 例外 | 入力・状態・競合・I/O の typed code | 処理停止時。別操作の `validateDecision` は一部の判断エラーを `valid:false / confirmable:false / diagnostics` に変換 |

## 7. エラー仕様

| エラーコード | 発生条件 | 処理結果 | 再実行・復旧方法 |
| --- | --- | --- | --- |
| `PERSISTENCE_NOT_FOUND` | head ラッパーで ID が存在しない、または参照ファイルなし | 保存なし | ID と入力ファイルを確認 |
| `DECISION_HEAD_CONFLICT` | 表示版と現在 head 不一致、または置換対象が変更 | 保存なし | show で取得し直し、差分を再判断 |
| `DECISION_INVALID` | 入力構造、draft 以外の遷移、失効済み ID 等 | 保存なし | 要求元・現在状態を確認 |
| `INTEGRITY_CONFLICT` | 同じ mutation key の内容差、直接確認コマンドと保存 draft の内容差 | 保存なし | 元要求の identity・内容を照合 |
| `CANDIDATE_FINGERPRINT_MISMATCH` | 対象の不在・重複・元観測変更 | 保存なし | 現観測を人間が再確認して明示的に draft に採用 |
| `EXISTING_IDENTITY_CONFLICT` | 既存 ID が不在、または assertions 不一致 | 保存なし | 正しい既存実体を判断し直す |
| `DECISION_INCOMPLETE` | 必須判断不足、同名区別不足、関係 PK/順序衝突等 | 保存なし | 欠けた根拠や判断を修正。既存収録行の同一キー制約は8節 |
| `COMPETING_CONFIRMED_DECISION` / `UNSUPPORTED_OPERATION` | Candidate の競合 / v1対象外要求 | 保存なし | 他 Decision の有効性・対象範囲を見直す |
| `GATE_BUSY` / `GATE_CORRUPT` / `RECOVERY_REQUIRED` 等 | 排他・runtime guard | 保存を開始しない | 所有者・元 Request・診断を確認 |
| `PERSISTENCE_WRITE_FAILED` 等 | 一時ファイル・置換・同期の失敗 | 成功を返さない。公開済みの可能性あり | 保存結果を show で確認。直接 API の同キー・同内容再送は runtime が正常なら保存済み結果を返せる |

## 8. 処理例

### J00018 の既存収録を参照し作家を追加する判断

main の `songs` には `J00018,W00017,POPPIN' LOVE`（version_name 空欄、`original`）、主アーティストは G00001。L00001 は『terzo』初回生産限定盤A。説明用の draft では、Candidate の元観測と一致する fingerprint に加え、次の判断を持つ。これらは判断入力の抜粋で、Candidate 本体や正式コマンドの完全例ではない。

| 入力 | 比較対象・判定 |
| --- | --- |
| work=`W00017`、song=`J00018`、`same_audio`、`original`。assertions に作品ID、タイトル、version_name=null、主アーティスト等 | 各 CSV の主キーで検索し、値を比較。音源の作品も W00017 で一致 |
| `release_track_refs=[track:t1]`。track:t1 は L00001、disc=2、track=2、J00018、`POPPIN' LOVE`、notes=null、公式 URL は既存行と同じ | `release_tracks` に同一主キー `(L00001,2,2)` が存在 |
| 新規 creator 2件と、J00018 に対する composition 関係2件 | 作家の名前・出典・根拠を明示。既存 composition は順序1〜3。新規の順序4・5を指定する例ならその組と競合しない |

**main の結果**。元観測・根拠など他の項目が正常でも、5で収録行の主キーが重複し `DECISION_INCOMPLETE`。新 confirmed revision は保存されず、この draft から正式 Plan には進まない。必須の収録参照を省略しても4の条件に違反する。 [音源](../../../data/songs.csv)・[既存収録](../../../data/release_tracks.csv)・[既存作家関係](../../../data/song_creators.csv)

**PR #109 の提案**。4関係の同一主キーについて、行の ID 列をすべて既存 ID に解決でき、Plan と同じ `plannedRowTemplate` と `equivalentCanonicalRows` で全列一致する場合は、既存の順序枠をそのまま使って次へ進む。空欄はテンプレートで空文字に変換し、整数表記は数値比較、その他の文字列は完全一致。収録位置が一致しても音源が新規 local_ref の場合、URL や曲名などが異なる場合、Decision 内重複や別主キーの順序衝突が残る場合は拒否する。差分が採用された後に、確認から Plan の `no_op` までの回帰、4関係の比較・拒否条件、J00018 実例を再照合する。 [PR #109 差分](https://github.com/YutoSuga/helloproject-song-data/pull/109/files)・[提案 head の回帰](https://github.com/YutoSuga/helloproject-song-data/blob/a4dc4337992c0951db1a766403005e2d0fc9eb03/test/fn004-apply-plan.test.js)

## 9. 実装・テスト対応

| ステップ | 対応実装 | 回帰の観点 |
| --- | --- | --- |
| 1 | `mutate`、`gated`、`inspectRuntimeState` | lifecycle の READY guard、Gate 競合・並行書込 |
| 2 | `confirmation`、`inspectDecisionMutation`、`normalizeDecisionCommand` | lifecycle の OCC・再送・置換先 CAS |
| 3 | `proposeDecisionRevision`、`validateCandidateSource`、`candidateSourceProjection` | core の14項目投影、lifecycle の現在 Candidate 変化 |
| 4 | `validateDecisionRevision`、`buildDecisionRegistry` | core の reachability/primary/関係重複、lifecycle の competing claims |
| 5 | `validateDecisionCanonicalContext` | lifecycle の既存 assertions と同名区別根拠。既存関係の全列一致許可は #109 側の回帰 |
| 6 | `writeDecisionStore`、`assertImmutableDecisionStore` | core の immutable store、lifecycle の atomic publication・rename 後の再送 |

[Decision application](../../../src/fn004-decision-application.js)・[lifecycle](../../../src/fn004-decision-lifecycle.js)・[core](../../../src/fn004-decision-core.js)・[repository](../../../src/fn004-repository.js)・[lifecycle テスト](../../../test/fn004-decision-lifecycle.test.js)・[core テスト](../../../test/fn004-decision-core.test.js)

機能設計の「再送照合は head OCC より先」は直接 `confirmDecision(command)` の mutation 処理で成立する。CLI の `confirmDecisionHead` は元 draft から完全なコマンドを作る前に head を確認し、CLI を再起動すると mutation key も新しくなる。直前の確認が保存されたか不明な場合は、まず show で head を確認する。
