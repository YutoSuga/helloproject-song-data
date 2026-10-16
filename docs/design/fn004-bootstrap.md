# FN-004 Bootstrap / ID state contract

本書は[Transaction設計](fn004-transaction.md)のbootstrap・state部分の正式v1契約である。Slice 3で停止したGit監査scope、external declaration、genesis/state schemaを人間判断済み方針に基づき確定する。**本書のschemaは実装契約であり、単なる概念例ではない**。runtime・validator・CLI・production bootstrapは今回実装/実行しない。

## 共通型・version・正本

canonicalの正本は`data/*.csv`。bootstrapはID使用済み上限の監査であり、canonicalを変更しない。namespaceとID patternの正本は[データ仕様](../data-spec.md)および[`canonical-schema.js`](../../src/canonical-schema.js)。runtimeはmasterのID列・pattern・song prefixからnamespaceを導出し、bootstrapだけの矛盾し得る一覧を別管理しない。

以下で使う型を定義する。

| 型 | 正式契約 |
| --- | --- |
| NamespaceMap | object。keyは`W,C,P,G,L,V,M,A,J,T,B,O,R,H`の全14個、欠落/未知key禁止。各値はJSON numberのinteger、0〜99999。文字列への暗黙変換なし |
| Hash | SHA-256の小文字hex 64文字 |
| CommitSHA | `git.object_format`に一致する完全な小文字hex（sha1=40文字、sha256=64文字）。短縮SHA不可 |
| RepositoryID | `repo_`＋小文字UUID v4。initializeで`crypto.randomUUID()`等から一度だけ生成 |
| Actor | object、必須fieldは非空stringの`id`と固定値`assurance: "local_process"`。v1 bootstrapはlocal operatorの明示操作 |
| Timestamp | データ仕様と同じtimezone付きISO 8601の実在日時 |
| Manifest | Slice 1の`{schema_version:1, files, manifest_hash}`。正確な14 entry、POSIX path ASCII昇順、各entryは`path, byte_length, sha256`。hashはSHA-256(JCS(files)) |

本書で定義するobjectは、表でoptionalとしたもの以外すべて必須。未知field・未知version・型不一致はblocking error。省略値の推測、文字列/数値変換、Unicode正規化、URL同一視はしない。任意noteの省略と空文字は異なるdocumentとしてhashする。

`RuleVersions`は次の固定fieldを持つobjectとする。schema間のversionは独立に改定可能で、意味・監査projection・hash対象を変える場合は対応versionを上げる。実装側が未知versionを黙って現versionとして読まない。

各recordのschema versionと対応rule_versions値は一致を必須とする（declaration→external_declaration、bootstrap→bootstrap、state→state、Manifest→canonical_manifest）。canonical schema/validatorはその監査で実際に使ったruleに一致することを検証する。

```json
{
  "canonical_schema": 1,
  "canonical_validator": 1,
  "canonical_manifest": 1,
  "id_namespace": 1,
  "git_id_audit": 1,
  "external_declaration": 1,
  "bootstrap": 1,
  "state": 1,
  "canonical_json": "rfc8785",
  "hash_algorithm": "sha256"
}
```

## authoritative Git historical audit

authoritative refは**`origin/main`**。audit開始時に完全なcommit SHAへ解決し、そのHEADから**全parentを辿って到達できる全commit**を対象とする。`git rev-list origin/main`相当で、first-parent限定ではない。merge commitのparent側もreachableなら含める。

目的はcanonicalとして正式採用されたGit履歴上のID再利用防止である。mainに未mergeのfeature/local-only/non-main branch、orphaned/deleted ref、reflogだけのcommit、Git外利用は直接のGit audit対象外。実際に使用済み扱いすべきものはexternal declarationへ含める。別branchでもorigin/mainからreachableなcommit自体は除外しない。

対象contentはreachable commit中の`data/*.csv`のhistorical bytesだけ。docs、tests、commit message、branch名、PR text、staging、生成物に現れるID文字列は数えない。current working treeの未commit canonicalはcurrent auditで別に扱い、未追跡の任意テキストはhistorical auditに混ぜない。

同じblobの監査結果を再利用してよいが、全reachable commitの対象pathをcoverする。対象pathがまだ存在しないcommitは正常な不在であり、file削除後も以前のblobで見つけたID上限を保持する。履歴全体へ現行whole validatorを適用しない。historical CSVは厳密UTF-8/CSV/header/列数を確認し、schemaの既知table・ID columnの意味を確実に特定できる範囲で、master IDとrelationのID参照列を監査する。現在の非ID列の追加/削除/順序差だけでは失敗にしない。

