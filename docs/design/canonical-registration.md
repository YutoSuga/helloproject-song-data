# Canonical registration 基本設計（FN-003 / FN-004、Milestone 3-B）

## 目的・境界

`data/*.csv` が唯一の正本。Milestone 3-B1 / FN-003 レビュー準備機能は実装済みで、公式sourceのcandidate、現行canonical、人間の過去判断を照合し、レビュー用派生JSONを作る。FN-003はcanonical CSV、candidate JSON、review結果を更新しない。Milestone 3-B2 / FN-004 canonical反映機能は次フェーズ / 未実装であり、本書では概要のみを扱う。Milestone 3-C / SCR-002 楽曲管理画面も未実装。既存canonical登録済みcandidateの初期移行はFN-003の対象外。

本文はFN-003の詳細が中心で、FN-004は確定decision schemaも未設計のため、現時点では統合設計書として維持する。

## FN-003 / FN-004の関係

```text
staging/song-candidates.json（FN-002の出力）
  + data/*.csv（canonical）
  + staging/review-results.json（過去の人間判断。不在時は空）
  ↓
FN-003 レビュー準備機能（実装済み）
  ↓
staging/song-reviews.json
  ↓
人間レビュー（将来のSCR-002 楽曲管理画面）
  ↓
decision（人間が確定した判断）
  ↓
FN-004 canonical反映機能（次フェーズ / 未実装）
  ↓
data/*.csv（canonical）
```

これはデータの関係であり、SCR-002からFN-003 / FN-004をどのタイミングで呼ぶか、または事前生成済みJSONを読むかは固定しない。Milestone 3-Cの管理画面設計時に決める。

## staging の責務

```text
staging/
├── song-candidates.json   FN-002が保持する公式source事実、candidate_id、収集情報・履歴
├── song-reviews.json      FN-003が毎回再生成するレビュー用派生データ
└── review-results.json    人間の判断結果を永続保存するデータ
```

`song-candidates.json` の既存status/notes/matchは従来どおり読み取り、B-1は書き換えない。`review-results.json` は今回入力専用。まだ存在しなければ `{"schema_version":1,"results":[]}` と同じ空の結果として扱う。存在する場合はschemaを検査し、不正なら全体STOPする。hold、confirmed、rejected、applied、notes、decision、reviewed_at、applied_result等の過去入力をreviewに添付する。holdでも現行candidateとcanonicalに対する照合は再計算する。

## FN-003 レビュー準備機能（Milestone 3-B1、実装済み）

### data flow

```text
song-candidates.json 全件読込・schema検査
  → data/*.csv 読込・整合性検査・検索index作成
  → review-results.json 読込・schema検査（不存在のみ空）
  → candidate全件をrelease順に安定sort
  → 古いcandidateから1件ずつ照合・review生成
  → 同一work候補内の順番を付与
  → song-reviews.jsonを一度だけatomic保存
```

処理は全candidate対象。artist/candidate filterは設けない。work/song title、artist/creator name、creator credit_name、workに属するsong、処理済み仮work候補をメモリにindex化し、全candidate同士の総当たり比較を避ける。CLIは `npm run prepare:reviews`。

### release順と仮work候補

`release_date` 昇順。同日のA/B/C等の1文字盤種は同じ盤種系列内で文字順に並べる。系列同士、SP・通常盤・初回盤等の安全に文字比較できない盤種との順序は、product_number、source release URL、source URL、candidate_idによる安定tie-breakで決める。これは内部処理順であり、音源の初出順やoriginalの証明ではない。product_numberの大小をoriginal判定に使わない。日付不正はcandidate単位でblockedとし、全体の末尾に置く。

canonicalのwork/song title一致候補を最優先する。exactを先に、NFKC・空白除去・小文字化したnormalized一致を参考候補として後に表示する。canonicalに候補がない場合に限り、処理済み仮work候補をtitle正規化indexから探し、なければ作る。title一致による仮workの共有は同一workの**提案**であり確定ではない。

仮IDは `pw_` と、最初のcandidate_idのSHA-256先頭24桁で作る。単純な実行順連番を使わないため、anchor candidateが同じなら再生成しても安定する。より古い同名candidateが後から加わるとanchorと仮IDが変わり得る。仮IDはcanonicalの `Wxxxxx` でも3-B2への採番指示でもない。

一意のcanonical work候補または仮work候補に属するcandidateには、work内release順、最古候補か、同workのcanonical songにより古い日付があるかを付ける。canonical songの日付未登録は「古くない」と断定できない。`original_candidate` は最古候補の表示上の目印であり、`version_type=original` の確定ではない。

### 自動resolved・候補提示・人間判断

