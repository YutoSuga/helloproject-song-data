# FN-004 Final Acceptance

## 1. Executive Summary

**総合判定：BLOCKED**。監査日：2026-11-13（JST）。

FN-004 v1のSlice 1〜6Fについて、正式contractの不変条件を実装・隔離fixtureの実CLI/障害試験・Production読取り監査に対応付けて評価した。テスト成功だけを受入根拠にしていない。

基本workflowと安全側guardの実装を確認しProductionも正常だったが、今回の新しい一括実行でDecision同時更新試験が既知gate系のGATE_CORRUPTによりFAILした。実装修正でなく監査成果物としてFA-M01をOPENで記録し、正式完了とProduction運用開始の判断を保留する。CI/過去のPASSで今回のFAILを代替しない。

本判定はProduction運用開始の承認ではない。今回Production Bootstrap initialize／Apply／Recoveryは実行していない。新規Decision／Plan／Approval／Request作成、canonical/state/History更新、障害注入、自動unlockも行っていない。SCR-002／API／DBの実装、既存実装の修正・再mergeは対象外。

## 2. 対象範囲・監査基準

| 項目 | 固定した基準 |
| --- | --- |
| Repository | YutoSuga/helloproject-song-data |
| 監査main | `e119556c1703e7ea963a327832cacf5a3affb647` |
| PR #84 | MERGED、上記通常merge commit。review fix `8b75098d1d359ac99048e99a748918c0220a26ec`を含む |
| Git | 監査開始・終了のmain/local origin/main/GitHub main一致、開始working tree clean |
| 検証source | 236ファイルのraw SHA256とHEADを含むledger。開始hash `23ba645f4a3251b18b1c5ae58653b7b64bff9cfb9861fb7422510fdb99f68deb` |
| 実装保証範囲 | 既存プロジェクトのNode.js 20以降方針（今回の実測は24.19.0、version matrix試験ではない）、単一authoritative working tree、協調するreader/writer、sync/no-clobber/同filesystem renameが成立するlocal filesystem |
| 監査成果物 | 本報告書のみ。専用local docs branchへcommit。公開要求中断のためremote branch/PRは未作成。mainへ直接commitしない |

正本：[初期化・ID状態](../design/FN-004-初期化・ID状態.md)、[判断モデル](../design/FN-004-判断モデル.md)、[反映計画](../design/FN-004-反映計画.md)、[承認・Request](../design/FN-004-承認・反映リクエスト.md)、[反映処理・復旧](../design/FN-004-反映処理・復旧.md)、[成功履歴](../design/FN-004-成功履歴・読取検証.md)、[CLI・画面連携](../design/楽曲管理のCLI・画面連携.md)、[CLI操作ガイド](../canonical-cli.md)、[データ仕様](../data-spec.md)。[データ一覧](../data-inventory.md)・[CRUD](../crud-matrix.md)・[ライフサイクル](../data-lifecycle.md)は固定SHA時点の補助資料として区別した。

## 3. Slice 1〜6F実装対応表

各PRのmerge commitは監査mainのfirst-parent履歴に実在し、未merge実装を根拠にしていない。#60はCIのfull history、#61は既存Production genesis、#79はknown-mixed正式修正。新しいgenesisは作成していない。