必要なidentity列を特定できない、未知historical table/ID列の意味が確定できない、schema変更でIDの解釈が不明な場合はskipせず`BOOTSTRAP_AUDIT_INCOMPLETE`。別名/旧形式を扱うなら監査ruleの明示的version追加が必要で、推測mappingをしない。IDは対応namespaceの正式patternに一致すること。例えば`W100000`はcapacity/format違反で監査をblockし、100000を上限として続行しない。

### 完全性とGit identity

local Git object databaseを使用する。GitHub APIへの依存、監査中の暗黙fetch/config変更はしない。operatorはcheck前に通常の方法でorigin/mainを更新する。audit identityが示すのはそのlocal refの監査時点であり、network上の最新性をhashだけで証明するものではない。

shallow=falseの確認だけで完了とはしない。全parent/対象tree/blobへのアクセスとparse成功が必要。shallow boundary、欠損object、Git command failure、ref曖昧/不存在、unexpected encoding、解釈不能historical CSVはすべてblocking。replace/graft等で元のcommit parent graphが変更されている履歴を通常監査として受理しない。未取得objectを見えないまま除外しない。外部declarationでGit audit不完全を代替してはならない。

audit payload内の`git` objectを以下に固定する。

| field | 型・値 |
| --- | --- |
| authoritative_ref | 固定string `origin/main` |
| audited_head | 監査対象として解決したCommitSHA |
| object_format | `sha1`または`sha256`。repositoryの実format |
| history_scope | 固定string `all_reachable_parents` |
| history_rule_version | integer `1`。rule_versions.git_id_auditと一致 |
| shallow | boolean `false`のみcompleteとして受理 |
| complete | boolean `true`のみ適用可能auditとして受理 |
| reachable_commit_count | 1以上のinteger |
| root_commits | 非空array。対象graphでparentがないcommit SHAの重複なしASCII昇順。時刻上の「最古」を推測しない |

## external declaration v1

declarationは**必須**。「外部利用なし」も省略せず人間が明示する。各値はGitとの差分でなく、**authoritative history外も含む、そのnamespace全体について人間が把握・確認した使用済みID upper bound**である。0は把握している使用済みIDなしを意味する。

外部利用なしでもGit/currentに使用済みIDがあれば、その既知上限以上を人間が宣言する。「外部追加分が0」を理由に全namespaceへ0を入力する契約ではない。

| field | 型・制約 |
| --- | --- |
| schema_version | integer `1` |
| namespaces | NamespaceMap、全namespace必須 |
| statement | 固定string `known_used_id_upper_bounds_including_outside_authoritative_history`。自由文だけで監査の意味を決めない |
| evidence | array、0件可。各要素は次段落で定義するEvidence object。人間が確認した順序を保持 |
| note | optional string。補足。省略時に自動生成しない |

Evidenceは`kind`（`url`または`human_note`）と非空string `value`を必須とする。kind=urlのvalueは絶対HTTPS URL、kind=human_noteは確認した手動運用・未merge/deleted ref・外部import等の根拠記述。declaration evidenceは必ずしも楽曲の公式sourceではなく、ID使用履歴監査の証跡である。created_at/audited_at等はv1 declarationに追加しない。確認時刻の表示はcheck metadataへ分離する。

全fieldを含む形の例（すべて0の宣言がこのrepositoryでvalidとは意味しない）：

```json
{
  "schema_version": 1,
  "namespaces": {"W":0,"C":0,"P":0,"G":0,"L":0,"V":0,"M":0,"A":0,"J":0,"T":0,"B":0,"O":0,"R":0,"H":0},
  "statement": "known_used_id_upper_bounds_including_outside_authoritative_history",
  "evidence": [],
  "note": "この値は形式説明用であり本番監査結果ではない"
}
```

### maxima・矛盾・high-water

current maximaはgate下でSlice 2 safe readの全14表validationを通したsnapshotから、各masterのID numeric componentをnamespace別に抽出する。空namespaceは0。songはprefix別に保持する。historical maximaは上記Git auditで対象canonical contentに実際に記録されたIDから得る。current > historical、historical > currentのどちらも正常にあり得る。

```text
known_max(N) = max(current_maxima[N], historical_maxima[N])
external_declaration.namespaces[N] < known_max(N)
  → EXTERNAL_DECLARATION_CONTRADICTION（blocking、自動補正禁止）

valid declarationの場合だけ：
resulting_high_water_marks[N] = max(current_maxima[N], historical_maxima[N], declared[N])
```

