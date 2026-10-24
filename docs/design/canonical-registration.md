# Canonical registration 基本設計（FN-003 / FN-004、Milestone 3-B）

## 目的・境界

`data/*.csv` が唯一の正本。Milestone 3-B1 / FN-003 レビュー準備機能は実装済みで、公式sourceのcandidate、現行canonical、人間の過去判断を照合し、レビュー用派生JSONを作る。FN-003はcanonical CSV、candidate JSON、review結果を更新しない。Milestone 3-B2 / FN-004 canonical反映機能とMilestone 3-C / SCR-002 楽曲管理画面は、以下の正式v1設計を持つがruntimeは未実装。既存canonical登録済みcandidateの初期移行は対象外。

本書は全体フロー・責務と現行FN-003の入口を担う。Design 1〜4を横断統合した詳細は、[Decision Model](fn004-decision.md)、[Apply Plan](fn004-apply-plan.md)、[Transaction / Recovery](fn004-transaction.md)、[Bootstrap / ID state](fn004-bootstrap.md)、[History readonly contract](fn004-history.md)、[CLI / SCR-002・Approval / Request](song-admin.md)へ分割する。Decision / Plan / Historyのschema・hash projection・orderingは各文書の完全なversioned契約を正とする。本follow-upは実装を追加しない。

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
Decision draft → confirmed revision（人間のidentity判断）
  ↓
FN-004：immutable Apply Plan → Approval（同Plan hashを承認）
  ↓
durable Apply Request（request_id）→ Transaction
  ↓