| Slice / merge済みPR | 正式責務 | 実装 | 主な回帰試験 |
| --- | --- | --- | --- |
| 1 / #56 | 14表schema・whole validation・同bytes manifest/JCS | [schema](../../src/canonical-schema.js)、[validator](../../src/canonical-validator.js)、[snapshot](../../src/canonical-snapshot.js)、[hash](../../src/canonical-hash.js) | [canonical validation](../../test/canonical-validation.test.js) |
| 2 / #57 | safe paths・exclusive gate・durable I/O・reader同期 | [repository](../../src/fn004-repository.js)、[gate](../../src/fn004-gate.js)、[persistence](../../src/persistence.js) | [repository](../../test/fn004-repository.test.js) |
| 3 / #59・#60・#61 | Git全parent監査・必須外部宣言・genesis/state・単調high-water | [bootstrap](../../src/fn004-bootstrap.js)、[Git監査](../../src/fn004-git-audit.js)、[state](../../src/fn004-state.js)、[runtime](../../src/fn004-runtime-state.js) | [bootstrap](../../test/fn004-bootstrap.test.js)、[CI checkout](../../test/fn004-ci-integration.test.js) |
| 4 / #63・#64・#65・#66 | Decision/OCC/source binding・Plan・History readonly | [Decision core](../../src/fn004-decision-core.js)、[lifecycle](../../src/fn004-decision-lifecycle.js)、[application](../../src/fn004-decision-application.js)、[Plan](../../src/fn004-plan-application.js)、[History verifier](../../src/fn004-history-verify.js) | [core](../../test/fn004-decision-core.test.js)、[lifecycle](../../test/fn004-decision-lifecycle.test.js)、[Plan](../../test/fn004-apply-plan.test.js)、[History](../../test/fn004-history-readonly.test.js) |
| 5 / #68（contract #67・#69） | 独立Approval/Invalidation・durable Receipt・readonly retry DTO | [schema](../../src/fn004-approval-schema.js)、[application](../../src/fn004-approval-application.js)、[repository](../../src/fn004-approval-repository.js) | [schema](../../test/fn004-approval-schema.test.js)、[application](../../test/fn004-approval-application.test.js)、[response](../../test/fn004-request-response.test.js) |
| 6A / #77 | evidence・immutable Journal・observation v2・pure classifier | [Journal](../../src/fn004-journal-chain.js)、[observation](../../src/fn004-recovery-observation.js)、[classifier](../../src/fn004-recovery-classifier.js) | [schema](../../test/fn004-evidence-schema.test.js)、[decision](../../test/fn004-recovery-decision.test.js) |
| 6B / #78 | target生成・backup/temp・固定時刻・durable Intent/PREPARED | [materializer](../../src/fn004-target-materialization.js)、[prepare](../../src/fn004-durable-prepare.js)、[artifacts](../../src/fn004-prepare-artifacts.js) | [target](../../test/fn004-prepare-target.test.js)、[prepare](../../test/fn004-durable-prepare.test.js)、[SIGKILL](../../test/fn004-prepare-crash.test.js) |
| 6C / #80（contract #79） | ownership/successor・abort/rollback・failure Proof/Completion・retirement | [authority](../../src/fn004-recovery-authority.js)、[executor](../../src/fn004-recovery-executor.js)、[provenance](../../src/fn004-canonical-provenance.js)、[durability](../../src/fn004-recovery-durability.js) | [rollback](../../test/fn004-failure-recovery.test.js)、[known-mixed](../../test/fn004-known-mixed.test.js)、[durability](../../test/fn004-recovery-durability.test.js) |
| 6D / #82 | irrevocable decision・immutable History・成功state・forward Recovery | [success kernel](../../src/fn004-success-finalization.js)、[History publication](../../src/fn004-history-publication.js)、[composite proof](../../src/fn004-terminal-history.js) | [publication](../../test/fn004-success-publication.test.js)、[success Recovery](../../test/fn004-success-recovery.test.js) |
| 6E / #83 | 初回Receiptから通常commit・共通Recovery・reader再開 | [composition](../../src/fn004-apply-application.js)、[normal Apply](../../src/fn004-normal-apply.js)、[terminal runtime](../../src/fn004-terminal-runtime.js) | [Apply](../../test/fn004-normal-apply.test.js)、[crash](../../test/fn004-normal-apply-crash.test.js)、[R83](../../test/fn004-review83-safety.test.js) |
| 6F / #84 | thin public CLI・real TTY・JSON/exit・inspect/run | [entrypoint](../../scripts/canonical-manage.js)、[adapter](../../src/canonical-cli.js)、[parser](../../src/canonical-cli-arguments.js)、[output](../../src/canonical-cli-output.js)、[management](../../src/fn004-management-application.js) | [contract](../../test/fn004-cli-contract.test.js)、[E2E](../../test/fn004-cli-e2e.test.js)、[crash](../../test/fn004-cli-crash.test.js)、[R84](../../test/fn004-cli-review84.test.js) |

6のPlanning #73、follow-up #75、pre-Intent訂正 #76も履歴に含まれる。v1未対応の既存row訂正/削除・new member/video等を、未実装の必須機能とは取り違えない。

## 4. Acceptance A〜E

| Acceptance | 判定 | 根拠・境界 |
| --- | --- | --- |
| A 実装網羅性（A1〜A6） | BLOCKED（A2の競合回帰未達） | 上表のsourceとtests、初回execution composition、公開15 command群＋helpを確認。業務logicをCLIへ重複実装していない |
| B 安全性・障害耐性 | BLOCKED（必須の競合検証FAIL） | 次節の14不変条件を実装で確認し、同じ現行mainのI/O/SIGKILL/競合試験で検証。協調FS/working treeの保証範囲を超える主張はしない |
| C CLI操作性 | PASS WITH LIMITATIONS | Productionはstatusのみ。全mutating CLI workflowは独立identityのtemp repository・実PTY/子processで実行 |
| D Production整合性 | PASS | 既存genesis/initial stateはvalid、全14表valid、History0、pendingなし、187 reachable commit監査complete。前後17ファイルhash同一 |
| E リスク・運用制約 | BLOCKED（FA-M01） | gate競合が必須検証を実際に阻害した。時間変動も根治未確認。single authoritative tree/serialized local運用等を明示。FA-L01のstatus proseは現行実装一覧の代わりにしない |