declarationは既知の上限以上なので、通常はdeclaredがresulting high-waterとなる。Gitで見つかった値を人間の宣言として自動入力しない。欠番は再利用しない。例えばW00001/2/4、high-water=4ならW00003は使用禁止で、将来候補は5以降。allocation自体はSlice 3対象外。

99999はhistorical stateとしてvalidでbootstrap可能。ただし該当namespaceのcapacityはexhaustedで、後続allocationはSTOP。100000以上・負数・小数・未知/不足namespaceはinvalid。check/statusは`exhausted_namespaces`（ASCII昇順のprefix array）を導出して示し、全namespaceで採番可能と誤表示しない。

## audit identity payload v1 / check

audit payloadは次のfieldだけを持つ。全mapはNamespaceMap、gitとrule_versionsは上記正式型とする。

| field | 型・制約 |
| --- | --- |
| audit_schema_version | integer `1` |
| canonical_manifest_hash | validation済みcurrent Manifestのmanifest_hash |
| git | 上記Git identity、complete=true |
| current_maxima | NamespaceMap |
| historical_maxima | NamespaceMap |
| external_declaration | 検証済みdeclaration document全体。note/evidenceも含める |
| resulting_high_water_marks | 上記max式のNamespaceMap |
| rule_versions | RuleVersions |

`audit_hash = hashCanonicalJson(audit_payload)`、すなわちSHA-256(UTF-8(JCS(payload)))。Slice 1の`canonicalJson` / `hashCanonicalJson`を再利用し、object挿入順やlocale sortへ依存しない。generated_at、実行path、host、PID、actor、initialize時刻、ランダムrepository IDをaudit payloadへ入れない。同一manifest/Git identity/declaration/rulesなら同一hash。declarationの値・statement・evidence・note変更もhashへbindingされる。

将来libraryの`checkBootstrap({root, external_declaration})`は `{status, readiness, audit_payload, audit_hash, canonical_manifest, exhausted_namespaces, diagnostics, metadata:{generated_at}}`を返す契約とする。statusは下表による。未初期化かつ全監査成功ならstatus=BOOTSTRAP_REQUIRED、readiness=`initializable`。これは初期化済みREADYとは別である。

失敗時はreadiness=`blocked`、audit_hash=null。実行できた監査の部分情報をdiagnosticsで示してよいが、completeな適用可能payloadとして扱わない。既存valid stateならstatus=READY、通常readiness=`initialized`とし、再bootstrap可能としない。完了artifactの後片付けが必要な場合は下記cleanup_requiredを区別する。状態照会だけでdeclarationを捏造/省略してaudit成功にしない。

状態照会API `inspectBootstrapStatus({root})`はdeclaration入力を要求せず、保存済みgenesis evidence・stateと現在のcurrent/history maximaを検証する。未初期化の照会はBOOTSTRAP_REQUIREDを返すだけでaudit成功ではない。checkが既存READYを返す場合も新しい初期化用audit_payload/audit_hashはnullとし、既存RepositoryID/bootstrap_hash/state_hashを別の`existing_identity` objectで返す。未初期化ではexisting_identity=null。古いgenesis declarationを将来currentの新監査宣言へ自動流用しない。

check/statusはdomain artifact・canonical・IDを変更しない。共通gateの正常な一時取得/自己releaseは必要な読込同期であり、「read-only」は既存lockの削除やforce unlockを許す意味ではない。人間確認待ちにgateを保持しない。readonly auditのためだけにbootstrap/History/intentを生成しない。

## repository lineage / immutable genesis record v1

repository_instance_idは**Git-managed FN-004 state lineage**のidentity。通常cloneではbootstrap/stateとともに同じIDを継承し、cloneごとに発行しない。artifactを持たない別の独立repositoryを明示bootstrapする場合だけ新ID。canonical、Git SHA、remote URL、path、machineから導出しない。複数cloneでの同時採番や台帳分岐を許すものではなく、単一authoritative working tree運用を維持する。

`staging/fn004-bootstrap.json`はGit管理する**immutable genesis record兼completion marker**。rootは以下の正式schema。

| field | 型・制約 |
| --- | --- |
| schema_version | integer `1` |
| payload | 下記BootstrapIdentity |
| bootstrap_hash | SHA-256(JCS(payload)) |
| audit_payload | 上記audit payload全体。payload.audit_hashから検証可能 |
| canonical_manifest | baseline Manifest全体。audit/payloadのcanonical_manifest_hashと一致 |
| metadata | object、必須fieldは`initialized_at: Timestamp`のみ。initialize中に一度固定する |

