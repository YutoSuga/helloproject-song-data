# FN-004 Apply Plan

[Decision Model](fn004-decision.md)から、具体的に何を追加・再利用するかを計算する正式v1設計。runtimeは未実装。[全体設計](canonical-registration.md)、[Transaction](fn004-transaction.md)、[Approval / Request / interface](song-admin.md)を参照。

## 入出力・identity

入力は`decision_id + revision + content_hash`と、その現在有効性、candidate、全canonical、successful History、ID state、planner rules。出力はimmutableなPlan。Plan生成だけではCSV・Decision・ID stateを変更しない。

rootに`schema_version: 1, plan_id, generated_at, payload, plan_hash`を持つ。`plan_hash = SHA-256(JCS(payload))`、`plan_id = ap_`＋hashの64桁hex。schema / planner / validator / serializer / prefix規則のversion/hashもpayloadに含める。generated_atは表示metadataでhash対象外。未知version / 未対応rulesはSTOP。

`staging/apply-plans/<plan_id>.json`へ排他的に保存し、同ID同payloadなら既存を利用する。異内容ならintegrity error。確認対象を上書きしない。derivedだが承認・未完了処理が参照中のPlanは削除不可。transactionは元Planの検証済みcopyを保持し、成功Historyは結果の解釈に必要な内容を保持する。

## operations・v1境界

| classification | 意味 |
| --- | --- |
| reuse | IDで指定されたexisting masterを参照する |
| insert | 許可されたmaster / relationの新規rowを追加する |
| no_op | 要求relationがPK・全列とも一致して存在する |
| conflict | PK、内容、identity前提、unique/order制約が競合する |
| unsupported | v1対象外の要求 |

各operationに安定したoperation_id、table、key、要求rowまたはrow_template、Decision内path、candidate / evidence参照、理由codeを持つ。reuseには既存rowとhash、conflictには期待値と実値を持つ。no_opを黙って除外しない。no_op / conflictsの索引はoperation_id参照とし、同じrowを二重定義しない。

v1はworks / songs / creators / artists / releases、およびsong_artists / song_creators / song_performers / release_tracksへのinsertだけ。existing master / relationのpatch・delete、identity統合・分割、work付け替え、new member、affiliation、video、candidate migrationは実行不可。既存fieldが矛盾すればconflict / unsupportedとして再レビューを要求する。

## preconditions

| 対象 | 固定する内容 |
| --- | --- |
| Decision | ID / revision / hash、有効性履歴、競合検査対象のDecision registry意味内容hash |
| Candidate | 各candidate ID、source identity、projection version、snapshot hash、現在fingerprint |
| Canonical | 全14 CSVのpath / byte length / SHA-256のmanifest |
| History | bootstrap identity、成功record集合・chainのhash、適用済み判定 |
| ID state | state hash / generation、全namespace上限、pending不存在 |
| Rules | schema・planner・validator・serializer・prefix規則のidentity |

canonicalはpath ASCII昇順の全ファイルentryをJCS化してmanifest hashを作る。各file hashは生バイト対象であり、改行・行順変更も検出する。14表欠落・未知表追加はSTOP。Git SHAだけでは未commit変更を検出できないため、補助metadataに留める。hashとparseには同じバイトsnapshotを用いる。

approval / request / journalの作成はPlan自身のstaleを引き起こしてはならないため、これらを上記manifest / registry hashに含めない。承認の有効性はApply時に独立検証する。transaction自身のID消費やHistory追加も、開始前preconditionからの期待遷移として検証する。

同revision / hashの成功HistoryがあればALREADY_APPLIED。同revision異hashはintegrity STOP。同Decisionの別revisionまたは置換元の適用済みcoverageがあればv1再適用不可。History欠落を空扱いしない。candidate不存在・fingerprint mismatchは適用可能Plan生成をSTOPし、diagnosticのみ返す。

## reuse・insert row

existing IDの型・存在・Decisionのassertionsを検査する。existing songはwork対応、version_type、same-audio根拠、artist主張等と整合すること。canonical値から不足する人間判断を補完しない。商品上のtrack_titleとsong titleの差を、直ちに同一性矛盾とはみなさない。

new entityごとにlocal ref → planned ID → 全canonical列を持つrow_templateを生成する。任意nullは空欄。new masterのcreated_at / updated_atだけ`{"system_binding":"apply_time"}`とし、transactionで一度決めた同時刻へ置換する。それ以外の値の変更は禁止。

source上のrelease種別とcanonicalの`single / album / digital / other`を分ける。未来release日・optional notes欠如は正常。同じlocal songを複数trackから参照できる。member参照はexisting P IDのみ。

## relation comparison

| 表 | PK | 追加の非空順序一意性 |
| --- | --- | --- |
| song_artists | song_id, artist_id, role | song_id＋role内credit_order |
| song_creators | song_id, creator_id, role | song_id＋role内credit_order |
| song_performers | song_id, member_id | song_id内performer_order |
| release_tracks | release_id, disc_number, track_number | PKそのもの |