Aの下位項目も分離して確認した。

| 項目 | 契約・実装対応 | 監査結果の根拠 |
| --- | --- | --- |
| A1 Bootstrap/ID | 初期化契約、Slice1〜3 | canonical/hash/Git/external declaration/instance/genesis/state/high-water、再初期化防止。Productionのvalid genesisとfixture初期化を分離 |
| A2 Decision/Plan | 判断モデル・反映計画、Slice4 | revision/confirm/source fingerprint/OCC/予定ID/insert-reuse-no_op。source/hash/registry/state変更はstale、Plan生成は非Apply |
| A3 Approval/Request | 承認・Request、Slice5/6E | exact Plan承認とReceipt、hash/actor/purpose/identity、初回だけdispatch、retryは保存原本のreadonly評価 |
| A4 Transaction/Recovery | 復旧契約、Slice6A/6B/6C/6E | prepare/whole target/durable Intent/ID消費/固定順commit、known-mixed rollback、OS ownership、crash/restart、Reader STOP |
| A5 Success/History | 成功履歴＋terminal契約、Slice6D/6E | immutable chain/set/prefix/record/time、state遷移、Proof/Completion、composite proofによる通常reader再開 |
| A6 Public CLI | interface＋操作ガイド、Slice6F | 公開command inventory、正規PTY、非TTY/CI拒否、JSON/exit、readonly result/history、明示Recovery hash/action |

新規安全性上のformal ambiguityは0。古い実装進捗の文章と現行のnormative schema/procedureを分離し、実装に合わせたcontract緩和はしていない。

## 5. 安全性・不変条件の証拠

| # | 不変条件 | 実装のguard・検証根拠 |
| --- | --- | --- |
| 1 | CSVだけが楽曲正本 | schema/snapshotはdata全14表を読む。Plan/History/公開JSONは派生/証跡。materializerは既存rowを保持し、許可9表のinsertだけを追加 |
| 2 | 未承認Apply不可 | Approval作成時にcurrent Planを検証。新規ReceiptはApproval全hash・actor・purpose・intended Request・repositoryをexact照合。TTY確認前にApproval/Receiptを作らない |
| 3 | stale Decision/Plan拒否 | immutable revisionとhead CAS、effective registry、candidate fingerprint、14表manifest/state/History/rulesをPlan再生成と比較。最初の置換前にもowned guardで再検証 |
| 4 | high-water非巻戻し | consumed/terminalの完全state遷移を証明。失敗afterは消費済み上限/eventsを保持。state backup全体を復元しない |
| 5 | ID再利用禁止 | genesis/current/完全Git履歴以上の上限、連続allocation ranges、Plan mappingsとeventsの一対一。Recoveryは消費状態を照合し二重incrementしない |
| 6 | Request二重適用防止 | existing Request lookupを新規受付より先に実施。同payloadはreadonly responseへ戻りexecuteへ進まない。History coverage/Decision identityも二重成功を拒否 |
| 7 | 排他・authority | 共通wx gate、nominal WeakMap capability、dev/BigInt inode/bytes、owner終了の実OS証明、immutable連続claim、fresh observation/hash/actionをmutation直前に再検証 |
| 8 | 成功決定前のfailure側 | PREPARING(null)→ABORTED(null)は合法。known-mixedはexact O/Tだけでなくconsumed state・commit/逆順restore trace・全endpoint/evidenceが必要。UNKNOWN/矛盾はSTOP |
| 9 | 決定後rollback禁止 | classifierとexecutorのsuccess-side guard。COMMIT_DECIDED/当該History以降は元record/timeでforwardのみ。正規all-target成功例外もconsumed/入力valid/rollback方針なしに限定 |
| 10 | History不整合検出 | schema/hash/chain/set/index/Plan-prefixの全件検証、no-clobber、exact record再読込。fork/欠番/異identity/異内容/temp不正をskipしない |
| 11 | 不完全状態をREADYにしない | runtimeはpending/未完了Receipt/Journal、Proof/Completion不足、cleanup/ownership不完了をblock。success-only proof不足をboolで成功にせず、独立composite proofを使用 |
| 12 | 禁止RecoveryはSTOP | partial/unknown/unbound barrier、Owner不在、別host/boot/PID namespace、PID再利用、旧token、action不一致ではactionなし。時刻/PID不在だけでunlockしない |
| 13 | CLIのeffect/exitを正しく伝達 | R84-M02は失敗後のfresh readonly再観測でのみknown appliedを付加。元error/cause/path/phase/published/descriptor保持、committed pendingはexit7。不明を成功DTOへ変換しない |
| 14 | 外部変更・Git不整合検出 | 完全origin/main graph/objects監査、固定Git identity、同bytes manifestとper-publication guard。非協調writerのcheck/rename間raceまで防げるとは主張せず、運用で禁止 |