BootstrapIdentityは以下をすべて必須とする。

| field | 型・制約 |
| --- | --- |
| bootstrap_schema_version | integer `1`、root.schema_versionと一致 |
| repository_instance_id | RepositoryID |
| audit_hash | SHA-256(JCS(root.audit_payload)) |
| canonical_manifest_hash | baselineのmanifest_hash |
| authoritative_git_ref | 固定string `origin/main`、audit_payload.git.authoritative_refと一致 |
| audited_git_head | audit_payload.git.audited_headと一致するCommitSHA |
| high_water_marks | audit_payload.resulting_high_water_marksと全namespace一致するgenesis NamespaceMap |
| rule_versions | audit_payload.rule_versionsと一致するRuleVersions |
| operator_confirmation | object、必須fieldは`actor: Actor`、固定`purpose: "bootstrap_initialize"`、`expected_audit_hash: Hash`。expectedはaudit_hashと一致 |

bootstrap_hash自身・audit_payload等のroot参照field・metadataはbootstrap hashの直接対象外。audit_payloadはpayload.audit_hash経由、Manifestはpayload.canonical_manifest_hash経由でbindingする。自己参照/循環hashはない。initialized_atの表示metadataを変えてaudit identityを再生成しない。hashは内容同一性であり署名/認証の代替ではなく、operator metadataの履歴もGitで追跡する。

operator_confirmationはbootstrap監査への明示確認であり、canonical Apply Planを承認するApproval recordではない。Apply Requestや架空のtransaction identityを生成しない。

**別genesis fileや架空のApply Historyは作らない。History count=0のgenesis headはbootstrap_hashそのもの**。最初の成功Historyのprevious_history_hashはこの値、以後は前成功record_hashとする。既存valid bootstrap/stateへのinitialize再送は`BOOTSTRAP_ALREADY_INITIALIZED`＋既存identityを返し、ID再生成・audit差替え・上書きをしない。

## mutable fn004-state v1

`staging/fn004-state.json`はGit管理するmutable current state。初回もno-clobber公開し、以後transactionだけが正式手順で更新する。rootの全fieldを以下に固定する。

| field | 型・初期値 |
| --- | --- |
| schema_version | integer `1` |
| repository_instance_id | bootstrap.payload.repository_instance_id |
| bootstrap_hash | bootstrap.bootstrap_hash |
| initialized_at | bootstrap.metadata.initialized_atと同じ固定Timestamp |
| generation | 非負integer、初期`0`。将来のdurable state遷移ごとに増加、巻戻し禁止 |
| baseline_manifest_hash | bootstrap.canonical_manifest.manifest_hash。将来も初期baselineを維持 |
| high_water_marks | NamespaceMap、初期はbootstrap.payload.high_water_marksと全値一致 |
| allocation_events | array、初期`[]`。将来append-only |
| history | object、初期`{count:0, head_hash:bootstrap_hash, last_apply_id:null}` |
| pending_transaction | 初期`null`。将来pending時だけ実transaction identityへbinding |
| state_hash | rootからstate_hashだけを除いた全内容のSHA-256(JCS(...)) |

state_hashはinitialized_at等の保存済み値も含む。時刻はinitialize中に一度決め、再試行やcheckの現在時刻で更新しない。state_hashとbootstrap_hashの循環はない。History recordが最終state_hashを参照しない既存Transaction契約も維持する。

将来のallocation_events要素は既存Design 3どおり`{transaction_id, namespace, first, last}`で、namespaceは本書のprefix key、first/lastは1〜99999のinteger、first<=last。transaction_idは実在する`tx_<UUID v4>`。historyは非負integer count、Hash head_hash、nullまたは`apply_<UUID v4>`のlast_apply_idを持つ。pending_transactionはnullまたは`tx_<UUID v4>`。**Slice 3はこれらの進行recordを作らず、非初期stateのchain/pending整合を証明できなければREADYにしない**。実行・recoveryは後続sliceの責務。

high-waterはnamespaceごとにmonotonic。genesis値、current canonical max、完全Git historical maxのいずれよりも低いstateはREADYではない。将来の更新は直前valid stateと全namespace比較し、減少を拒否する。rollbackで消費済み上限やallocation_eventsを戻さない。自己整合した古いstateのcheckoutまでhashだけで検出できるとは主張せず、既存の単一lineage・巻戻し/分岐再照合方針を維持する。

