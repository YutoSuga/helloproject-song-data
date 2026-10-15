# FN-004 Validation / Transaction / Recovery

正式v1設計。runtimeは未実装。[全体設計](canonical-registration.md)、[Decision](fn004-decision.md)、[Plan](fn004-apply-plan.md)、[Approval / durable Request](song-admin.md)を参照する。

## 保証範囲

Node.js 20以降、単一authoritative working tree、協調するreader / writer、同一のローカルfilesystemを対象とする。file sync・directory sync・同filesystem rename・排他的な新規file公開が機能するprofileを必須とする。未対応ならwriteをSTOPする。NFS等の共有filesystem、複数cloneの同時採番、Gitによる台帳巻戻しはv1運用対象外。状態を戻したcheckoutや分岐した台帳を認識した場合は再照合前にApplyしない。

複数CSVへ単一のOS atomic rename transactionはない。共通gateで途中状態を隔離し、未完了処理があれば通常利用を止め、original復元またはtarget完了を保証する論理的all-or-nothingとする。非協調editor・hardware故障・flushを無視するstorageまで含めた絶対保証はしない。

既存FN-003 / collectorのtemp＋renameは単一JSON保存で、fsync・複数表journal・recoveryを実装していない。`src/canonical.js`はranking用読込、`src/prepare-reviews.js`の検証も全仕様を網羅しない。本設計の安全保証を現実装済みと扱わない。

## 受付とtransactionの境界

順序は**Approval保存 → durable Apply Request受付 → transaction journal開始**。Approvalなしの実行要求を受け付けない。詳細schemaとidempotencyは[interface設計](song-admin.md)を正とする。

receipt保存は短い受付gate内で行い、transactionの実行排他とは責務を分ける。同一gateを継続保持する実装も可。新規受付前にlock・unfinished journal・未完了receipt・ID pendingを確認し、他要求があればBUSY / RECOVERY_REQUIRED。受付後gateを解放しても未完了receiptが次の新規受付を阻止するためqueueや複数claimは生じない。

同request再送は既存状態を返すだけで、新transactionをdispatchしない。初回受付者だけがreceiptに固定したtransaction_idで実行へ進む。receipt公開後にprocessが終了した場合はrecoveryで元要求を終了させる。journal不存在だけで未開始と断定せず、ID state・History・canonical・owner・残存artifactを検証する。実行/recovery内部の読込は、所有gate leaseと期待する本人request/pendingをcontextに含める。本人の期待遷移だけを認め、他要求や通常readerにpending検査の迂回optionを公開しない。

## exclusive gate・stale lock

realpathでrepository rootを確定し、`staging/.fn004.lock`を`fs.open(path, "wx")`で取得する。schema、owner token UUID、mode、PID・process開始識別子、host / boot / PID namespace、root、request / transaction / apply / Plan identity、取得時刻、journal pathを保存・syncする。EEXISTはBUSY。途中で切れたmetadataも無条件削除しない。

FN-001 / FN-003 / collector等のcanonical読込は、snapshot読込全体で同じgateを取得する。Decision・candidate等の更新も協調させる。存在確認を一度するだけではTOCTOUを防げない。readerは未完了journal / request / ID pendingがあれば通常読込を止める。既存readerの共通化はFN-004実装の前提である。独立したcommit済みcheckoutで動くPages buildは元working treeの途中状態を読まない。

通常Applyはstale lockを削除しない。PID不存在・経過時間だけで解除しない。recoveryは`staging/.fn004-recovery.lock`をexclusive取得し、元ownerが同host / boot / namespaceで確実に終了したか、owner token・journal・実hashを照合する。元lockを空けずにownerを移管し、recovery完了後だけ解除する。別host、PID再利用、recovery mutex自体の不明状態は人間確認でSTOP。自動takeoverできる証拠がなければforce optionでも進めない。

## execution・validation

1. execution gate取得、他の未完了処理不存在、本人receipt / Approvalを確認。
2. Plan schema/id/hash/rules、承認hash、Decision identity/hash/有効confirmed、candidate fingerprint、全14表manifest、History、ID state、planned ID可用性を再計算。
3. reuse row・no_op全列一致・insert不存在・conflict/unsupportedなしを確認。staleならCSVへ触らずrequestをterminal拒否とする。
4. original全14表を同じバイトsnapshotから検証し、PREPARINGを記録。
5. apply_timeを一度固定し、Plan＋originalからtarget全体をメモリ生成。全検証・target manifest計算。
6. 全14 CSV backup、changed CSV temp、Plan・Decision・Approval・Requestの検証済みcopy、intentを保存してsync。tempを再読込して検証。
7. 全preconditionを最初の置換前に再確認し、PREPARED → COMMITTINGをdurable記録。
8. ID消費・pendingを永続化してからchanged CSVを固定順で置換。
9. 全14表を実pathから再読込しwhole validation・target manifest一致を確認。
10. COMMIT_DECIDEDをdurable記録。History公開 → ID state成功head → COMPLETED → request結果参照整合 → unlock。