型に従った整数・空欄変換後、source_url・notesも含め全列比較する。PK不存在はinsert、全列一致はno_op、同PK異内容はconflict。別PKでもorder重複はconflict。類似identityは自動統合しない。source_urlだけの差でも既存row更新はv1対象外。

Decision内部の同entity複数ref、完全重複relation、重複track位置はvalidation errorで、自動collapseしない。new entityが既存と同一に見える場合も自動existing化しない。該当候補に対する明示的distinct判断がなければblocking conflictとする。

## deterministic ID allocation

namespaceごとに`max(current IDs, persistent high-water mark) + 1`から計算し、5桁上限超過はSTOP。使用済み欠番を再利用しない。persistent stateの初期化・genesisは[Bootstrap契約](fn004-bootstrap.md)、消費は[Transaction](fn004-transaction.md)で定義する。99999は保存可能なhigh-waterだが、そのnamespaceへの追加採番は不可。

順序はwork / creator / artist / release / song、songはprefix ASCII順、各namespace内はASCII local ref昇順。配列順、title、release_date、locale sortに依存しない。Decisionで確定したsong_id_prefixの整合だけを検証し、plannerは推測しない。

planned IDは予約ではない。複数Planが同じ予定値を持つことはあるが、一つが適用されれば他はstaleになる。実行時に番号だけ差し替えない。同じ全precondition・rulesなら同じmappingとpayloadになる。

## whole-plan validation・stale

original＋全insertの仮状態で、PK / FK / enum / required / date / order / primary artist等を検証する。全Decision要求がoperationまたはblocking診断に対応することも確認する。元canonicalの完全検証はtransactionでも必須。

diagnosticは`severity, code, message, target, decision_path, evidence_refs, resolution`を持つ。identity未確定・必須evidence不足をwarningへ落とさない。future release等の正常値でwarningを増やさない。

`applicable=true`は、有効confirmed・未適用・全precondition成功・error/conflict/unsupported/必須未決なし・aggregate全件計画化を満たす場合のみ。reuse / no_opだけでも初回有効判断は適用可能。部分適用は禁止。

Decision有効性、source facts、canonical、History、ID state、rulesのいずれかが変わればstaleとして拒否し、再生成・再確認・新Approvalを要求する。candidate変更なら先にDecisionへ戻る。確認済みPlanを自動更新しない。

## 概念schema

以下は説明用の省略例。hash、rows、全14entry等は実recordで省略不可。

```json
{
  "schema_version": 1,
  "plan_id": "ap_<payload-hash>",
  "generated_at": "2026-10-16T10:00:00+09:00",
  "payload": {
    "rules": {"planner": "v1", "validator": "v1", "serializer": "v1"},
    "decision": {"decision_id": "dec_<uuid>", "revision": 3, "content_hash": "<hash>", "registry_hash": "<hash>"},
    "candidate_preconditions": [{"candidate_id": "sc_example", "profile": "candidate-source-v1", "fingerprint": "<hash>"}],
    "canonical_precondition": {"manifest_hash": "<hash>", "files": [{"path": "data/works.csv", "byte_length": 100, "sha256": "<hash>"}]},
    "history_precondition": {"head_hash": "<hash>", "count": 0},
    "id_state_precondition": {"state_hash": "<hash>", "generation": 1},
    "planned_id_mappings": [{"local_ref": "work:w1", "planned_id": "W00091"}],
    "reused_entities": [{"operation_id": "reuse:w", "table": "works", "key": {"work_id": "W00001"}, "row_hash": "<hash>"}],
    "inserted_entities": [{"operation_id": "insert:w", "table": "works", "local_ref": "work:w1", "row_template": {"work_id": "W00091", "title": "例示", "title_kana": "", "notes": "", "source_url": "https://example.invalid/", "created_at": {"system_binding": "apply_time"}, "updated_at": {"system_binding": "apply_time"}}}],
    "relation_operations": [{"operation_id": "track:conflict", "classification": "conflict", "table": "release_tracks", "key": {"release_id": "L00001", "disc_number": 1, "track_number": 1}, "reason_code": "RELATION_PK_CONTENT_CONFLICT"}],
    "no_op_operations": [],
    "conflicts": ["track:conflict"],
    "unsupported_operations": [],
    "validation_results": [{"severity": "error", "code": "RELATION_PK_CONTENT_CONFLICT", "target": "track:conflict"}],
    "applicable": false
  },
  "plan_hash": "<payload-hash>"
}
```

## 生成手順・実行契約

Decision構造/有効性 → candidate照合 → History照合 → canonical snapshot/検証 → existing解決 → new重複/prefix検査 → deterministic mapping → 全row生成 → relation分類 → whole-plan validation → applicable → payload hash → immutable保存の順。

Design 3へPlan本体、identity/hash、承認参照、全precondition、mapping、row_template、診断を渡す。Design 3は保存済みapplicableを信用せず再計算し、承認・request identityを照合する。人間が確認した値のうち変更可能なのは指定system timestamp bindingだけである。
