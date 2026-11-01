# FN-004 Slice 6 Design Follow-up

## 1. Purpose

[Slice 6 Planning](FN-004-Slice-6-Planning.md)のDG-01〜DG-05を、6Aで新たなschema・phase・Recovery判断を作らず実装できる契約へ具体化する。基準mainは2026-11-01のef237b2c7e37a2348f00e558a3d9db776515df2a。PR #73はPlanningの統合でありTransaction実装ではない。

本書は選択理由・互換性・handoffの記録。**保存schema・phase・hash・actionの正本は[Transaction設計のSlice 6 evidence contract v1](../design/FN-004-反映処理・復旧.md)**。同じschemaを本書へ複製しない。独立Review & Mergeの完了までは6Aを開始しない。

## 2. Scope・確認した現在地

[Decision](../design/FN-004-判断モデル.md)、[Plan](../design/FN-004-反映計画.md)、[Approval / Request](../design/FN-004-承認・反映リクエスト.md)、[History](../design/FN-004-成功履歴・読取検証.md)、[Bootstrap / state](../design/FN-004-初期化・ID状態.md)、[全体フロー](../design/レビュー準備・canonical反映の全体フロー.md)、[CLI / SCR-002](../design/楽曲管理のCLI・画面連携.md)と[architecture](../システム構成.md)、[Feature ID](../feature-ids.md)、[Roadmap](../roadmap.md)、[data spec](../data-spec.md)を照合した。

| Slice | 実コードの確認・限界 |
| --- | --- |
| 1 | canonical-schema/validator/snapshot/hash。全14表、同bytes parse/hash、JCS/SHA。raw snapshot単独ではgateを取らない |
| 2 | fn004-repository、persistence、fn004-gate。JSON durability、no-clobber、path safety、live WeakMap lease。raw CSV writer/adoptionなし |
| 3 | fn004-bootstrap/state/id-audit/git-audit。genesisとstate validatorあり。消費/finalizeなし |
| 4 | Decision core/lifecycle/application、Plan、History readonly。OCC/registryとsuccess-only proofあり。実target/History writerなし |
| 5 | Approval schema/repository/application。exact binding、global/prospective Invalidation scan、durable Request、immutable retry/check/common DTO |
| 終端 | submitApplyRequestはsaveApplyRequest→requestResponse。Transaction dispatch、canonical mutation、History publication、state finalizationはない |

既存testsもschema/hash vectors、gate競合・異常lock保持、publication phase/fault、History成功のみのproof、Request retry/check/Invalidationを確認した。Planningの「design only」を現在実装済みへ変更しない。本taskではsource/testを変更しない。

## 3. Existing invariants

canonicalは全14 CSV、v1変更可能9表と固定順は不変。OS multi-file atomicityを仮定せず、common gateとdurable evidenceによるlogical all-or-nothingを維持する。COMMIT_DECIDED前は原則rollback、正式all-target例外を保持、後はrollback禁止。ID消費はCSV置換前、rollbackでもhigh-water/eventsを戻さない。

Receipt/IDs/time/bindingsはimmutable、processingはadvisory/hash-excluded。retry/checkは非dispatch。successful Historyだけが成功の正本。GitはTransaction外。Browser/APIにprivileged authorityを追加せず、Recovery/bootstrap実行はv1 CLIのみ。

## 4. DG-01 — Journal / Intent Closed Schema, Hash Projection and Phase Contract

### A. Existing evidence

Transaction正式設計にimmutable sequence/hash連鎖、latest cache、intent、全14 backup、changed temp、progress、apply_time、COMMIT_DECIDEDがある。persistence実装にはphase/published/tempとfile/directory syncがある。Planのtargetはtimestamp markerによるhypothetical targetで実serialized bytesではない。

### B. Missing decision

完全field set、nullのphase差、genesis previous hash、owner/Receiptとのlink、partial/cache、時刻の固定checkpointが不足していた。

### C. Options considered

1. mutable transaction.jsonだけを正本にする。
2. 状態ごとに異なるJSONを実装時に追加する。
3. versioned closed envelope＋全件immutable chain＋独立した完成intentを使う。

### D. Selected contract

3を選択。Owner/Intent/Journal/Completion/TerminalProof/Mutexの全root、payload、field型/null/enum、cross-field、pathをTransaction文書に確定。全新hashはschema_version/kind/payloadのJCS/SHA-256、自己hashだけ除外。journal genesisは元Owner hashにbindingする。latestは参照cacheだけ。

