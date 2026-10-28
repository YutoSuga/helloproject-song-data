# FN-004 Validation / Transaction / Recovery

正式v1設計。Slice 1〜3の読込/排他/bootstrap基盤は実装済み、実Apply/Transaction/Recoveryは未実装。[全体設計](canonical-registration.md)、[Decision](fn004-decision.md)、[Plan](fn004-apply-plan.md)、[Approval / durable Request](song-admin.md)を参照する。

## 保証範囲

Node.js 20以降、単一authoritative working tree、協調するreader / writer、同一のローカルfilesystemを対象とする。file sync・directory sync・同filesystem rename・排他的な新規file公開が機能するprofileを必須とする。未対応ならwriteをSTOPする。NFS等の共有filesystem、複数cloneの同時採番、Gitによる台帳巻戻しはv1運用対象外。状態を戻したcheckoutや分岐した台帳を認識した場合は再照合前にApplyしない。

複数CSVへ単一のOS atomic rename transactionはない。共通gateで途中状態を隔離し、未完了処理があれば通常利用を止め、original復元またはtarget完了を保証する論理的all-or-nothingとする。非協調editor・hardware故障・flushを無視するstorageまで含めた絶対保証はしない。

既存FN-003 / collectorのtemp＋renameは単一JSON保存で、fsync・複数表journal・recoveryを実装していない。`src/canonical.js`はranking用読込、`src/prepare-reviews.js`の検証も全仕様を網羅しない。本設計の安全保証を現実装済みと扱わない。

## 受付とtransactionの境界

順序は**Approval保存 → durable Apply Request受付 → transaction journal開始**。Approvalなしの実行要求を受け付けない。完全schema・approval_hash/request_payload_hash/receipt_hash projectionは[Hash Contract](fn004-approval-request.md)、受付とidempotency lifecycleは[interface設計](song-admin.md)を正とする。receipt hashは外側schema_versionとreceiptのwrapperを対象とし、processing cacheを含めない。元receiptのrequested_at/transaction_id/apply_idは同request retryで再生成しない。

receipt保存は短い受付gate内で行い、transactionの実行排他とは責務を分ける。同一gateを継続保持する実装も可。新規受付前にlock・unfinished journal・未完了receipt・ID pendingを確認し、他要求があればBUSY / RECOVERY_REQUIRED。受付後gateを解放しても未完了receiptが次の新規受付を阻止するためqueueや複数claimは生じない。

同request再送は既存状態を返すだけで、新transactionをdispatchしない。初回受付者だけがreceiptに固定したtransaction_idで実行へ進む。receipt公開後にprocessが終了した場合はrecoveryで元要求を終了させる。journal不存在だけで未開始と断定せず、ID state・History・canonical・owner・残存artifactを検証する。実行/recovery内部の読込は、所有gate leaseと期待する本人request/pendingをcontextに含める。本人の期待遷移だけを認め、他要求や通常readerにpending検査の迂回optionを公開しない。

