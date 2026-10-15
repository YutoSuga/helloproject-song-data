# FN-004 Decision Model

本書はFN-004 canonical反映機能の正式なv1設計であり、runtimeは未実装である。[全体設計](canonical-registration.md)、[Apply Plan](fn004-apply-plan.md)、[Transaction / Recovery](fn004-transaction.md)、[CLI / SCR-002](song-admin.md)と併せて読む。canonicalの列・意味は[データ仕様](../data-spec.md)を正とする。

## 責務・保存

Decisionは人間の判断を保存するpersistent dataで、canonicalではない。`staging/decisions.json`をGit管理する。candidateは観測事実、reviewは再生成可能な支援情報であり、candidateのstatusやFN-003のsuggestionを正式判断へ昇格させない。確定だけでCSVを書き換えない。

保存rootは`schema_version: 1`と`revisions`配列。各revisionは全内容を持つimmutable snapshotとし、差分だけを保存しない。未知schema version・未知判断fieldはSTOP。意味・必須性・enum・fingerprint projectionを変更するときはversionを上げ、明示的migrationを行う。不足する人間判断を自動補完しない。

## identity・aggregate・revision

- `decision_id`は`dec_`＋UUID v4。candidate ID、title、canonical IDから生成しない。
- revisionは1からの正整数。`(decision_id, revision)`を一意にする。
- 複数candidateの判断を1 aggregateにまとめられる。同じnew work / song / creator / artist / releaseはaggregate内で一度定義する。
- candidate集合をscopeとする。同じ集合・同じ判断範囲の修正は新revision。candidate追加・削除、aggregate分割・統合は新Decisionとし、`replaces`に旧Decision identityを記録する。
- `created_at`、`confirmed_at`、`actor`、`human_note`、`supersedes_revision`、必要なら`derived_from_revision`を保存する。日時はtimezone付きISO 8601。confirmedでは確認日時・判断者を必須とする。
- draftは明示保存ごとに追記。confirmも新confirmed revisionを追記し、確認対象draftのidentity/hashを記録する。過去recordを更新・削除しない。

| 保存status | 意味 | Plan対象 |
| --- | --- | --- |
| draft | 未確定・保留。必須判断不足を許容 | 不可 |
| confirmed | 人間が判断を確定 | 現在有効なものだけ |
| cancelled | 判断の撤回・除外。理由必須 | 不可 |

`superseded`は後続confirmed / cancelledから導出する。draft追加だけでは旧confirmedを無効化しない。現在有効な判断は最新revision番号だけで決めず、confirmed / cancelledの履歴と`replaces`を評価する。置換確定時は元identityが期待した有効revisionのままかを同じgate下で検査し、元を適用不可にする。置換先取消しで元を自動復活させない。重複するcandidateに競合する有効判断があればSTOP。

適用済みかは成功Historyから導出し、Decision statusに`applied`を追加しない。適用済みDecisionの訂正は同IDの新revisionとして記録できるが、v1は同IDの別revisionを自動再適用しない。新Decisionへ複製して二重適用することもcandidate coverage / replaces照合で拒否する。canonical correctionは別機能とする。

## optimistic concurrency

`saveDecisionDraft` / `confirmDecision` / `cancelDecision`は`decision_id, base_revision, base_content_hash`を要求する。新規作成はbaseをnullとして不存在を検査する。content hashはschemaで定義したrevision内容をRFC 8785（JCS）でcanonical JSON化したSHA-256。自己のhash fieldは計算対象外とする。

application serviceは共通gate下でheadとbaseを比較し、revisionを採番して追記する。古いtabやCLI入力は`DECISION_HEAD_CONFLICT`として拒否し、自動mergeしない。確認画面のdraft hash・source tokenも照合する。request keyを持つ同一confirm再送は既存結果を返し、別のconfirmed revisionを増やさない。

未保存bufferは破棄できるが保存済みdraftは履歴に残る。draft-only Decisionはcancel可能。既存confirmedの編集中止は、そのconfirmedの取消しとは分ける。新Decisionへの複製はdraftから始め、承認・成功状態はコピーしない。