`apply_time`はtarget生成前のPREPARINGで固定し、全new masterのcreated_at / updated_atへ同値を入れる。recoveryで変更しない。`applied_at`はCOMMIT_DECIDEDの成功確定時刻として固定する。確定後の再試行でHistory内容を変えない。

### whole canonical validator

全14表について正確なheader / 列順・UTF-8・CSV構文・列数・必須値・PK・ID・FK・enum・実在日付・timezone付き日時・HTTPS source・正整数/非負整数・order一意性を検査する。song primary、期間start/end、member affiliationの同一member/artist期間重複、videoのYouTube ID/URL一意・区間複合FKも対象。CSVの引用規則はデータ仕様に従い、既存parserの寛容な受理だけでvalidとみなさない。

original、メモリtarget、temp再読込、commit後で検証する。既存rowの値・timestamp不変、削除なし、許可tableへのinsertだけかも検証する。original判定例外・音源同一性等は人間根拠を検査し、推測で再判断しない。意味的制約の検査をwarningだけに落とさない。

## directory・durability

```text
staging/transactions/<transaction_id>/
├── transaction.json          最新journal recordの参照cache
├── journal/000001.json       sequence/hash連鎖の状態snapshot
├── intent.json              不変の実行前提・original/target・各identity
├── plan.json
├── decision-snapshot.json
├── approval.json
├── request.json              immutable receipt部分のcopy
├── backup/data/              全14 CSVのcopy snapshot
├── backup/fn004-state.json
├── temp/data/                changed CSVだけ
├── temp/apply-history.json
└── restore/                  backupを消費しない復元temp
```

transaction_idは`tx_<UUID v4>`、apply_idは同UUIDの`apply_`形式で1対1。receipt受付時に固定する。recoveryは同identity、新しい要求は新identity。

temp / backupはexclusive createし、書込 → file sync → close → 再読込/hash検査 → directory sync。予期しないexisting temp、別filesystem、欠落canonicalはSTOP。backupはhardlinkやrename退避でなく全14表のcopyで、元snapshotとのbyte hash一致を要求する。Gitだけを復元手段にしない。

journalはmutable recovery stateを追記型immutable recordsで表現する。各recordにsequence / previous_record_hash / record_hash、state、request/approval/Plan/Decision identity、original/target manifest、affected paths、temp/backup hash、per-file progress、ID state前後、History予定、時刻、error/recoveryを持つ。新recordをtempで完成・sync後にno-clobber公開しdirectory syncしてから次の副作用へ進む。latest cacheはtemp＋renameで更新する。

journal内容を読めない、未知version、hash連鎖破損はSTOP。latest cacheだけ失われ、全recordsとintentが検証可能なら参照を再構築できる。不正recordを無視して古いstateへ戻さない。progressはrenameより遅れるため、復旧の事実判定には実file hashを使う。

## state machine・commit

```text
PREPARING → PREPARED → COMMITTING → COMMIT_DECIDED → HISTORY_COMMITTED → COMPLETED
    |          |           |
    +----------+           +→ ROLLING_BACK → ROLLED_BACK
         ↓                              |
      ABORTED                           ↓
                                 RECOVERY_REQUIRED
```

| state | canonical | History |
| --- | --- | --- |
| PREPARING / PREPARED | original | なし |
| COMMITTING | original / 混在 / 全targetの可能性 | なし |
| COMMIT_DECIDED | 全target・検証済み | 未公開の場合あり |
| HISTORY_COMMITTED | 全target | 完全record |
| COMPLETED | 全target、state整合 | 完全record |
| ROLLING_BACK | original / target混在可能 | なし |
| ROLLED_BACK / ABORTED | original | なし |
| RECOVERY_REQUIRED | 実hashで判定 | 実在を検査 |

manifest / backupは全14表、commitはchanged filesだけ。順序はworks → creators → artists → releases → songs → song_artists → song_creators → song_performers → release_tracks。各rename前に期待hashを確認し、rename後にdestination directory sync・hash確認・progress追記を行う。順序だけでatomicとはみなさない。

COMMIT_DECIDEDはdurableな不可逆の成功方針であり、その後のHistory / state / journal失敗ではrollbackせず元transactionをfinalizeする。保存済みPlanの値を変更しない。外部の未知変更を検出したらforwardで上書きすることもせずSTOPする。

## rollback・recovery matrix