data/*.csv（canonical）
  ↓ 全体検証・成功確定後
successful Apply History
```

図のTransactionがcanonicalを変更し、成功Historyが結果を記録する。Decision確定・Plan生成・Approval・Request受付だけではCSVを変更しない。SCR-002はreview表示、判断確認、明示的Plan生成、反映確認、結果確認を共通application service経由で行う。現行FN-003の派生JSONを取得・再生成するadapterの技術方式は実装段階で決める。

## staging の責務

```text
staging/
├── song-candidates.json   FN-002が保持する公式source事実、candidate_id、収集情報・履歴
├── song-reviews.json      FN-003が毎回再生成するレビュー用派生データ
└── review-results.json    現行FN-003のlegacy過去判断入力（正式Decisionではない）
```

`song-candidates.json` の既存status/notes/matchは従来どおり読み取り、B-1は書き換えない。現行`review-results.json` readerは入力専用。不在なら `{"schema_version":1,"results":[]}` と同じ空の結果とする。hold、confirmed、rejected、applied、notes、decision、reviewed_at、applied_result等をreviewに添付し、holdでも現行candidate/canonical照合を再計算する。これは既存FN-003の互換動作であり、FN-004の成功履歴不存在を空扱いする規則ではない。

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

正式入力は[Decision Model](fn004-decision.md)の有効confirmed revisionであり、legacy `review-results.json`ではない。FN-003 readerはversion=1、results配列、一意な非空candidate_id、status enum、任意notes/decision/reviewed_atの浅い型を検査するだけで、decision内部・applied_result・日時形式・candidate存在・指紋は保証しない。既存形式の自動version-upやapplied扱いをせず、人間による明示取込・再確認を必要とする。将来FN-003が正式Decision/Historyを表示するadapterもこの分離を維持する。

### 責務とGit管理

| データ | 責務 / 保存先 | Git |
| --- | --- | --- |
| Candidate | 公式観測facts。song-candidates.json | 管理 |
| Review | derived / rebuildableな提案。song-reviews.json | 正本にしない。現mainに出力なし |
| Decision | 人間のidentity判断。decisions.jsonのimmutable revisions | 管理 |
| Apply Plan | 具体的変更計画。apply-plans/ | derived、原則非管理 |
| Approval | 具体的Plan hashへの承認。apply-approvals/ | 管理。人間行為を追跡 |
| Apply Request | 同じ実行要求のdurable受付。apply-requests/ | 非管理。local実行/再送情報、未完了は保持 |
| Transaction Journal | 実行途中・失敗・復旧。transactions/ | 非管理。未完了は保持 |
| Apply History | 正常適用結果。apply-history/ | 管理。失敗は含めない |
| ID / repository state | high-water mark、成功head。fn004-state.json | 管理。採番・履歴整合に必須 |
| Bootstrap | [監査・genesis・completion marker](fn004-bootstrap.md)。fn004-bootstrap.json | 管理。未初期化と消失を区別 |
| lock / temp / backup | 排他・一時生成・復元根拠 | 非管理。recovery前に削除しない |

canonical以外は楽曲正本ではない。Git非管理とdurability不要を混同しない。requestが失われてもHistoryのrequest/Decision coverageから適用済みを検出し、不明ならSTOPする。上記保存先はすべてstaging/配下の将来構成で、今回JSONやdirectory、ignore規則を作成したものではない。

### v1 scope

existing work＋existing song、existing work＋new song、new work＋new song、existing/new creator・artist・release、song_artists / song_creators / song_performers / release_tracksの追加を扱う。memberはexistingのみ。公式発表済みfuture releaseを許可する。reuse/no_opだけでも承認・Request・transaction・成功Historyを通す。

existing master/relationのfield update/patch/delete、work/song統合・分割・work付け替え、canonical correction、new member、member_affiliations変更、video関連、candidate初期migration、aggregate部分適用、rollback commandによる過去成功の取消し、自動Git操作、JOB/notificationはv1対象外。data-specが一般運用として許す訂正までFN-004が実行可能とは意味しない。失敗transactionを元へ復元する内部rollbackは必要な安全機構として含む。

### 横断レビューの確定事項

| 論点 | 統合した契約 / 詳細の正本 |
| --- | --- |
| revision / OCC / prefix | Decisionへ明示保存。draftと有効confirmedを分離。[Decision](fn004-decision.md) |
| Plan hash / ID | 全preconditionとrowをhashし、予定IDは未予約。[Plan](fn004-apply-plan.md) |
| Approvalとreceipt | 承認を先に保存し、その承認を使う要求をjournal前にdurable受付。[Interface](song-admin.md) |
| 二重送信・受付中断 | 同ID同payloadは照会のみ。未完了receiptは新規受付を止める。未開始を証明できる場合だけABORTED |
| 成功境界 | COMMIT_DECIDED前は原則rollback、後はforward finalize。[Transaction](fn004-transaction.md) |
| 採番・rollback | Planで予約せず、commit開始で消費、復元後も上限不減 |
| trace | Decision → Plan → Approval → Request → Transaction → History → actual IDs |
| UI結果 | committedとreadinessを分け、pending finalizationを再Applyへ誘導しない |
| 実装順 | schema/service/CLIを先にし、recovery検証後に実Apply公開。[Interfaceのslice](song-admin.md) |

Slice 4前のSTOP項目（Decision完全schema/content hash、Plan operation/registry、History readonly proof）は各専用文書で確定する。JSON Schema実装やbackend/認証provider等の技術選定は実装sliceで行うが、本書群の不変条件を緩めない。実装PR数は固定せず、review/test可能な分割を行う。

## SCR-002 楽曲管理画面との接点（Milestone 3-C、未実装）

SCR-002は一つの正式Feature IDのまま、管理一覧・レビュー編集・Decision確認・Apply Preflight・Apply結果・System Statusを内部viewとする。[interface設計](song-admin.md)でCLIと共通application service、承認・再送・異常表示を定義する。v1のbootstrap/recovery実行はCLIのみ。browserからfilesystem/Gitへ直接書かず、認証済み管理者backendを必要とする。providerやhosting方式は別途選定する。JOB-001や通知は今回実装しない。

## 関連仕様

- [canonical CSV 仕様](../data-spec.md)
- [候補収集基本設計](candidate-collector.md)
- [マイルストーン](../roadmap.md)
- [機能ID体系](../feature-ids.md)