apply_timeは初回PREPARING entryへdurable保存してからtargetを生成。PREPAREDはfull backup/temp/input/intentの完成保証。COMMITTINGで期待consumedを保持し、actual stateから消費を別確認する。成功History全record/時刻をCOMMIT_DECIDEDへbindingする。

### E. Rejected alternatives

cache単独はcrash後の根拠と順序を失う。実装任せのfield追加はclosedness/versionを曖昧にする。Planへ実timestamp/manifestを埋め直す案はimmutable Plan/hashを破るため不採用。

### F. Compatibility impact

新artifact/schemaだけを追加。既存Decision/Plan/Approval/Receipt/History/state/normal gate v1と各hashは不変。Transaction旧概念記述を完全contractで具体化し、journal/backupのGCはv1で保守的に制限する。

### G. Implementation consequence

6Aはvalidator/hash/publisher/discoveryとpure phase modelを実装。6Bがreal target/prepareを作る。publisherはlive owned contextを要し、unknown entry/不正末尾をskipしない。partial publicationをsuccessful retryに丸めない。

### H. Test consequence

全required/null/enum/unknown/version、chain gap/fork、別Approval/Receipt/repository、時刻変更、no-op、cache欠損/破損、sync前後、success後rollback禁止を検証。projection-only固定vectorと完全domain fixtureを区別する。

### 6A-DG01-01 — 6A開始時に発見したpre-Intent abortの訂正

PR #75のReview #3はH-01/M-01を含む全体reviewをPASSしmainへmergeされたが、その後の6A開始時、実装前のschema/phase具体化で追加のblocking contradictionを発見した。6Aはsource/test/docs変更・commit・push・PR・runtime mutationを一切行わずSTOPした。過去の「6A blocking 0」はこの発見で覆っており、過去reviewを完全だったとして扱わない。

**反例・root cause**：Receipt→Owner→初回PREPARING(intent_hash=null)をdurable公開し、Intent作成前にcrashする。元canonical/state/History・未消費・valid prefixを検証すれば既存abort条件を満たす。しかし旧field規則はnullをPREPARINGだけに限定し、ABORTED(null)を拒否する。存在しないIntentへのHを捏造することも、公開journalを捨てreceipt-onlyへ変更することもできない。phase単独のnull制約とIntent existence lifecycleを結合しなかったことが原因である。

| 比較軸 | A 未作成Intentのnull継承 | B 早期abort専用terminal表現 | C pre-Intent crashをmanual STOP |
| --- | --- | --- | --- |
| 既存contract変更量 | field制約・chain/存在条件の訂正と公開窓の明確化 | 新terminal分岐を各schemaへ追加 | 既存abort/crash matrixの保証を縮小 |
| safety | 完全prefix/実artifact照合、H固定、terminal後作成禁止で閉じる | 別表現と既存ABORTEDの二重解釈を新規防止する必要 | 自動mutationはないが安全にabort可能な状態も停止 |
| determinism | phase×prefix×artifactの排他的状態 | 表現の選択規則をさらに設計 | 常にSTOPだが既存Recovery可能条件と不一致 |
| schema impact | 保存field/enum/projection変更なし | representation/version/proof分岐が増える | field変更なし、意味上の保証を後退 |
| H-01 impact | ownership archive/retirement不変 | 新terminalのretirement bindingが必要 | owner/gateを長期保全し手動対応 |
| M-01 impact | terminal優先・Proof再利用・Completion境界不変 | terminal優先表へ新branch追加 | receipt-onlyと区別は可能だが進行不能 |
| Terminal Proof impact | journal-based ABORTEDのintent=nullを制約付き許可 | 新family/bindingが必要 | 未公開のままSTOP |
| Completion impact | 非null terminal_journalと既存proof hashを使用 | 新terminal参照規則が必要 | 未公開のままSTOP |
| 6A実装 | lifecycle validatorとpure分類へ直接対応 | validator/classifierの追加設計が必要 | 実装容易でも元要件を満たさない |
| 6B〜6F影響 | prepare→Intent durable→H bindingを確定 | 全terminal publisher/action対応を拡張 | 運用手順/手動復旧の追加設計が必要 |

**採用判断**：Aを採用。単にABORTEDでnullを許すのではなく、未作成検証済み・確立済みH・未解決を区別する。Bは既存ABORTEDで表現できる結果に新表現を持ち込み、Cは既存の安全なabort保証を狭めるため不採用。正式contractはTransaction文書の「Intent lifecycle・pre-Intent abort（6A-DG01-01訂正）」とphase×Intent表・crash A〜Kに置く。