## initialize / publication / TOCTOU

将来libraryの`initializeBootstrap({root, external_declaration, expected_audit_hash, actor})`は明示操作のみ。Plan/Apply/readからの自動bootstrapは禁止。本番CLIは後続sliceで[Design 4](song-admin.md)の`init --check`→人間確認→`init --expect-audit-hash`へ接続し、UIはbootstrap requiredを表示するだけ。

成功結果は`{status:"READY", code, repository_instance_id, bootstrap_hash, state_hash, high_water_marks, readiness, diagnostics}`。初回code=null、validな二回目はcode=BOOTSTRAP_ALREADY_INITIALIZED。readinessは正常完了時`initialized`、公開後cleanup未完了は`cleanup_required`で、完全成功と同一視しない。失敗はRepositoryErrorと上記code/diagnosticsを保持し、process.exitだけで表現しない。

1. Git auditを固定HEADで行う。長い履歴scanとnetwork/人間待ちでgateを保持しない。
2. 共通exclusive gate取得後、既存marker/state・未完了artifactを検査。READYなら既存identityを返し、片側/破損/競合なら停止。
3. Slice 2 safe readでcurrent canonical全14表を再検証。Git refの再解決、completeness/rules、同一declarationを再検証し、現inputでauditを再計算する。固定HEADと完全object graphが同一なら検証済みGit scan結果は再利用可能。変われば新HEADで再監査し、古いscanを混ぜない。
4. `expected_audit_hash == 再計算audit_hash`を必須とする。不一致は`BOOTSTRAP_AUDIT_MISMATCH`、state/marker公開禁止。canonical未commit変更、origin/main更新、declaration/rule変更のいずれでも再check・再確認が必要。
5. 成功inputを固定してRepositoryIDとinitialized_atを一度だけ生成し、bootstrap identity/hashとinitial stateを作る。最初のdomain artifact公開直前にもGit ref・canonical manifestのpreconditionを照合。初期化中のGit更新/checkoutは非協調変更として禁止し、検出時は停止する。
6. bootstrap専用のdurable intentを作り、initial stateをno-clobber・file/directory syncで公開。空のapply-history directoryをdurableに確立する。既存の非空Historyを空にしない。
7. **fn004-bootstrap.jsonを最後のcompletion markerとして**no-clobber・durable公開。両schema/hash/link・初期state/空Historyを再検証してREADY。既存fileは同名でも上書きしない。
8. 自己の完了intent/tempだけを確認してcleanup、gateをreleaseする。公開後sync/cleanup失敗を完全成功として隠さない。marker/state双方が見えるだけでdurability失敗を無視しない。

bootstrap専用intentは既存の「bootstrap自身もjournal/sync対象」を満たす最小証跡で、実Apply transaction journal本体ではない。pathは`staging/transactions/bootstrap_<UUID v4>/intent.json`、Git非管理。schemaは`{schema_version:1, kind:"bootstrap", bootstrap_record:<本書の完全record>, initial_state:<本書の完全初期state>}`、未知field禁止。両者のhash/linkを検証する。marker公開前のcrashでintent/tempだけ残った場合も不完全初期化として停止する。成功ownerはmarker/state一致確認後に自己intentを削除しdirectory syncできるが、未知/中断artifactの無差別cleanupは禁止。復旧実行・自動再bootstrapはSlice 3へ含めない。

Slice 2のgate/persistenceを再利用する。初回stateとmarker、intentは`createJsonExclusive`相当、mutable stateの将来更新は`writeJsonAtomic`相当。root/path safety、file/directory fsync failure、published不確定、release cleanup_requiredを保持する。Slice 3は既存の保守的presence guardをtyped bootstrap/state検証へ置き換える。本人の検証済みbootstrap intentを扱う内部contextと通常readerを区別し、一般callerにpending bypass flagを公開しない。

## status / validation / diagnostics

READYはbootstrap初期化の整合状態を意味し、Apply承認や全namespaceのallocation可能を意味しない。status/checkはschema・hash・auditの内部整合と次のlinkを確認する。

durable marker/stateが整合し、残存intent/tempもその完了bootstrapのものと全内容を検証できる場合は、lineageのstatus=READYとreadiness=`cleanup_required`を分離できる。通常利用はcleanup完了まで止める。marker未公開・内容不明の残存artifactはBOOTSTRAP_INCOMPLETEであり、単にmarker fileが見えるだけでsync失敗や不明な中断を成功扱いしない。initializeが検出したpublication fsync失敗は既存persistence errorを返し、READY成功へ変換しない。