Approvalの現在の新規利用可否と、受付時のexact bindingは[Approval Invalidation Contract v1](fn004-approval-request.md#approval-invalidation-contract-v1)で区別する。受付後eventは元Receiptへのaccepted_request参照で検証し、それだけで既存Requestのexecution/Recoveryを取消し・拒否・rollbackしない。受付前event（accepted_request=null）と同Approvalのreceipt共存はINTEGRITY_CONFLICT。これはexecution再検証における承認の解釈であり、COMMIT_DECIDED、journal、History成功、high-waterの規則を変更しない。

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

### Slice 1 runtime API（読み取り基盤のみ）

- [`canonical-schema.js`](../../src/canonical-schema.js) の `CANONICAL_TABLES` / `CANONICAL_SCHEMA` が14表の列順、必須性、型、PK/FK、enum、order/期間等のruntime契約。`CANONICAL_SCHEMA_VERSION = 1`。FN-003もこのmetadataを参照するが、既存の部分検証・reader APIは維持する。
- [`canonical-validator.js`](../../src/canonical-validator.js) の `validateCanonicalTables(tables)` は全14表のrow配列を受けるpure function。rowは全列をCSV文字列で保持し、未確認の任意値は空文字。整数は全fieldを検査し、比較keyを任意精度で正規化する。`ok, diagnostics`を返し、processを終了せず入力を変更しない。header検査はsnapshot読込側が担う。
- [`canonical-snapshot.js`](../../src/canonical-snapshot.js) の `readCanonicalSnapshot(root)` はrepository rootから各fileを一度読み、同じBufferを厳密UTF-8 decode・共通CSV parserのstrict mode・hashに使う。戻り値は `{rawBytes, tables, manifest, validation: {ok, diagnostics}}`。rawBytesはPOSIX pathをkeyとするBuffer、tablesはtable名をkeyとするrow配列。返却値はcallerが読み取り専用として扱う。
- manifestは `{schema_version: 1, files, manifest_hash}`。filesの各entryは `{path, byte_length, sha256}`、path ASCII昇順。hashは[Plan設計](fn004-apply-plan.md)どおり **SHA-256(JCS(files))** であり、schema_versionやmanifest_hashをhash対象へ追加しない。個別hashはCSVの生bytes、hexは小文字64桁。共通の [`canonical-hash.js`](../../src/canonical-hash.js) がRFC 8785のJSON canonicalizationとSHA-256を提供する。
- file欠落・読込不能・未知CSVでは完全manifestを返さずnull。CSV内容がinvalidでも読めたbytesのmanifestは取得できるが、`validation.ok=false`なら利用可能canonicalとはみなさない。診断はerror severity、安定code、file/table、該当時record番号/column/key、messageを持つ。row番号はheaderを1とする論理CSV record番号（引用内改行は同record）。未来releaseやoptional notes欠如は正常。
- Slice 1にはgateがない。複数fileの読込中に外部変更されない保証はなく、**後続sliceが共通gate下で呼ぶ必要がある**。hash用とparse用の再読込は行わない。CSV書込、diff、既存値変更禁止の比較、serializer、transaction/recovery、ID採番、CLIは未実装。

### serializer rule v1

Planがbindingするserializer=1は、変更するCSVをUTF-8/BOMなし、canonical schemaのheader/列順、record区切りLF、最終LFありで出力する。カンマ・CR・LF・二重引用符を含むfieldだけを二重引用符で囲み、内部引用符を二重化する。field内の文字/改行は無変換。既存rowは元の順序・全field値を維持し、新insertをtyped PK順で末尾へ追加する。非変更fileはbytesごと不変、変更fileの既存fieldのquote表現だけが再serializationで変わり得る。raw manifestはそれも含めtargetとして検証する。Plan生成でCSVを書かず、system apply_timeの実値とtarget bytesは実Transactionだけが決める。

## directory・durability

### Slice 2 runtime API（repository / persistence / gate）

- [`fn004-gate.js`](../../src/fn004-gate.js) の `acquireGate` / `releaseGate` / `withCanonicalGate` がread/write共通のexclusive leaseを扱う。rootはrealpath、lockは`staging/.fn004.lock`の`open("wx")`。schema_version=1、lock_id UUID、PID、operation/mode、開始時刻、caller、host、platform、process identityをfile sync・directory syncして保持する。Linuxではboot ID・PID namespace・process start ticksも記録し、取得不能なOS情報はnull。repository UUIDは発行しない。
- releaseはprocess内WeakMapに登録されたlive token、fileのdev/ino、metadataの全bytesを照合する。serialized/copied tokenは無効。callback例外でもreleaseするが、ownership不明ならunlinkしない。release/sync失敗は`GATE_RELEASE_FAILED`等とcleanup_requiredを返し、本体例外があればoperation_errorに保持する。crash後lock、古いPID/時刻、空・破損・未知version・読込不能lockを削除しない。force unlock / recovery APIはない。
- gateはnon-reentrant。`withCanonicalGate({root, operation, fn: async (gate) => ...})`内から内側APIへ同じ`gate`を明示する。暗黙のnested取得は`GATE_NESTED`、競合する取得は`GATE_BUSY`、破損は`GATE_CORRUPT`。leaseはrootとprocess内の実体にbindingし、release開始で再利用不可。callback完了前に作業をすべてawaitし、別作業とleaseを共有したままreleaseしない。
- [`fn004-repository.js`](../../src/fn004-repository.js) の `createFn004Repository(root)` / `readValidatedCanonicalSnapshot(root, {gate}?)` は同gate下でSlice 1のsnapshotを読み、validation失敗を`CANONICAL_INVALID`＋元diagnosticsとしてthrowする。snapshotはreadonlyの一時点のcopyで、release後も現在値との一致は保証しない。後続writeは再取得・manifest再検証が必要。
- `withCanonicalRead`はFN-001 / FN-003 / collectorにも適用するが、既存readerの返却形・部分検証は維持する。collectorのネットワーク取得・candidate保存やranking生成処理全体をgate内へ入れない。testsは実canonicalを一時directoryへcopyし、production stagingにlockを作らない。
- Slice 2時点のpresence guardは、Slice 3で[bootstrap runtime](fn004-bootstrap.md#slice-3-runtime-api)のtyped genesis/state検証へ置き換える。正常bootstrapは通常readerでも受理するが、未知request/transaction、非初期stateの未証明chain/pending、不完全bootstrap、cleanup未完了を普通のcanonical readで無視しない。実Apply journal/requestのschema・recovery実行は後続sliceの責務。
- [`persistence.js`](../../src/persistence.js) の `createPersistence(root)` はroot内POSIX pathだけを扱う低水準primitive。readJsonはobject rootのみで、missing / I/O / UTF-8 / JSON構文 / root型を別codeで区別し、domain schema/versionは判定しない。writeJsonAtomicは同directoryのUUID付きtempをwx作成→write→file sync→close→再読込一致確認→rename→directory sync。createJsonExclusiveは完成tempをhard linkでno-clobber公開→directory sync→自己temp unlink→directory syncする。
- 永続化失敗はphase・published・tempを伝え、公開後のdirectory sync/cleanup失敗も成功扱いしない。rename前の失敗で元fileを触らず、失敗tempは無差別削除しない。directory新設時はparentをsyncする。primitive自体はgateを取らず、repositoryのwrite/createはlive leaseを要求する。repositoryのJSON pathは正式staging artifactに限定し、canonical write APIを持たない。artifactごとのschema・immutable/mutable policyは後続domain layerが担う。
- traversal、絶対path、Windows drive/backslash、symlink ancestor/final pathを拒否する。Node標準APIによるpath検査とunlinkは非協調processの置換との競合を完全には防げない。local・同filesystem・協調operation前提を維持し、NFS/SMB/cloud同期filesystemへ保証を拡張しない。Linux/Node 20 CIで検証し、Windows等でdirectory sync/hard link/renameが成立しなければ明示失敗とし、弱いdurabilityへfallbackしない。
- Git管理方針は[全体設計](canonical-registration.md)を維持する。今回ignoreするのは導入したgateと`.fn004-*.tmp-*`のみ。Decision/Approval/History/bootstrap/stateをignoreしない。Plan/Request/journal/backupのignore追加は各runtime導入時に行う。

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

保存schema/hash/chain/set・readonly indexes・非初期state proofの正本は[History readonly契約](fn004-history.md)。従来のtrace部分だけの概念JSONを完全recordの代わりに使用しない。`staging/apply-history/<apply_id>.json`をGit管理し、成功1件につき1 immutable recordを完成tempからno-clobber・durable公開する。同ID同semantic hashは既存結果、異hashはintegrity STOP。

recordはpayload、record_hash、検証済みDecision/Plan snapshot、metadataを持つ。payloadの全内容をhashし、source Decision/Planは各semantic hash経由でbindingする。最終state_hashへの循環参照は作らず、before/consumed stateとallocation rangeを記録し、最終stateがrecord_hashを参照する。apply_time/applied_atは元COMMIT_DECIDED intentで固定し、retry/recoveryで変えない。published_at等の表示metadataだけはsemantic hash外。

成功HistoryはCOMMIT_DECIDED後に公開する。公開済みHistoryだけでjournal完了・owner停止・cleanup完了を断定しない。失敗・ABORTED・ROLLED_BACKは成功Historyに入れず、no-op成功も必ず記録する。History全体のchain/head/countと現在stateのproofを検証したうえで、通常reader/Planは既存runtime guardの未完了receipt/journal/pending/cleanup確認も必要とする。本人のrecoveryだけが保存intentを根拠に期待遷移を扱う。

History-only readonly proofはsuccess-only-v1 profileである。rollbackの消費済みID/eventを成功chainに偽装せず、追加のterminal journal proofが必要ならSTATE_TRANSITION_PROOF_REQUIREDで止める。後続Transaction/Recovery validatorがterminal整合を証明するまで通常利用を再開しない。この設計follow-upはpublication/recovery実装を含まない。

## ID state・bootstrap

bootstrap・genesis・initial stateの正式schema/hash契約は[Bootstrap / ID state](fn004-bootstrap.md)を正とする。Git auditは`origin/main` HEADから全parentを辿るreachable history、external declarationは全namespaceの人間監査upper boundとして必須。declared < current/history maxはblocking contradictionで、自動補正しない。

`staging/fn004-bootstrap.json`はGit-managedなimmutable genesis record兼completion marker、`staging/fn004-state.json`はGit-managedなmutable current state。repository_instance_idはstate lineageを識別し通常cloneで継承する。bootstrap identity payloadだけをJCS/SHA-256でhashし、audit/manifestをhash経由でbindingする。初期History headはbootstrap_hash、count=0、last_apply_id=null、allocation_events=[]、pending_transaction=null、generation=0。架空Apply/transaction recordを作らない。

bootstrapは明示check → 人間確認 → expected audit hash付きinitializeだけ。initializeでは監査を再検証し、stateを先にdurable/no-clobber公開、bootstrap markerを最後に公開する。片側file・残存bootstrap intent/temp・不一致は`BOOTSTRAP_INCOMPLETE`等で通常利用を止め、未初期化扱いや自動再bootstrapをしない。bootstrap専用intentは最小の中断証跡で、実Apply transaction journalやrecovery実行とは区別する。

stateのnamespace keyはcanonical ID prefix（W/C/P/G/L/V、song M/A/J/T/B/O/R/H）。全14個を保持し、0〜99999のinteger。99999はvalidな過去状態だが以後のallocationは枯渇STOP。Planは上限を読むだけ。COMMITTINGをdurable記録後、最初のCSV置換前にplanned IDsのrangeとtransactionをallocation eventとして消費し、high-water mark・generation・pendingを保存する。保存失敗ならCSVに触れない。

rollbackでも消費済み上限/イベントを残し、古いstate backup全体を戻さない。成功transactionは消費/pending確立でgenerationを+1、History公開後の成功head/count更新・pending解除でさらに+1とする（no-opも同じ）。他のjournal/receipt/cache更新ではstate generationを増やさない。History公開後に成功head/countを更新してpendingを解除する。no-opでも成功headは進む。state更新はtemp/sync/rename/directory sync。同transactionの消費を再度増やさず照合する。bootstrapの全namespace genesis、current/history max、直前valid stateより上限を下げない。初期化・clone・中断・schema validation・capacity・TOCTOUの詳細は上記専用契約に従う。

## 成功・cleanup・Git

成功はtarget全14表一致・whole validation・ID state整合・成功History一致・COMPLETED journalが揃った時点。requestのresult参照を同結果へ結び付ける。lock削除失敗は成功を取消さず、readiness=cleanup_required。COMMIT_DECIDED後未完了はcommitted_pending_finalization、再Applyは禁止。

未完了journal / receipt / backupはGCしない。terminal確認後だけtempを削除し、journal/backupは保管policyで後日削除可能。cleanup失敗で成功Historyを消さない。復旧に必要なPlanやreceiptは依存がある限り保持する。

Git commit / push / PR、site buildはtransaction外。Git失敗でcanonicalをrollbackしない。Apply後に人間がcanonical・Decision・Approval・History・stateのdiffを確認して通常のGitフローへ進む。直接編集との競合は直前/直後hashで検出するが、非協調writerとのcheck/rename間raceは防げないため、transaction中の直接編集・checkoutは禁止する。