Known-mixedの代表例 `songs=TARGET / song_artists=ORIGINAL` と逆方向restoreは、semantic FAILを保持したまま正式trace下のrollbackだけを許す。UNKNOWN・arbitrary O/T・state矛盾・COMMIT_DECIDED/成功History後には適用しない。rollback終端はAll-Original exact＋whole validation＋durability再確認が必要。

Terminal priorityはCompletion→Proof/完成proof intent/terminal journal→成功方針→pre-terminal predicate。Proof-onlyはfinish_terminal、Proof+Completionはcleanup、Completion-onlyはintegrity conflict。RETIRING/RETIRED/SEALEDからsemantic再実行しない。永久anchor/claim/retirementとProofをGCしない。

R77/R78、H-01/M-01、6C-DG05-01、R80-H01/M01/M02、R82-M01〜M03、R83-M01〜M04、R84-M02/L01の回帰を現行sourceと対応testsで確認。特にR83-M04はMap作成前に全refを独立検証し、同path異内容を拒否する。

## 6. CLI操作性

`npm run canonical:manage -- <command>`のstatus、init check/initialize、Decision template/import/show/validate/confirm、Plan create/show/check、Apply、result、History show、Recovery inspect/runをsourceと実process E2Eで照合した。helpも提供される。

| 検証 | 確認内容 |
| --- | --- |
| Bootstrap | 独立fixtureで必須external declaration→audit hash→real TTY確認→initialize。取消し・非TTY・valid再送での既存identity保持/再発行なし・marker片側を検証 |
| Decision/Plan | 外部strict JSONからservice採番、同mutation再送、head OCC、confirm、Plan create/show/check。readonly証跡hash不変 |
| Apply | repository/変更内容/予定ID/reuse/no_op/warning/変更CSVをstderrへ表示し[y/N]確認。確認後に独立Approval→durable Receipt→通常executor |
| result/History | 元identity・時刻・IDを保持しreadonly評価。四軸artifact/readiness/diagnostics/resultを分離、成功Historyだけでcleanupを隠さない |
| Recovery | inspectとrunを分離。明示tx/hash/唯一action、排他下の再観測、successor/終了証明、元transactionのrollback/forward/terminal cleanup |
| Negative | 不正/重複option、`--$id`、不正ID/hash/revision、UTF8/duplicate JSON member、stale/conflict、非TTY/pipe/CI/--yes、取消し、permission、stale hash/action、UNKNOWN拒否 |
| 出力 | stdout単一JSON、prompt/Receipt案内stderr、stack/secret非露出。正式codeでexit0〜12をprojectionし、取得成功とApply可能を分離 |
| Crash | 実SIGINT/SIGKILLとCLI再起動、Receipt/owner/prepare/ID/CSV/decision/History/state/Proof/Completion/retirement境界を検証 |

実TTYは[PTY helper](../../test/fixtures/canonical-cli-pty.py)のkernel PTYを使用する。CLI executableにfake TTY/actor/service/forceのoption/env hookはない。private test process seamをpublic commandとして公開していない。

[fixture](../../test/fixtures/durable-prepare.js)はtmpdirのmkdtempへsynthetic CSV/stateを作り、独立Git repositoryとorigin/mainを構築する。[Plan fixture](../../test/fixtures/plan-input.js)はrandom RepositoryIDを発行し、Productionのidentityを使わない。CLI子processのcwdもそのtemp root。Productionへ書くtest setupではない。

設計例の`init --check`にも実装では`--external-declaration <file>`が必須。この仕様は操作ガイドに明示され、省略・推測補完はしない。Productionでは新たな外部宣言が提示されていないためinit check/initializeを実行せず、既存genesisのstatusと読取り監査を使用した。fresh audit/initializeの操作性はfixtureで検証する。

意図的にCLIへ公開しない操作はDecision cancel、独立Approval/Invalidation操作、Request再submit、batch複数Plan、candidate削除/status変更、既存row更新/削除、force patch/unlock。内部serviceの存在とCLI公開範囲を混同しない。

## 7. Production読取り専用監査