COMMIT_DECIDED前の部分commit・検証失敗は原則rollback。先にROLLING_BACKをdurable記録し、backup hashを検証、targetになったfileだけを逆順でrestore tempからrenameする。backupは保持し、originalになったfileは触らない。全14表whole validation＋original manifest完全一致後にROLLED_BACK。ID stateのpendingを解消するが消費上限は下げない。復元途中失敗はlock/artifactsを保持してRECOVERY_REQUIRED。

| crash / failure地点 | 判定・復旧 |
| --- | --- |
| Approval後・receipt前 | 実行未受付。承認だけでは自動dispatchしない。明示submit時に再検証 |
| receipt後・journal前 | 他要求を停止。owner終了、canonical/History/ID state・artifactsを照合し未開始を証明できればABORTED。判断不能ならSTOP |
| lock直後・journal初回前 | Planのoriginal前提と全stateを照合。根拠不足なら人間確認 |
| PREPARING / backup途中 / temp途中 | original一致・副作用なしを確認しABORTED |
| PREPARED | originalを確認してABORTED。自動でcommitを再開しない |
| COMMITTING、rename 0件 | original確認後ROLLED_BACK。消費IDは保持 |
| 一部commit、残りoriginal | backup一致・unknown hashなしならrollback |
| 全target、COMMIT_DECIDED前 | ROLLING_BACK方針がなく、保存した承認/入力根拠と実targetを再検証できれば成功確定してfinalize。不成立なら安全なrollback、unknownはSTOP |
| post-commit validation後・成功方針record前 | durable成功方針はまだない。直上と同じ再検証が必要 |
| COMMIT_DECIDED後・History前/書込途中 | 同recordを排他的公開してforward finalize |
| Historyあり・state/journal未完了 | History一致・target確認後、state成功headとjournalを完了 |
| COMPLETED後・lock削除前 | terminal整合とownerを確認してcleanup/unlock |
| ROLLING_BACK記録済み | targetが全件でもrollback方針を維持 |
| unknown hash / 欠落backup / 壊れたintent | 自動修復せず人間確認 |

自動recoveryはowner停止・recovery排他・信頼できる根拠がある場合だけ。no-opではoriginal==targetなのでbytesだけでなくstate/成功方針を使う。recoveryで現在のcanonicalへ合わせてPlanやapply_timeを再生成しない。

| filesystem error | 方針 |
| --- | --- |
| lock作成失敗 | EEXISTはBUSY、その他はwrite前STOP |
| receipt / 初回journal失敗 | canonical変更禁止。partial recordを無条件削除しない |
| backup / temp / temp validation失敗 | original確認してABORTED |
| ID消費state保存失敗 | canonical renameを開始しない。recoveryで消費有無確認 |
| canonical rename / sync失敗 | 実hash確認し成功確定前はrollbackへ |
| rollback rename失敗 | RECOVERY_REQUIRED、backup/lock保持 |
| commit後validation失敗 | 成功方針を記録せず、安全なrollbackまたはSTOP |
| History / 成功head保存失敗 | COMMIT_DECIDED以降はforward finalize |
| journal更新失敗 | 新副作用を止めlock保持。書けないRECOVERY_REQUIREDは戻り値でも通知 |
| journal finalization失敗 | 成功Historyを消さずfinalize待ち |
| lock削除失敗 | committedを取消さずcleanup_required |

permission denied、disk full、file locked、fsync失敗も同じ段階規則。通常process crash耐性を必須とし、sync未対応を黙って弱い保証へ切り替えない。

## successful Apply History

`staging/apply-history/<apply_id>.json`をGit管理する。1成功＝1 immutable JSON。JSONLの部分末尾や単一JSONの過去全体置換を避ける。完成済みtempをsync後、hard linkによる新規公開等のno-clobber方式で公開しdirectory sync。同ID同hashはrecoveryの公開済み、異hashはintegrity STOP。

必須fieldは次のとおり。

| 分類 | 内容 |
| --- | --- |
| schema / chain | schema_version、repository_instance_id、sequence、previous_history_hash、record_hash |
| trace | decision_id / revision / content_hash、Plan ID/hash、Approval ID/hash、request_id / payload_hash、transaction_id、apply_id |
| result | candidate coverage/fingerprint、local ref→actual ID、insert/reuse/no_opのoperation ID・key・row/hash |
| snapshots | before/afterの全14表manifest、ID消費state hash・上限遷移 |
| time / rules | apply_time、applied_at、planner/validator/transaction/serializer version |

HistoryはID stateの最終hashへ循環参照せず、消費済みstateと上限遷移を記録する。最終ID stateがHistory hashを参照する。失敗・ABORTED・ROLLED_BACKは成功Historyに入れない。CSV変更0件でも承認・receipt・journal・Historyを通し、before/after manifestは同一。二回目はALREADY_APPLIED。

成功recordのtrace部分の概念例（manifest/result全内容は上表の必須契約に従う）：