**formal correction**：初回PREPARING(null)→全prepare完成→単一Intentのno-clobber公開/sync/readback→journalへH binding→PREPAREDの順に固定。Intent公開が確立境界であり、journal参照の遅延はPREPARING/resume PREPARINGのnonterminal prefixだけで許す。完全Intent Hと古いnull prefixなら、全入力/refs・original/before/未消費を再検証し既存bytesのdurabilityを確認してABORTED(H)へ進む。未解決temp-only/partialは未作成扱いせずSTOPする。RecoveryはIntentの新規作成・再prepare・commit再開をしない。

未作成検証済みのPREPARINGからABORTED(null)へ進める。Hを一度確立すれば同Hを維持し、H→null/H1→H2を拒否する。ABORTED(null)後にIntentを後付けしない。既知target/完成refs subsetを消さない。Intent不在だけで未作成と推測しない。COMMITTING/rollback/successのnull許可を広げない。

**DG-04/DG-05 consequence**：pre-Intent ABORTEDはjournal-basedで、Proof.intent=null・元canonical/state・未消費・完全ABORTED chainを検証し、Completion.terminal_journalは元ABORTED entryの非null参照とする。receipt-onlyのjournal=[]/terminal_journal=nullとは別。Proof-onlyは元proof再利用のfinish_terminal、Completion後はcleanup/不要で、re-abortしない。terminal evidence優先・5 actionの排他性・4 readiness・closed diagnostic/errorは不変。observation v2は正規Intentのmissing/bytes、publisher temp、全chainを既にbindingするため、Intent公開は参照追記前でもhashを変える。旧観測でのabortは再検証で拒否し、projection/version変更はしない。

**compatibility**：H-01の永久archive/claim削除禁止/sequence/Retiring/Retiredを変更しない。M-01の優先順を変更しない。Request/Receipt、History success-only、state/high-water/generation、COMMIT_DECIDED・all-target条件、ProcessingCacheの非正本性は不変。既存Slice 1〜5のJSON/hash vectorを変更しない。未実装Transaction v1のnullable fieldに対する矛盾訂正で保存field・hash projectionは同一なので、新schema versionやartifact migrationを追加しない。

**implementation/test consequence**：6Aは実装未再開。再開後はphase/prefix/実Intentの照合、Proof/Completion binding、pure分類/観測hashまでを実装し、sync/abort/retirement実行は後続sliceに残す。6Bは上記publication順に従う。将来testsはnull→null/null→H/H保持、H→null/H変更、Intent存在＋旧null prefix、terminal nullとの矛盾、Intent missing/corrupt/duplicate/unsupported、ABORTED後の後付け、proof/Completion不整合、成功/消費証跡との矛盾、crash A〜K、Intent追加時のobservation race、H-01/M-01回帰を含む。今回runtime test/sourceは変更しない。

本訂正のself-review後も独立「Pre-Intent Abort Contract Review & Merge」が必要。そのPASS・main merge後にだけ最新mainから6Aを改めて開始する。Review #3のPASSを本訂正への承認として流用しない。

## 5. DG-02 — Completion, Initial Execution Ownership and Observation Contract

### A. Existing evidence

interfaceは初回受付者だけのexecutionとreceipt-only crash時の検証を要求する。現sourceは同payload retryをlookup後すぐresponseへ返し、Requestをno-clobber保存する。Receiptにowner/resultを追加する余地はない。

### B. Missing decision

accept→executeのclaim/lifetime、journal前の失敗証拠、completion全schemaとimmutable responseとの接続が不足していた。

### C. Options considered

1. retry/checkが未開始らしいRequestをdispatchする。
2. 受付gateを解放し別executorがclaimする。
3. 初回新規branchが同leaseで継続し、独立owner evidenceを保存する。

### D. Selected contract

3を選択。Request→Owner→再検証→journal。Ownerは受付時のgate witness・before state・original・exact bindingを保存し、元Receiptを変更しない。未完了ではleaseを無条件releaseしない。

Request公開後Owner公開前のcrashは自動未開始認定せずmanual STOP。Ownerあり/journalなしは元owner終了・全original/state/History・副作用なしを証明できる場合だけABORTED proof/completion。安全でない再dispatchを避ける保守的な失敗窓であり、欠落ownerの自動捏造はしない。

accepted/executingはReceipt/journal、successはHistory、failed terminalはproof/completion、未証明はrecoveryとして観測する。これらは新readiness enumではない。Request responseは4 fieldのまま、成功resultはexact History参照だけ。

### E. Rejected alternatives

retry dispatchはidempotencyを壊す。別executor claimは不要なqueue/二重owner境界を増やす。Receipt/processingをtruthにする案はimmutable/hash/response契約と衝突する。

### F. Compatibility impact