- RepositoryID、bootstrap_hash、baseline manifest、initialized_atの一致。
- markerのaudit_hash、Manifest hash、audited ref/HEAD、rules、genesis maximaの相互一致。
- 全namespaceのstate high-water >= genesis/current/history maxima。
- 初期stateならgeneration=0、allocation_events=[]、pending=null、History count=0/head=bootstrap_hash/last=null、空History directory。
- 非初期stateは対応するallocation/History/pending検証が必要。未対応・未知artifactを推測でREADYにしない。既存bootstrapのaudited_headはgenesis evidenceとして固定し、origin/mainが後で進んでもmarkerを再発行しない。現在のhistorical/current maxとの比較は継続する。

Gitは空directoryを保存しないため、通常cloneではapply-history directoryだけが存在しない場合がある。**両recordの検証済みgenesis・count=0・head=bootstrap_hash・last=null・pendingなしが揃う場合だけ**、保存済みgenesisを0件Historyの根拠にできる。これはdirectory不存在を単独で空扱いする例外ではない。必要なdirectoryの再作成は同じlineageの運用準備であり、ID/marker/stateを再発行しない。count>0、未知のHistory証跡、初期化中でmarker未公開ならこの扱いを禁止する。初回initialize時は実際に空directoryをsyncしてからmarkerを公開する。

| 状態・code | 正式な扱い |
| --- | --- |
| BOOTSTRAP_REQUIRED | state/markerともなし、bootstrap intent/temp/既存lineageの証跡なし。明示checkへ。初期化はしない |
| READY | 両recordと必要な整合検証がすべてvalid。capacityは別表示 |
| BOOTSTRAP_ALREADY_INITIALIZED | valid lineageへのinitialize再送。既存identity、status=READYを返す |
| BOOTSTRAP_INCOMPLETE | stateのみ/markerのみ、未完了/照合不能bootstrap intent/temp、空History未確立等。不完全状態で、再bootstrap不可 |
| BOOTSTRAP_CORRUPT | marker JSON/schema/version/hash/audit内容がinvalid |
| STATE_CORRUPT | state JSON/schema/version/state_hash等がinvalid |
| STATE_BOOTSTRAP_MISMATCH | RepositoryID/bootstrap hash/baseline/time/link不一致 |
| STATE_HIGH_WATER_INVALID | namespace不足/未知、範囲・型違反、genesis/current/historyより低い上限、減少遷移 |
| BOOTSTRAP_AUDIT_INCOMPLETE | authoritative ref/履歴/objects/CSVの監査完全性を保証できない |
| EXTERNAL_DECLARATION_INVALID | 宣言不在、schema/statement/namespace/evidence不正 |
| EXTERNAL_DECLARATION_CONTRADICTION | declared < known_max、blocking。maxによる自動補正禁止 |
| BOOTSTRAP_AUDIT_MISMATCH | initializeのexpected audit hash不一致、公開禁止 |
| RECOVERY_REQUIRED | 上記不完全/矛盾状態または未知の未完了処理により通常利用不可というreadiness。自動修復不可 |

旧記述の`INITIALIZATION_INCOMPLETE`は本契約の`BOOTSTRAP_INCOMPLETE`へ名称統一する（既存runtimeには未実装）。messageで分岐せずRepositoryError.code/structured diagnosticsを使用。gate・persistence由来の既存codeは独自名へ置換しない。初期化完了後の両file消失も既知lineage/intent/History等の証跡があれば未初期化扱いせず停止する。Git全体を過去へ戻して証跡まで消した場合を自動検出できるという保証はしない。

## Slice 3への引き継ぎ

実装するのはcheck/audit/initialize/status、ID上限監査、初期record/state、validatorとgate/persistence接続まで。actual ID allocation/reservation、Decision、Plan、Approval/Request、実Apply journal、canonical write/transaction、backup/rollback/recovery execution、successful History、正式CLI/UIを実装しない。本番bootstrap/stateは実装PRで生成せず、merge後の別明示タスクで実行する。

次回のreviewでは、temp Git repositoryでmerge parentを含むorigin/main reachable監査、docs/未merge/削除refの除外、削除済みcanonical ID保持、historical schema、shallow/欠損停止、全namespace宣言/矛盾、99999/欠番、determinism、全TOCTOU input変更、clone lineage、state/marker片側・hash/link異常、gate競合、no-clobber・fsync・中断各段階を検証する。既存Slice 1/2 APIを再実装しない。