```json
{
  "schema_version": 1,
  "repository_instance_id": "repo_<uuid>",
  "sequence": 1,
  "previous_history_hash": "<genesis-hash>",
  "record_hash": "<hash>",
  "apply_id": "apply_<uuid>", "transaction_id": "tx_<same-uuid>",
  "request_id": "<uuid>", "request_payload_hash": "<hash>",
  "approval_id": "apr_<uuid>", "approval_hash": "<hash>",
  "decision": {"decision_id": "dec_<uuid>", "revision": 3, "content_hash": "<hash>"},
  "plan": {"plan_id": "ap_<hash>", "plan_hash": "<hash>"},
  "candidate_coverage": [{"candidate_id": "sc_example", "fingerprint": "<hash>"}],
  "id_mappings": [{"local_ref": "work:w1", "canonical_id": "W00091"}],
  "apply_time": "2026-10-16T10:00:01+09:00",
  "applied_at": "2026-10-16T10:00:02+09:00"
}
```

## ID state・bootstrap

`staging/fn004-state.json`をGit管理する。schema_version、repository_instance_id、bootstrap_hash、initialized_at、generation、baseline manifest、namespace別high_water_marks、append-only allocation_events、History count/head hash/last apply、pending_transaction、state_hashを持つ。

namespaceはwork:W / creator:C / artist:G / release:L / member:P / video:Vとsong:M/A/J/T/B/O/R/Hを分ける。v1でmember/videoへ採番はしないが初期使用済み上限は記録する。5桁枯渇はSTOP。

Planは上限を読むだけ。COMMITTINGをdurable記録後、最初のCSV置換前にplanned IDsのrangeとtransactionをallocation eventとして消費し、high-water mark・generation・pendingを保存する。保存失敗ならCSVに触れない。rollbackでもこの消費を残す。正式entity登録は成功時、再利用禁止の技術的消費はそれより前であり区別する。rollbackで古いstate backup全体を戻してはならない。

History公開後に成功head/countを更新してpendingを解除する。no-opでも成功headは進む。state更新はtemp/sync/rename/directory sync。同transactionの消費は再度増やさず、保存内容から照合する。

初回はCLI明示bootstrap。whole validation → baseline固定 → current IDs＋取得済み完全Git履歴＋既知の外部使用済みID上限を監査 → repository UUID / History genesis → 初期state・空History directory → immutable `staging/fn004-bootstrap.json`公開の順。bootstrap自身も排他・journal・sync対象で、markerを最後に公開する。shallow履歴・消失履歴等を未使用の証拠にせず、監査範囲とoperator確認を記録し、上限を確定できなければ初期化STOP。

ID stateの概念例（上限は説明用、実初期値はbootstrap監査で決める）：

```json
{
  "schema_version": 1,
  "repository_instance_id": "repo_<uuid>",
  "bootstrap_hash": "<hash>",
  "initialized_at": "2026-10-16T09:00:00+09:00",
  "generation": 2,
  "baseline_manifest_hash": "<hash>",
  "high_water_marks": {"work:W": 91, "creator:C": 86, "artist:G": 3, "release:L": 136, "member:P": 17, "video:V": 0, "song:M": 0, "song:A": 0, "song:J": 120, "song:T": 0, "song:B": 0, "song:O": 0, "song:R": 0, "song:H": 1},
  "allocation_events": [{"transaction_id": "tx_<uuid>", "namespace": "work:W", "first": 91, "last": 91}],
  "history": {"count": 0, "head_hash": "<genesis-hash>", "last_apply_id": null},
  "pending_transaction": "tx_<uuid>",
  "state_hash": "<hash>"
}
```

marker/state/genesis/count=0/空History/pendingなしの一致が正常初期状態。不存在だけで空Historyとしない。導入済みのstate/marker欠落やchain欠落はSTOP。bootstrap途中はINITIALIZATION_INCOMPLETEとして復旧し、上書き初期化しない。

## 成功・cleanup・Git

成功はtarget全14表一致・whole validation・ID state整合・成功History一致・COMPLETED journalが揃った時点。requestのresult参照を同結果へ結び付ける。lock削除失敗は成功を取消さず、readiness=cleanup_required。COMMIT_DECIDED後未完了はcommitted_pending_finalization、再Applyは禁止。

未完了journal / receipt / backupはGCしない。terminal確認後だけtempを削除し、journal/backupは保管policyで後日削除可能。cleanup失敗で成功Historyを消さない。復旧に必要なPlanやreceiptは依存がある限り保持する。

Git commit / push / PR、site buildはtransaction外。Git失敗でcanonicalをrollbackしない。Apply後に人間がcanonical・Decision・Approval・History・stateのdiffを確認して通常のGitフローへ進む。直接編集との競合は直前/直後hashで検出するが、非協調writerとのcheck/rename間raceは防げないため、transaction中の直接編集・checkoutは禁止する。