同payload原本・異payload conflict・static exact binding・post-accept Invalidation非cancelを維持。現Slice 5には接続せず6E/Fで初回内部継続を追加する。readinessやresponse rootを拡張しない。

### G. Implementation consequence

6AはOwner/completion/proofの検証まで。初回dispatchは6E/F。別callerはserialized gate witnessから権限を得られない。

### H. Test consequence

Receipt前後、Owner前後、journal前後のkill、missing owner、false completion、actor/Plan/Receipt相違、retry非dispatch、result+recovery、Request全bytes不変を検証する。

## 6. DG-03 — Recovery Gate Adoption / Retain / Release Contract

### A. Existing evidence

common gateはWeakMap live token＋inode/全bytesでreleaseし、通常wrapperは例外でもreleaseする。正式Recoveryはmutex、同host/boot/namespaceのowner停止証明、元lockを空けない移管を要求する。

### B. Missing decision

serialized tokenからの採用、保持条件、Recovery自身のcrash、inspectのreadonly性、mutex移管の競合とrelease順が不足していた。

### C. Options considered

1. PID/時間を見てstale lockをunlinkして取り直す。
2. すべての通常wrapperを例外時retainへ変更する。
3. 通常wrapperを保ち、同canonical gateにRecovery限定authorityを追加する。

### D. Selected contract・H-01による訂正

13f75bbではmutex anchor＋successor chainを選び、cleanupでclaim/anchorを削除可能としていた。独立Review & MergeはHIGH H-01を発見し、mergeせずSTOPした。A終了→B claim→Bがgateを解放して末尾claimを削除→anchor削除前にB停止、ではAの有効prefixしか残らない。B未取得とB取得後削除を区別する正本がなく、同sequenceを再利用できる。terminal Journal/Proof/Completionはimmutableで補記できない。旧「prefixならSTOP」はprefix退行の検出証拠を欠き、不十分だった。

訂正案を次の観点で比較した。

| 観点 | A: ownership永久保持＋独立retirement | B: tombstone公開後claim削除 | C: monotonic head/epoch更新 |
| --- | --- | --- | --- |
| safety / crash | 最新claimが常に残り、未完retirementも検証可能 | tombstone自体の永久保持・全claim内容の証明が必要 | head退行を防ぐ別の正本が必要 |
| concurrency | 同次sequenceのno-clobber、旧owner終了証明 | claim/tombstone競合と削除順の追加証明 | CASとhead/recordの二重publicationが必要 |
| hash / proof | 元chain不変、別retiring/retired hash参照 | tombstoneへ削除内容と全依存参照を複製 | mutable head単体ではprefix退行を検出不能 |
| cleanup | archiveは消さずbarrier/temp等だけ削除 | 永久tombstoneを残すのでGC利得が限定的 | head履歴も残せばAに近づく |
| restart / clone | 同treeで全履歴、cloneは過去proofと区別 | tombstone不足ならSTOP、持運び方針も必要 | head単独cloneでは過去所有者を証明不能 |
| common gate | 同lock、barrierでrelease窓を保護 | 同lockだが削除protocolが増える | 別head更新primitiveを排他へ接続 |
| complexity | record数は増えるが削除証明不要 | 削除・圧縮と二重証明が複雑 | CAS/epoch crash証明が複雑 |
| 6A / later slices | pure chain/retirement分類、runtimeは6C | 削除proof validatorが追加で必要 | head整合性validatorとruntimeが必要 |

Aを選択する。anchor/claim/retiring/retiredをruntime-local immutable archiveへ永久保持し、ephemeral barrierを別artifactとする。旧anchor/claim payload/hashは維持し、新kind MutexBarrier / MutexRetiring / MutexRetiredを追加する。正確なclosed schema・path・hashは[Transaction正本](../design/FN-004-反映処理・復旧.md)のDG-03に置く。

最大連続sequenceがlatest historical owner。retirement未公開はACTIVE、retiringのみはRETIRING、対応retiredまで完成はRETIRED。retiredとbarrier不在とterminal検証が揃って初めてSEALEDとなりcurrent ownerなし。古いownerへ戻さない。同txの再anchor/sequence再利用は禁止。全recordを検証し、fork/gap/unknown/partialはSTOP。

cleanup→MutexRetiring公開→同common canonical gate release/sync→MutexRetired公開→同inode/bytesのephemeral barrier release/syncの順。claim/anchor/retirementは削除しない。retiring以後はrelease-only。barrierが残る間のsuccessorは、retiredでも直前ownerの同host/boot/namespaceでのOS終了証明を必須とし、次sequenceへ進む。live handoffは提供しない。retiring途中の旧記録は保持し、dead ownerをsuccessorが置き換えて自分のretirementを作る。