## candidate binding・自己完結性

candidateごとに以下を保存する。

1. `candidate_id`。
2. source identity：`source_artist_slug, source_release_url, media_type, edition, product_number, disc_index, track_number`。
3. source facts snapshot：identityに加え`title, release_title, release_date, release_type, artist_name, source_url, credits`。creditsはrawとnamesの全値・順序を保持する。
4. `fingerprint: {profile: "candidate-source-v1", algorithm: "sha256", value}`。
5. 人間が選んだwork / songとrelease_track、音源判断、evidence参照。

projectionは上記field集合に固定し、欠落はnullに統一してJCS化する。文字列はsourceどおりで、NFKC変換やURLの意味的同一視をしない。credit配列順は保持する。`artist_id / artist_slug`の照合値、`match`、`related_candidates`、status、管理者notes、収集日時はhashに含めない。source facts内に未知fieldを導入するならprojection versionを改定する。

snapshotからfingerprintを再計算し、現candidateの同projectionとも照合する。candidate不存在・source identity変更・fingerprint mismatchはSTOPし、人間が再レビューして新revisionを作る。IDだけ同じでも安全とはみなさない。last_seen_atだけの更新ではstaleにしない。

confirmedはFN-003の`resolved`、suggestion、`pw_xxx`を入力にせずPlanを作れる内容を持つ。source factsは上記projectionだけを保存し、HTML全文やcollector管理fieldの完全コピーは要求しない。

## entity reference

参照は`{"existing_id":"W00001"}`または`{"local_ref":"work:w1"}`の排他的union。型を合わせる。

| 新規entity | local ref例 | Decisionに持つ内容（canonical列名準拠） |
| --- | --- | --- |
| work | work:w1 | title、任意title_kana / notes、source_url |
| song | song:s1 | work参照、title、version_name、version_type、release_date、notes、source_url、song_id_prefix |
| creator | creator:c1 | name、name_kana、notes、source_url、identity根拠 |
| artist | artist:a1 | name、type、start_date、end_date、notes、source_url、独立主体の根拠 |
| release | release:r1 | title、release_type、release_date、catalog_number、notes、source_url、盤のidentity根拠 |

local refはDecision namespace内で一意、ASCII小文字identifierを用い、同じentityではrevision間で維持する。廃止refを別entityへ再利用しない。v1は別Decisionの未採番local entityを参照しない。共有が必要なら同aggregateへまとめ、apply済みならHistoryで確定IDを確認した新判断からexisting参照する。`pw_xxx`は正式referenceとして禁止。

new masterのcanonical ID・created_at・updated_atはDecisionでは確定しない。任意canonical値の未確認はnullで表し、PlanでCSV空欄へ変換する。必須判断を推測で埋めない。

existing参照はIDと人間のidentity assertionsを持ち、必要なwork対応・version_type等を明示する。candidateの表記がcanonical titleと違うことと、既存rowを書き換える要求を区別する。v1のexisting masterはreference-onlyで、任意field patchも禁止する。

## song・relation判断

- existing work＋existing song、existing work＋new song、new work＋new songを表現する。
- candidateごとにsame_audioによる既存/同local song再利用か、distinct_recordingによるnew songかを明示する。新規作品・音源として初めて登録する場合も、その判断と根拠を持つ。
- version_typeは`original / new_vocal / re_recording / cover / other`。登録順・最古candidateから自動確定しない。
- new songの`song_id_prefix`は`M / A / J / T / B / O / R / H`のいずれかを人間が確定する。primary artist、source slug、最小G IDからplannerが推測しない。カバーはカバー側、特殊unit等はデータ仕様に従う。複数primary等で系列を判断できなければconfirmed不可。
- song.release_dateは確認できたfull audio初出日。release日を自動コピーしない。

| relation | 判断に必要なfield |
| --- | --- |
| song_artists | song、artist、role（primary / featured）、credit_order、source_url |
| song_creators | song、creator、role、credit_name、credit_order、source_url |
| song_performers | song、existing member_id、performer_order、notes、source_url |
| release_tracks | release、disc_number、track_number、song、track_title、notes、source_url |