| 項目 | 実測 |
| --- | --- |
| status | 実CLI exit0、outcome READY、readiness initialized、canonical_effect none、diagnostics[] |
| repository identity | `repo_fde45556-3600-4434-82b2-05cb36841517` |
| bootstrap hash | `08231cac2581b4518d1052672a0842422f2914f7a4c2865743966a1f2277a098` |
| state hash | `e67375c7619ecaa49fcc2a38c35b8c058ef77c6427caec1748d2a4d51d38dc7f` |
| state | generation0、allocation_events[]、pending null。再初期化/巻戻しを要求する不整合なし |
| History | count0、head=bootstrap hash、last_apply_id null。validated genesisを根拠に空集合と証明 |
| whole canonical | 全14表validation PASS、PK/FK/schema/date等diagnosticsなし |
| canonical manifest | `873c96ebee0003d09afeb8c13346d7fa8b3dcf3bbf6d8ec48dad1f31f88ae39f` |
| Git監査 | origin/main固定SHA、187 reachable commits、all parents、complete true、shallow false、必要tree/blob parse成功 |
| runtime | 未完了Request/Transaction・pending・Recovery/cleanup待ち証拠なし。未知artifactはskipしない |
| Productionファイル | 14CSV＋bootstrap＋state＋song-candidates、17 files |
| 開始/終了基準SHA256 | `f7062983872a7e79f8fa99bf396429124437b62aa0d724df761b7ab687da1cf0` / `f7062983872a7e79f8fa99bf396429124437b62aa0d724df761b7ab687da1cf0`（17 files、完全一致） |
| Git/生成物 | 監査main/refとsource不変、data/staging/生成物diffなし、監査時tree clean。report-only branch追加は別commitでありapp/dataを変更しない |

high-waterは `A0 B0 C86 G3 H1 J120 L136 M0 O0 P17 R0 T0 V0 W90`。genesis/current/完全Git歴史maxima以上を全namespaceで確認。canonicalはworks90、songs121、artists3、creators86、members17、releases136、release_tracks562、song_artists124、song_creators397、song_performers173、残り4表0行。

statusのsourceを先に確認した。domain read-onlyは正式Bootstrap contractの定義に従い、共通gateの通常の一時取得・本人releaseだけを含む。既存lock削除・自動Recovery・domain artifact更新はない。status前後と監査終了時に、隠しentryも含む対象全ファイルのraw hashとentry countを比較した。source/Productionに差分がなければ「本監査が変えていない」と証明できるが、消失した全履歴や外部利用をhashだけで完全検知できるという主張ではない。

## 8. テスト・build実績

| 検証（同一unfiltered実行内の分類） | pass | fail | skip | cancelled |
| --- | ---: | ---: | ---: | ---: |
| CLI focused | 44 | 0 | 0 | 0 |
| CLI実process/E2E（focused内数） | 41 | 0 | 0 | 0 |
| 6A | 48 | 0 | 0 | 0 |
| 6B | 52 | 0 | 0 | 0 |
| 6C | 60 | 0 | 0 | 0 |
| 6D | 57 | 0 | 0 | 0 |
| 6E | 79 | 0 | 0 | 0 |
| Bootstrap/CI checkout | 26 | 0 | 1 | 0 |
| Decision | 45 | 1 | 0 | 0 |
| Plan | 32 | 0 | 0 | 0 |
| Approval/Request | 40 | 0 | 0 | 0 |
| FN-004全体 | 546 | 1 | 1 | 0 |
| 全suite | 713 | 1 | 1 | 0 |

グループは重複するため合算しない。別runのPASSを加算していない。

開始 2026-11-13 00:41:55 JST、終了 2026-11-13 03:54:14 JST。実際のnpm exit **1**、全715 tests、timeout0/todo0。file71件（登録test file集計58件＋helper smoke13件）を重複なく照合。TAP/JSONL最終globalとfile合計が一致した。**一括は完了したがFAILを含むためPASSではない。**

条件：Node24.19.0、2CPU quota、file並列度1。test内の明示Promise.allSettled競合は残る。開始/終了main SHAはともに `e119556c1703e7ea963a327832cacf5a3affb647`、236ファイルsource ledger SHA256はともに `23ba645f4a3251b18b1c5ae58653b7b64bff9cfb9861fb7422510fdb99f68deb`。全ログ・actual exit・終了時刻・source-afterを保存した。

```sh
npm test -- --test-concurrency=1 --test-reporter=tap --test-reporter-destination=/workspace/scratch/fn004-final-acceptance-full.log --test-reporter=/workspace/scratch/slice6e-events.mjs --test-reporter-destination=/workspace/scratch/fn004-final-acceptance-full.jsonl
```

skip1はactual Actions checkoutだけを対象とする既存CI integration test。理由は `Checks the actual Actions checkout; local fixtures run below`。新skipなし。I/O injection、SIGINT/SIGKILL/restart、Request concurrency/idempotency、Reader/Recoveryは当該全suite内で実行したが、Decision競合のFAILはFA-M01として保持する。

TAP SHA256 `b22f57d04bfae97f35ac8fcd23764ab95fd57a3510c50f4376850d57b890f574`、JSONL SHA256 `106aed29dbabea681bc1f2b1e3f739396e12ae86591f1d2114191c795d161591`。