初回は候補anchor hashを持つbarrierをexclusive公開し、内部構築capabilityで対応anchorを公開する。barrier→anchor間crashはmanual STOP。barrierだけからownerを復元しない。terminal cleanupでcommon gateが既に不在なら検証済みclaim capability下で同wx primitiveを一度取得する。unfinished Transactionのgate消失には適用しない。

### E. Rejected alternatives

Bはtombstoneの永久保持と削除済み全内容の検証が必要で、今回の安全性に不要なGC契約を増やす。Cのmutable headだけでは退行問題を移すだけで、append-only head履歴を加えるとAと同等以上の複雑さになる。古いclaimを消す旧案はH-01により棄却。PID/時間だけのstale unlink、別canonical lock、全wrapperの例外retainも従来どおり採用しない。

### F. Compatibility impact

通常gate v1/token/metadata、既存Owner/MutexAnchor/MutexClaim/MutexProof、Terminal Proof/Journal/Completion、state/History/Receiptは不変。未実装draftのmutex layoutは置換し黙って移行しない。production bootstrapの移行なし。archiveはruntime-local永久保持、Terminal Proofのhistorical MutexProofはGit-managed package内で従来どおり。fresh cloneは旧Recovery再開権限を取得せず、別txも単一authoritative working tree等の既存guardが必要。

### G. Implementation consequence

6Aは新schema/hash、archive/retirement検証・discovery・pure分類。claim/retirementのruntime、OS probe/adoption/cleanupは6C以降。normal gate guard接続は6C/E。既存gateの意味を今回のdocs変更で実装済みとしない。永久archive容量はv1で許容し、GCは提供しない。

### H. Test consequence

single owner、successor、fork/gap/duplicate sequence/異bytes、publication途中、cleanup途中、retiring/retired公開前後、gate/barrier release前後、Recovery自身のcrash、parallel Recovery、PID reuse、repository mismatch、observation race、旧prefix退行、fresh restart/cloneを検証する。H-01のB claimは全crash点で残り、Cはlive B拒否または終了証明付き次sequenceだけを選ぶ。retirementが失われてもownerを古いprefixへ戻さない。未知partial/参照不足は正常なfail-closed結果として扱う。

## 7. DG-04 — Post-Rollback Terminal Proof and Readiness Contract

### A. Existing evidence

History success-only-v1はgenesis→成功2遷移を証明する。既存設計は失敗ID消費を保持し、Historyだけで証明できないgapをSTATE_TRANSITION_PROOF_REQUIREDとして止める。現runtimeはRequest/journal presenceだけでもblockする。

### B. Missing decision

消費後rollbackのgeneration/pending解除、failed edgeの完全証明、retained local artifactの分類、cloneでの失敗消費証明、cleanupとfailureの区別が不足していた。

### C. Options considered

1. rollbackでstate backupも戻す。
2. 失敗を成功Historyへ入れる／success-only proofを緩める。
3. 新terminal proofと既存成功証明を合成する。

### D. Selected contract

3を選択。消費後失敗はconsumedからgeneration+1・pending=nullだけ変更し、events/high-water/History headを保持。未消費abort/rollbackはstate不変。

新transaction-terminal-v1 profileが全proofとHistoryをgenesisから全state edgeで検証し、gap/fork/余分なedgeを拒否する。成功Historyは旧schema/hashのまま。Git-managed stateの失敗消費をcloneでも検証できるよう、自己完結したterminal proof packageをstaging/transaction-proofsへGit管理する。これは成功Historyでも楽曲canonicalでもない。

全proof/completion/state整合後、残存cleanupなしなら失敗でもinitialized。既知cleanupだけならcleanup_required。未完了/証明不足はrecovery_required、不正はblocked/typed error。通常readiness接続は6C〜6E、6Aでは解除しない。

### E. Rejected alternatives

state巻戻しはID再利用を招く。失敗Historyはsuccess-onlyを破壊する。local journalだけのproofではGit clone時に消費stateの証明が失われる。単なるvalid hash/current generationだけでは遷移を証明できない。

### F. Compatibility impact

既存state/History schema/hashとsuccess-only API/DTOは不変。追加profileは独立version。PlanRulesの成功遷移規則は不変で、failure proofをPlan payloadへ追加しない。Git管理する新proofは必要な契約追加であり、architecture/roadmapの書換えやGit自動化は行わない。

### G. Implementation consequence

6Aはproof modelとpure検証、6Cがfailure terminal、6Dがsuccess finalization、6Eがreadinessへ接続。v1はproof/元証拠GCなし、backup/tempは完全terminal確認後だけcleanupする。