creator roleは`lyrics / english_lyrics / composition / arrangement / brass_arrangement`を維持する。creator代表名とcredit_nameは別。共同担当の境界をraw区切り文字から推測しない。new artistはv1対象だが、参加文字列を機械的に複合artistへ変換しない。各songにprimaryを1件以上、根拠付き複数primaryも許可する。

memberはexisting P IDのみ。new memberやmember_affiliations操作を要求する判断はconfirmed不可。performer未調査は明示できるが、その場合は行を生成しない。所属履歴から推定しない。

releaseのURL・title・catalog_numberは単独の一意identityではない。品番またはsong対象収録内容が違う盤は原則別release。edition / mediaの根拠はDecisionに保存し、現CSVで必要な盤説明はnotesに明示する。collectorのdisc_indexを機械的にdisc_numberへ変換しない。公式発表のevidenceがあれば未来release_dateも正常に許可する。

## evidence・validation

evidenceはID、kind、URL、publisher、official_basis、checked_at、引用または対象facts、candidate / snapshot参照、human_noteを持つ。`official_source`と`human_observation`を区別し、各identity判断・rowがどの根拠に依存するかを保存する。各canonical source_urlは当該rowの公式根拠を明示する。Decisionの補足をCSV notesへ無条件コピーしない。

draftは構造検査を通すが必須判断不足を許す。confirmedには全candidate対応、entity必須値、prefix、型付き参照、evidence、日時・actorを要求する。duplicate revision / candidate / local ref / relation、未解決ref、未知enum、new member、unsupported操作を拒否する。existing ID存在とsource fingerprintはconfirm時にもPlan/Apply時にも検証する。

同名new entityの既存候補があれば、明示的なdistinct判断と対象ID・根拠を必要とする。新しい候補が後で増えた場合は自動reuseせず再レビューする。canonical全体とtransactionの検証は[Transaction設計](fn004-transaction.md)の責務。

## 概念例

以下はpayloadの一部であり、実ファイルや適用可能な完全recordではない。

```json
{
  "decision_id": "dec_<uuid>",
  "revision": 3,
  "status": "confirmed",
  "entities": {
    "works": [{"local_ref": "work:w1", "title": "例示作品", "source_url": "https://example.invalid/release/1/"}],
    "songs": [
      {"local_ref": "song:s1", "work": {"existing_id": "W00001"}, "title": "例示別録音", "version_type": "re_recording", "song_id_prefix": "J", "release_date": null},
      {"local_ref": "song:s2", "work": {"local_ref": "work:w1"}, "title": "例示作品", "version_type": "original", "song_id_prefix": "H", "release_date": null}
    ],
    "creators": [{"local_ref": "creator:c1", "name": "例示作家"}],
    "artists": [{"local_ref": "artist:a1", "name": "例示unit", "type": "special_unit"}],
    "releases": [{"local_ref": "release:r1", "title": "例示release", "release_type": "single", "release_date": "2027-01-01"}]
  },
  "candidate_bindings": [
    {"candidate_id": "sc_example", "work": {"existing_id": "W00001"}, "song": {"existing_id": "J00001"}, "audio_identity": "same_audio", "accepted_version_type": "original", "release_track_ref": "track:t1"}
  ],
  "relations": {
    "song_performers": [{"song": {"local_ref": "song:s2"}, "member_id": "P00001", "source_url": "https://example.invalid/release/1/"}],
    "release_tracks": [{"local_ref": "track:t1", "release": {"local_ref": "release:r1"}, "disc_number": 1, "track_number": 1, "song": {"existing_id": "J00001"}, "track_title": "例示既存曲"}]
  }
}
```

完全recordではsnapshot / fingerprint、各必須source・evidence、new songのprimary artist等を省略してはならない。実採番ID・apply日時・反映結果はDecisionへ書き戻さずHistoryへ保存する。