監視中にexec-server接続が切れ、環境がoffline/unavailableとなった。復帰後、同じPID311742/startticks/bootのjobが存続しログも進んでいることを確認した。重複起動はしていない。接続断をtest終了やPASSと推測せず、元jobのactual exit/global/source-afterを確認してから本集計を作成した。報告branch作成要求も一度中断されたが、remoteにbranchが存在しないことを再取得し確認した。

過去のSlice 6F最終値714pass/0fail/1skipと今回の実測の差異：今回は713 pass/1 fail/既存skip1、cancelled0、exit1。差分はFA-M01の1件のみで、追加testやsource変更による件数増減ではない。失敗は約1.061秒のassertionでありtimeoutとは区別する。部分ログ・単独PASS・CI SUCCESSでは一括完了を代替していない。runtime修正やtimeout/assertion緩和、新skip追加はない。

rankings validation/site buildはactual exit0、anomaly_count0、generated artifact diff0、git diff --check PASS。Markdownはmainで464 local links/16 fragments、report追加後で551 local links/16 fragments、missing0/broken0を確認した。main [Actions run42926824189](https://github.com/YutoSuga/helloproject-song-data/actions/runs/42926824189)（workflow377442041）はSUCCESS、Test/build job130215294885とDeploy job130241043844も実際にSUCCESS。これは今回のlocal FAILを消す根拠にはしない。report PRは未作成で、報告書headのCIも未実行。公開要求中断後にGitHub branch一覧を再取得し、対象remote branchがないことを確認した。main CIと未作成report PRのCIを混同しない。

## 9. Findings

| ID | Severity / Slice | 発生条件・期待/実際 | 影響・推奨対応 | Acceptance |
| --- | --- | --- | --- | --- |
| FA-M01 | MEDIUM / Slice2・4、既知問題の受入再現 | `draft/confirm and confirm/cancel races cannot lose an update`が期待DECISION_HEAD_CONFLICTに対しGATE_CORRUPTでFAIL。file並列度1でもtest内部のPromise.allSettledは並行。winner1件のassertは通過したが、その後半の検証へ進めない | 共通gateのwx/metadata検査窓に関係する既知可用性問題。新規データ破損は確認していないが、必須の現行main一括検証が未達。別fix PRで公開/検査競合を設計・修正し、deterministic regressionと全suiteを再検証する。corruptをBUSYへ一律に丸める/自動unlock/期待assert緩和はしない | OPEN、blocking。CIや過去/lucky再実行PASSで置換しない |
| FA-L01 | LOW / 横断文書 | 現行sourceでは6D〜6F接続済みだが、正本Decision/Plan/Transaction冒頭に現在形の「runtime未実装」が残る。現在の進捗注記は実装済みAPIへの対応を示すべき。#81のI/S表は固定SHA時点の正しい調査として別扱い | 誤った運用理解を招く文書保守問題。schema/安全手順の矛盾や未実装codeの証拠ではない。本表/実装対応表とCLIガイドを現行auditの根拠とし、別docs PRで正本status注記/現行対応への案内を整理する。固定SHA調査の史実は書き換えない | OPEN、非blocking。今回のreport-only PRへ無関係な一括cleanupを混ぜない |

FA-M01の再現証拠：今回のTAP/JSONLにactual GATE_CORRUPT / expected DECISION_HEAD_CONFLICTを保存。対象assertionに元nested causeは残らないため、自然発生caseがwx→write窓かrelease→read窓かまでは特定していない。別の隔離harnessでwx後・metadata write前をpauseし、main/旧a4baseline双方のGATE_CORRUPT/cause PERSISTENCE_PARSE_FAILEDを確認、gate/persistence・対象test・Decisionのgate retry関数は旧a4baselineとbyte一致。保存済みbaselineのsrc全fileもGit objectに照合した。自然発生頻度や窓の変化は未測定であり、新規regressionと断定せず、既存のgate inspection競合系として修正調査へ引き継ぐ。

再現手順はProductionをrootにせず、`mkdtemp(tmpdir())`の独立rootで行った。gate moduleを監査mainと旧baseline `a4a0fd0df2fdaa82ed8c0c1e740add8146bcd0d4`からそれぞれimportし、trusted `io.open` seamで最初の`wx` open後のhandle.writeFileだけをPromiseで停止する。その間に同じtemp rootへ二つ目のacquireGateを実行すると、両checkoutとも次の結果を返した。最初のwriteを再開し、元handleの正規release後にtemp stagingが空であることをassertした。harness自身のexit0は「既知STOPを再現できた」ことを意味し、一括試験のPASSではない。

```json
{"code":"GATE_CORRUPT","cause":"PERSISTENCE_PARSE_FAILED"}
```

自然発生FAILの再現コマンドは第8節の同じunfiltered npm testであり、deterministic seamと同一の自然発生原因を断定するものではない。gateのraw SHA256は両checkoutで `5947877c2a627c9a254fde1d27e879af9cdec17ebca68487f208b89337e0416f`、対象Decision testも `ef9de1be13a54df1382cd47449a4b76a8d30b5d30efbb6d1512f2436f88995f1`で一致した。

FA-L01再現：上記正本introの未実装断定を、[通常composition](../../src/fn004-apply-application.js)→[executor](../../src/fn004-normal-apply.js)→[CLI](../../src/canonical-cli.js)とE2Eへ照合する。原因は段階実装時の進捗説明の未更新であり、normative schema/procedureは独立して監査した。今回mainへ実装修正はしない。

全Finding：CRITICAL 0、HIGH 0、MEDIUM1（既知問題再現FA-M01、OPEN）、LOW1（新規FA-L01、OPEN）。新規runtime Critical/High/Mediumを発見したという分類ではないが、既知問題も必須検証を阻害する限り受入blockに含める。旧R84-M02/L01は修正commitを含むmainと回帰試験でCLOSED維持。V84-01も前工程でCLOSED、今回の新しい一括実行を別の証拠として記録した。安全性に影響するformal ambiguity：0。

## 10. 既知リスク・運用制約

| 既知項目 | 根拠・影響 | 運用上の許容範囲・今後 |
| --- | --- | --- |
| Decision gate metadata公開競合 | wxでpathが見えてからmetadata writeまでの窓を隔離fixtureで停止させると、main/旧a4baseline双方がGATE_CORRUPT/PERSISTENCE_PARSE_FAILED。gate/persistence source差分なし。自然発生頻度は未測定 | データ変更前に安全側STOP/CLI exit8、他ownerのunlockなし。ただし可用性障害であり無条件許容しない。今回FA-M01として必須テストを実際に阻害したため、直列運用という回避策だけで受入FAILを免除しない。全reader/collector/build/Git/manual editも含む単一操作者の直列運用に限定。部分lock/Owner不足時はCLIだけで解消できないケースがあるため証拠を保全し専門調査へ。別fix PRで公開窓を対処し、多ユーザーSCR-002前に再評価 |
| テストwall-clock変動 | 過去の並列file実行でSIGKILL3件timeout。直列一括PASSは根治の証明ではない | CI安定性と実装の意味的安全性を分離。resource/parallelism/開始終了/sourceを記録し、失敗を再実行成功だけで消さない。上限・assertionは緩和しない |
| 単一authoritative tree | cloneは同じlineage IDを継承するが、独立cloneの同時採番や分岐stateのmergeは保証外 | 複数clone/hostのwriterを併用しない。origin/mainを正規手順で確認し、未完了時のcheckout/reset/rebase/直接編集禁止 |
| OS/filesystem | directory/file sync、no-clobber、同filesystem rename、Linux boot/start/PID namespace証明に依存 | NFS/SMB/同期folderへ保証を拡張しない。別host/boot/PID再利用/証明不能ではmanual STOP。SIGKILL試験は実power cut/hardware flush保証の代替ではない |
| 不明な中断証拠 | Receipt-only Ownerなし、partial/unanchored barrier、corrupt/unknown bytes等は自動処理不可 | 新Apply・新ID発行・force unlockで解消しない。元Requestでresult→inspect、唯一actionが検証できる場合だけ明示run。actionなしは証拠保全と別途調査 |
| Git/backup責任 | Apply成功はGit commit/push/mergeやsite Deployと別。state/proof/runtime-local evidenceを失うとGitのCSVだけでは復旧不能なことがある | 成功後にcanonical/Decision/Approval/History/state/Proofのdiffを確認。稼働前に整合した全証拠の保管・quiesced backup手順を人間が用意。過去CSV/stateだけを戻してID再利用しない。災害復元/全台帳巻戻しは自動保証外 |
| Git非管理とignoreの差 | `git check-ignore --no-index`でReceipt/common gateはignore、Plan/通常transactions/recovery-ownership/recovery barrierは非ignoreと確認。[現在のignore](../../.gitignore)はGit非管理方針全体の強制ではない | Git操作はCLI外であり、契約違反の無選別commitを自動で防がない。`git add -A`やstaging全体の無選別追加を避け、canonical/Decision/Approval/Invalidation/History/state/Proofをdiffレビューして選別する。runtime-local証拠は別途保全。ignore方針整備は別PR候補。これをmanaged artifact削除/GCの許可と解釈しない |
| v1の適用・採番範囲 | 適用済みDecisionの別revision、既適用candidate coverage、既存row訂正/削除は再Applyで回避できない。ID上限99999・欠番再利用禁止 | 新Decision/Planを作って適用済み制約を迂回しない。訂正やcapacity拡張は別設計/操作判断。candidate自動整理や複数Plan batchも提供しない |
| 保持・規模 | v1はProof/Owner/input/Intent/Journal/Completionとownership archiveをGCしない。全History/証跡検証を使用する | storage確保と証拠backupを運用で用意。大量履歴/高頻度multiuserの性能SLAは本fixture監査で証明していない。不要と推測して台帳を削除せず、規模拡張/GCは別設計で評価する |
| CLI-only / trust | local OS actorはWeb認証ではない。hashは署名/authorizationの代替ではない | filesystemへアクセスできる信頼済みoperatorに限定。backend認証や任意client actorを暫定公開しない |

## 11. Production運用可否

**本報告はProduction初回Applyを許可・実行しない。** 現在のgenesisがvalidであることと、具体的Planへの人間承認は別である。

今回のBLOCKEDを解消する別修正・全件再検証・再受入が先決であり、本監査として本番初回Apply可とは判定しない。その後のv1限定local運用でも、人間が上記制約を明示的に受け入れ、単一authoritative tree・全操作直列化・対応FS・証拠保管/障害手順を確認した場合に限って運用開始判断の対象にできる。通常の並行read/write・複数clone運用を必要とする場合は、その要件に対して現状のgate可用性制約を許容しない。別途fix/再検証が必要。

初回Applyは別タスクで、現canonical/Git/ID/History/readiness、candidate sourceと人間のidentity判断、confirmed Decision・最新Plan・TTY表示を再確認し、独立Approval→元Requestで実施する。今回の旧Plan/テストidentityを流用しない。既存bootstrapを再initializeしない。

## 12. SCR-002への引継ぎ

利用基盤：Decision/Plan/Approval/Requestの共通service、通常canonical orchestration、四軸response DTO、History/state/composite proof、stale/OCC、元Requestのreadonly結果照会。business logicや独自CSV writerをUIへコピーしない。

未提供：Browser/HTTP API、認証済み管理者backend/session/CSRF等、DB、6 viewのUI、Git差分表示API、複数Plan batch承認、candidate自動削除/status更新。SCR-002のbootstrap/Recovery実行はv1ではCLIへ案内し、公開APIへ接続しない。private dependency seams、actor/lease、force flagをclient入力にしない。

設計・mock検討は別タスクで進められるが、今回のblock解消/再受入と、実write接続前にactor認証・request identity保持・OCC/承認token・連打/refresh/timeout・pending/cleanup表示・共通gateの競合/直列化方針を確定する。既知gate競合は引継ぎ項目であり、多ユーザー接続を無条件に開始できるという受入ではない。本タスクではSCR-002/API/DBを実装しない。

## 13. Final Acceptance総合判定

**BLOCKED**。

現在のProductionがvalid genesisであること、core安全guardがfail-closedであること、CLIや6A〜6Fの多くの回帰がPASSしたことは確認できた。一方、要求された現行mainの一括検証に実際のFAILがあり、既知gate競合がDecisionの通常競合workflowと検証安定性に影響した。運用直列化という回避策やCI/過去のPASSだけで必須検証を免除せず、別fix PRと新しいmainでの再受入が必要と判定する。FA-L01は非blocking LOWだが残す。新規の安全性上のformal ambiguityやcanonical破損を発見したという判定ではない。

## 14. 未完了事項・次の作業

1. local branch `docs/fn004-final-acceptance`の報告書commitを復旧確認し、通常pushでreport-only PRを作成して独立レビューとCI確認。現在remote branch/PRは未作成。mainへ直接commitせず、自動mergeもしない。
2. FA-M01を別fix PRで調査・修正。gate metadata公開/検査窓、破損lock拒否、同時Decision更新、実CLI code、crash/ownership/durabilityを回帰検証してmainへ取り込んだ後、新しい固定mainでFinal Acceptanceを再実施する。
3. FA-L01は別docs PRでstatus注記を整理。固定SHA資料の史実やnormative contractを黙って書き換えない。
4. 別途人間によるProduction運用開始判断。初回Apply、bootstrap再作成、Recoveryを本監査の続きとして自動実行しない。
5. SCR-002は別工程。認証/接続/並行性の設計と既知制約の評価を経て着手する。

検証ログは作業環境の`/workspace/scratch/fn004-final-acceptance-*`に保存。TAP/JSONL・actual exit・source-before/after・集計・Production inventory・audit summary・gate再現を区別する。過去のreview84ログを上書きしていない。

公開状況：報告本文commit `7f02277fbf891bc778d2e5e2d6025fa363f1dbf4`はlocalに存在する。branch作成/fetch/push要求がそれぞれ完了確認前に中断され、最終GitHub照会では対象remote branchなし。今回の監査結果を未公開のまま消失させないため、local報告書と完了ログを保全した。公開の再開時はlocal/remoteの実際のheadを先に照合し、重複作成・force pushをしない。最終local HEADは本書の公開状況追記commitを含むため、上記本文commitと区別する。