### H. Test consequence

消費前abort、未消費rollback、消費後rollback、no-op、success→rollback→次success、消費二重加算、missing proof、cloneでlocal journalなし、cleanup failureとunknown evidenceを検証する。

### M-01 — Review #2によるreceipt-only分類の訂正

**Existing evidence / 発見経緯**：H-01修正head 034440eの独立Review #2はMEDIUM M-01を発見し、mergeせずSTOPした。receipt-onlyはABORTED proofのjournal=[]とCompletion.terminal_journal=nullを正式に許す。一方、旧DG-05表は「ownerあり・journalなし→abort」をterminal行より先に置き、finish_terminalをterminal journal前提で記述していた。Receipt→Owner→proof→Completion→retirement前crashではabort/cleanupが重なり、proof後Completion前crashでは既存proofを保持して完了する境界が不足した。これはruntime bugではなく、前回self-reviewの「6A blocking 0」では見落としたformal gapである。

**Missing decision / root cause**：Owner/journalの形だけで初期状態を判定し、公開terminal証拠によるsemantic進行をpredicateへ反映していなかった。順序表がformal priorityなのかも曖昧で、proof公開済みと初回abort可能を分離できていなかった。

| Options considered | 評価 |
| --- | --- |
| 1. terminal行を上へ移すだけ | 完成済みcaseは改善するが、proof-only、完成publisher temp、Completion-only、不正証拠の境界が残る |
| 2. abortをidempotent万能terminalizerにする | 完了後もabortを選ぶ意味が残り、re-abortと元proof再利用を混同。今回のsemantic単調性に不適合 |
| 3. terminal evidenceによる段階分割＋排他的predicate | 元schemaを維持して、公開済み/未完publication/初回abortを区別できる。pure分類とcrash検証が可能 |

**Selected correction**：3。正本は[Transaction正式設計](../design/FN-004-反映処理・復旧.md)の「Terminal evidence優先・排他的なaction契約」。全証跡validation→Completion済み→公開proof/完成proof intent/terminal journal→不可逆成功→pre-terminal commit/abortという段階で分割する。owner live/終了証明/gate/raceは実行許可を制限し、terminal stageを初期状態へ戻さない。

receipt-only B（Ownerあり、terminal証拠なし）はabort、C（proofありCompletionなし）はfinish_terminal、D（proof＋Completion）はcleanupまたは不要。A（Ownerなし）はmanual STOP。E/FはDから進んだretirementであり、semantic再実行不可。Completion-only、不正partial、失敗proofと成功History/decisionの共存はintegrity STOP。全valid行はmutation候補1つ以下、不要またはmanual STOPも明示し、第6actionを追加しない。

既存proofはhashだけでなくauthority/ended_at/inputs/diagnostics/state/manifestを全内容保持。successorの現在authorityを独立archiveで証明し、過去proofへ上書きしない。Completionは元proofから一意に導出し、完成tempがあれば同内容を再利用する。新しいproof/時刻/identityを作らず、no-clobberで公開する。proof/Completion完成前のcleanup/retirementは禁止。

**Rejected alternatives**：1は部分公開とaction排他性の証明を閉じない。2は再abort禁止とclosed actionの責務を曖昧にする。新receipt schema、失敗History、新readiness/action/error literalの追加も不要で採用しない。

**Compatibility impact / DG-04**：proof/Completion schema・HashProjectionV1・固定pathは不変。receipt-onlyは未消費ABORTED、state不変、Historyなし。消費後rollbackのgeneration/high-water/events、成功state、composite proofは変更しない。COMMIT_DECIDED・all-target例外を弱めない。

**Compatibility impact / DG-05・H-01**：分類semanticsだけを閉じ、5 actionと4 readinessを維持。ObservationHashProjectionV2はproof/Completion/tempを既にbindingするのでfield/version変更なし。runはproof/Completionが増えた古いtoken/actionを拒否し、他者のterminal publicationを本人claim追加の例外へ混ぜない。H-01のarchive永久保持、claim削除/reset禁止、Retiring/Retired、OS終了証明、barrier順序は変更しない。

**Implementation consequence / 6A**：pure validator/classifierでterminal stage・receipt-only A〜F・action排他性を実装可能にする。proof/Completion/tempの検証と観測だけを6Aの責務とし、abort/finish_terminal/cleanup/ownership/retirementの実行は6C以降。現Slice 5のsaveApplyRequest→response終端は変えない。runtimeのtyped error/DTOも変更しない。