sourceのcandidate_id、URL、title、artist_name、release_date、track_number、edition、media_type、product_number、credit raw/role等を `resolved.source` に転記する。candidate内の従来status/notes/artist_idは自動resolvedの根拠にしない。blocked候補のsourceはsnapshotに残し、`resolved.source`は空にする。一意なexact artist名だけを `resolved.artist_id`、一意なexact creator名または `credit_name` だけをcreator候補の `resolved_creator_id` にできる。曖昧なexactとnormalized一致は候補提示のみ。旧名義、related unit、temporary unitを現在のartistへ自動統合しない。performerはsource raw/namesを保持するが自動確定しない。

work/songはexact title一致でも `canonical_matches` の候補提示のみ。`resolved` にwork_id/song_idは載せない。仮work、同一workと思われるcandidate、同一songと思われるcandidateも確定ではない。

人間が最低限判断する項目：workの新規/既存、songの新規/既存、version_type（original/new_vocal/re_recording/cover/other）、同一音源、title表記揺れか別workか、related/temporary unit、artist role、performer、曖昧なcreator identity、song.release_dateに採用するrelease。レビュー候補内の最古日とcanonicalのsong release_dateは判断材料に留める。

### song-reviews.json schema version 1

```json
{
  "schema_version": 1,
  "reviews": [{
    "candidate_id": "sc_...",
    "source": {"title": "...", "release_date": "YYYY-MM-DD", "credits": {}},
    "release_order": {
      "global_position": 1, "release_date": "YYYY-MM-DD",
      "edition_tie_break": "A", "work_candidate_position": 1,
      "earliest_candidate": true, "older_canonical_song": false,
      "original_candidate": true
    },
    "canonical_matches": {
      "works": {"exact": [], "normalized": []},
      "songs": {"exact": [], "normalized": []},
      "artist": {"exact": [], "normalized": []},
      "creators": []
    },
    "provisional_work": {
      "provisional_work_id": "pw_...", "anchor_candidate_id": "sc_...",
      "title": "...", "candidate_ids": []
    },
    "same_work_candidates": [],
    "same_song_candidates": [],
    "resolved": {"candidate_id": "sc_...", "source": {}},
    "human_required": ["work_choice", "song_choice", "version_type"],
    "blocked": [], "warnings": [],
    "previous_review_result": null
  }]
}
```

`source` は候補のsource情報と従来status/notesのsnapshot。`canonical_matches.creators` はrole/name/raw、exact/normalized候補、該当時のみ`resolved_creator_id`を持つ。`provisional_work` は該当なしならnull。`same_work_candidates` と `same_song_candidates` は同じ候補group内の参考IDで、音源同一性を保証しない。`release_order` のwork関連項目は一意にgroup化できない場合null。`previous_review_result` は一致する過去結果がなければnull。review recordはcandidate 1件に1件で、CLI/test/3-Cが共通利用する。

`review-results.json` version 1の読込形式は `{"schema_version":1,"results":[]}`。各結果に一意な`candidate_id`、`status`（hold/confirmed/rejected/applied）を要求する。`notes`、`decision`、`reviewed_at`、`applied_result`等は任意。3-B1はdecisionの意味を解釈せず添付する。3-B2用の確定decision schemaは3-B2で設計する。

### STOP、blocked、保存

曖昧なwork/song/creator候補や音源identity不明は通常レビュー対象。candidate固有のtitle、release_date、source URL、artist名の不足・不正は`blocked`付きreviewとして残し、後続を継続する。

全体STOPは入力全体を信用できないときに限る。candidate JSONのschema/version破損・ID重複、canonical必須CSV欠落・parse/header/key/FK・日付整合性違反、review-results JSONの重大なschema/version破損・ID重複が該当する。全体STOPでは出力を書かない。正常処理後のみ同じディレクトリに一意の一時ファイルを排他的に書き、renameで置き換える。失敗時は一時ファイルを削除し、既存review出力を維持する。

## FN-004 canonical反映機能（Milestone 3-B2、次フェーズ / 未実装）

FN-004は人間が確定したdecisionを別途検証し、ID採番とcanonical CSVへの安全な反映を行う。途中失敗時に部分更新を残さない。FN-003のsuggestionや仮IDをそのまま正本へ反映しない。

確定decision schemaは未設計であり、`review-results.json`の現行読込形式がFN-004への確定入力仕様を意味するわけではない。着手時に、確定decisionの必須項目・検証、ID採番、canonical整合性、再適用時の扱い、複数CSVへの反映・失敗時の復旧方式を具体化する。既存のデータ仕様とFN-003の読み取り専用境界を前提とする。

## SCR-002 楽曲管理画面との接点（Milestone 3-C、未実装）

SCR-002はcandidate / review情報を表示し、人間の確定・保留・却下等の判断を受け付ける将来の画面。FN-003 / FN-004の呼出タイミング、事前生成済みJSONの読込、人間判断の保存・受け渡し方式、認証、backend/APIは3-C設計時に検討する。定期実行はJOB-001の責務であり、本書では詳細設計しない。

## 関連仕様

- [canonical CSV 仕様](../data-spec.md)
- [候補収集基本設計](candidate-collector.md)
- [マイルストーン](../roadmap.md)
- [機能ID体系](../feature-ids.md)