**Test consequence**：正本に20 crash点と全5 action可否表を追加した。proof-onlyでabort不可、Completion済みでfinish_terminal不可、Completion-only拒否、異bytes同identity、異outcome、成功との矛盾、完成tempとpartialの差、owner successor、inspect/run race、retirement後再abort禁止を必須negative caseにする。H-01のold prefix/crash/parallel Recoveryも継続検証する。throwとprocess killは別試験、今回runtime testは実装しない。


## 8. DG-05 — Typed Error Mapping and Recovery Inspect / Run Action Contract

### A. Existing evidence

既存domain/gate/History/bootstrap/persistenceのtyped codeと、CLI inspect→expected hash/action付きrun、CLI exit tableがある。Request DTOはcodeだけの診断と成功History参照を返す。

### B. Missing decision

journal不正のmapping、readonly観測schema、actionのclosed set、競合時の再照合、失敗terminalの専用観測が不足していた。

### C. Options considered

1. message/free-text actionで分岐する。
2. 各層に新しいjournal error/readinessを作る。
3. 既存codeを保ち、typed evidence/classification/actionを別軸にする。

### D. Selected contract

3を選択。M-01訂正でterminal evidenceによる段階分割と排他的predicateを正本へ追加した（前章のReview #2記録）。Actionはabort / rollback / finalize_success / finish_terminal / cleanup。allowedは一観測0件または1件。manual_stop/active/terminalはactionなし。all-target例外のsuccess確定もfinalize_successで既存条件を再検証する。

H-01訂正後の観測はObservationHashProjectionV2を用いる。永久ownership archive全体・retirement・barrier、actual canonical/state/History/journal/owner/再検証結果へbindingする。latest cacheと保存Requestのprocessingを含むraw bytesは除外し、Requestはimmutable Receipt hashへbindingする。旧v1観測/command/tokenは拒否する。既存Slice 1〜5のartifact version/hashは不変。inspectの二重収集は排他保証ではなく、runがhash/action照合→mutex/gate所有→本人追加分以外の再検証を必須とする。new evidence不正はINTEGRITY_CONFLICT、gate不正はGATE_CORRUPT、証拠不足はRECOVERY_REQUIRED、state gapはSTATE_TRANSITION_PROOF_REQUIRED。元I/Oのphase/published/temp/codeを保持する。History publication直後の正当なstate-head遅延は、元decision/consumed state/exact recordの限定観測で扱い、既存success-only結果のfalseを書き換えない。

cleanupはsemantic terminalizationを行わず、finish_terminalとは別。検証済みterminalでもretirement/barrier解放が残ればcleanup_required。live head ownerには外部actionなし、dead ownerの終了証明後だけ次claimでcleanup可能。unknown ownership/retirement、head退行、observation差分はactionなし。5 action/readiness enumは増やさない。

### E. Rejected alternatives

message依存は非決定的で、operatorが任意actionを選ぶ方式は判断根拠を失う。新readinessやHistory失敗resultの追加は既存responseを破る。old tokenで自動的に別actionへ進めない。

### F. Compatibility impact

既存code/response/CLI exitを維持。Recovery observationは専用domain DTOでUI DTOではない。bootstrap/Recovery runはCLI限定。unknown exceptionをdomain codeへ捏造しない。

### G. Implementation consequence

6Aがpure分類とclosed DTO、6C/Dがaction execution、6Fが薄いCLI adapter。test fixture由来のclaimed-valid flagをpublic認可へ使わない。

### H. Test consequence

unknown/corrupt/missing、wrong token/action、raced snapshot、live owner、post-decision unknown canonical、History/state conflict、same run再送、result+recovery、元typed cause維持を検証する。

## 9. Cross-gap invariants

Owner/Receipt→固定apply_time→prepared intent→journal→History→state→terminal proof→completionの参照に循環hashを作らない。completionはproof hashを参照し、proofはcompletionを含めない。journal genesisはOwner hash、intentはOwnerへ参照し、journalはintentへ参照する。terminal proofは終わったchainを含める。

COMMIT_DECIDEDのhistory recordはそのentry自身や最終state hashを参照しない。success terminal stateがHistory hashを持つ既存方向を維持。rollback stateはHistoryを進めない。same Receipt/tx/apply/Plan/Approval identityを全段階で保持する。

## 10. State / evidence matrix

| 観測 | 正式根拠 | 通常readiness / action |
| --- | --- | --- |
| Receiptのみ・owner不明 | immutable受付のみ | recovery_required、manual STOP |
| Ownerあり・journalなし・no-start証明可能 | owner/input/original/state/prefix/終了証明 | recovery_required、abort |
| PREPARING/PREPARED | 完成prefix、未消費original | recovery_required、abort |
| COMMITTING partial/original | intent＋actual hash＋consumed判定 | recovery_required、rollback |
| COMMITTING全target・正式例外成立 | 元入力再検証＋消費＋rollback方針なし | recovery_required、finalize_success |
| COMMIT_DECIDED以後 | 元successful record intent | recovery_required、forward finalize |
| terminal entry、proof/completion未完 | exact terminal state/manifest/History | recovery_required、finish_terminal |
| terminal proof/completion完成、既知残存物 | composite proof | cleanup_required、cleanup |
| 完全terminal、cleanupなし | composite proof＋normal gate整合 | initialized、actionなし |
| unknown/corrupt/owner証明不足 | 不足/矛盾のtyped evidence | blockedまたはrecovery_required、actionなし |

正確な優先順と全phase/null制約はTransaction文書を正とする。表の「可能」はcallerの自己申告ではない。

## 11. Crash / restart implications

Planningの19地点を維持する。Receipt→Ownerの未完成窓、Owner→journal、apply_time first-entry、intent→PREPARED、COMMITTING→消費、各rename/fsync/progress、decision、History、state、terminal/proof/completion、mutex successorとreleaseにfaultを置く。

throwは通常cleanupを走らせるためprocess killと別試験にする。全targetでもdecision/consumption/rollback方針を確認し、post-decision unknown bytesを強制上書きしない。partial metadataや必要証拠欠損はmanual STOPを正常なfail-closed結果として検証する。

## 12. Slice 6A implementation contract

正式名称：Transaction Evidence / Journal / Recovery Decision Foundation。

実装してよいもの：

- 新closed artifact/schema、hash/projection、固定vectorと完全fixture。
- immutable publisher/cache、full chain validation、safe discovery。
- ownership archive/retirement/Terminal Proof/Completionのpure検証と、排他的Recovery classification。
- publisher I/O・clock・trusted probe inputを分離するtest seam。

実装してはいけないもの：

- canonical/ID/state mutation、rollback/forward実行、History publication。
- normal canonical commit、Request initial dispatch。
- abort/finish_terminal/cleanup実行、claim/retirement runtime、live Recovery adoption、公開CLI、UI/API/DB/Git automation。
- 通常reader guardや旧success-only proofの解除。

fixtureのauthorityはproductionのlive leaseを偽造できない。新module/API名やclass分割は実装判断であり、本書で固定しない。

## 13. Explicit non-goals

実装、production Apply、bootstrap再発行、Planning本文変更、roadmap日程/進捗更新、Feature ID変更、architecture意味変更、古いruntime記述cleanupは行わない。React/Vite/API/auth/DB/JOB-001は非対象。今回PRはmergeせず独立Review & Mergeへ渡す。

H-01修正時のLOW L-01も独立確認した。Transaction正本に残ったliteral\n\n（2段落）と表のliteral\nを実改行へ修正し、意味は変更していない。

## 14. Open issues

| 分類 | 状態 |
| --- | --- |
| 6A blocking | 6A-DG01-01訂正後のself-reviewでは0。H-01訂正時の0判定はReview #2のM-01発見で、M-01訂正・Review #3後の0判定は6A開始時の6A-DG01-01発見で覆った。今回の独立Pre-Intent Abort Contract Review & Mergeを経るまで6Aを再開しない。schema/hash/phase/ownership evidence/terminal proof/action/errorの選択はTransaction正本で確定 |
| later-slice only | 6B〜6Fのmodule分割、adapterの具体API名、CLI optionの配置、対応OS probeの実装方法。正式Linux profileを満たせなければSTOPし、別profileを暗黙追加しない |
| non-blocking | 古いroadmap/runtime表記等は別cleanup候補。本scopeへ混ぜない |

安全条件やfield/enumを後続の「implementation detail」へ先送りしない。実装で本contractが不可能と判明した場合は変更して通さずSTOPし、独立reviewへ戻す。

## 15. Exit criteria・次工程

DG-01〜DG-05のA〜Hを記録し、正式設計へ反映、全cross-reference整合、6A blocking issueなし、docs-only scope、Markdown/fragment・full regression・production inventory一致・PR Actionsを確認する。

6Aの実装終了条件はvalid chainの完全検証、invalid/unknownのdeterministic拒否、pure分類、mutationなし、既存Slice 1〜5回帰維持、各publisher durable boundaryのfailure seamを持つこと。schemaだけ通るhappy pathを完成条件にしない。

次工程は本Design Follow-upの独立Review & Merge。そのmerge後にのみ6Aを開始する。本taskではいずれも実施しない。
