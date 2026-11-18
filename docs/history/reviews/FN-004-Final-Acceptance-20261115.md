# FN-004 Final Acceptance 再実施（2026-11-15 UTC）

判定：**PASS**。FA-M01は**CLOSED**、FA-L01は**OPEN / LOW / non-blocking**。正式受入基準を緩和せず、以下の今回実測と修正照合に基づき判定した。Production運用開始・初回Applyの承認ではない。

## 対象・証拠の区分

対象はPR #88 merge後、開始時にfetchして固定したmain `a265e8a165e13f2fdd525a79cb7bd86ede00217b`。検証開始は2026-11-15T13:37:20Z。検証root `/workspace/helloproject-song-data` はdetached HEAD、開始working tree clean。保存用は別worktree `/workspace/fa-final-report`、branch `docs/fn004-final-acceptance-20261115`。保存commitは受入対象SHAに含めない。

今回の一次証拠は [archive](archive/fn004-final-acceptance-20261115) の全suite TAP/actual exit、環境・source/Production前後hash、Production status/whole validation/Git監査、build・CLI help、固定SHAのCI取得記録。個別実行のPASSを全suiteへ加算しない。CIはGitHub runnerの実行を今回取得した外部証拠で、今回ローカルで独立実行した結果とは区別する。

過去証拠は [旧監査](FN-004-Final-Acceptance.md) §4–10/13–14、[原本回収記録](FN-004-Final-Acceptance-Recovery.md)、[PR88検証報告](FN-004-FA-M01-Validation-20261115.md) とそのarchive。PR88 archiveのSHA256SUMSは今回全件照合成功。旧監査本文・過去FAILを上書きしない。

正式基準は旧監査が列挙した6正本、CLI契約・操作ガイド・データ仕様、およびPR85承認済みD1–D4/§10.1をPR86が正式設計へ反映した差分。進捗説明とnormative schema/procedureを分離し、実装に合わせた契約緩和を行わない。

## Acceptance A〜E

| 基準 | 今回判定 | 根拠と境界 |
| --- | --- | --- |
| A 実装網羅性 A1–A6 | PASS | 旧監査§3/4のSlice1–6F対応を継続評価。PR86以後のsrc/test/scripts/.github/package.json差分なし。Bootstrap/ID、Decision/Plan、Approval/Request、Transaction/Recovery、Success/History、public CLIを全suiteで検証 |
| B 安全性・障害耐性 | PASS | 旧監査§5の14不変条件に対応する全suite。Gate・OCC・元Request保持・stale拒否・high-water/ID非巻戻し・成功決定後forward・UNKNOWN停止・durability/ownership・実SIGKILL/restartを含む |
| C CLI操作性 | PASS WITH LIMITATIONS | Productionはstatus/helpのみ。mutating workflowは独立temp identity、実PTY/子process。公開command/JSON/exit、非TTY/CI拒否、取消し、元error/effect/readinessの分離、明示Recoveryを検証。ブラウザAPI・未公開command・multiuser運用は保証しない |
| D Production整合性 | PASS | READY/initialized、diagnostics[]、valid genesis/History0、14表validation、完全Git監査、前後hashを照合 |
| E リスク・運用制約 | PASS | FA-M01の原本要求と修正/回帰を照合。FA-L01は原本どおりLOW/non-blockingとして残す。対応FS/単一authoritative tree/協調writer等の制約は維持 |

A1はgenesis/ID/Git完全履歴、A2はDecision OCC/confirm/source binding/Plan stale、A3はexact承認/Receipt/retry readonly、A4はprepare/consume/commit/known-mixed/OS authority、A5はimmutable History/state/Proof/Completion/retirement、A6はthin CLI/TTY/JSON/exitの対応を評価した。旧監査の実装対応表を新規実装の証拠として再作成せず、変更範囲のsource確認と今回回帰を対応付けた。

## FA-M01 原本照合と判定

原本§9：期待DECISION_HEAD_CONFLICTに対してGATE_CORRUPTで失敗し、winner後の検証に進めなかった。要求は別fix PRによる公開/検査競合の設計・修正、deterministic regression、全suite再検証。破損をBUSYに一律変換・自動unlock・期待assert緩和を禁止する。原本の自然発生caseが特定の窓だったと断定する要求や、失われた過去stackの回収を独立した永久CLOSED条件として追加しない。

PR85設計はmerge `3f3c67b4de89a0b009976d01dc141aab1b686ee4`、PR86修正はmerge `bc16c362922835d2af1c98fd833032257a9c9473` として対象mainに含まれる。今回取得したPR86本文と現sourceを照合した。

- `fn004-gate-publication.js`は同directoryのwx/0600 candidateをwrite/sync/readbackし、完成inodeをexclusive hard linkでfinalへ公開。directory sync・同inode/bytes確認後にlease/callbackを許す。rename等の弱いfallbackなし。
- EEXIST後の正規release/ENOENTはfresh exclusive試行へ、安定validな他ownerだけBUSY。不正metadata/permission/未知versionはSTOP。retryは8回/1 monotonic秒、Decision既存5秒予算を共有。callback開始後は自動retryしない。
- releaseはauthority失効後にunlinkし、後続ownerを削除しない。曖昧な公開はleaseを返さず証拠を保持。candidateはauthorityや一般cleanup対象にしない。
- 元 `draft/confirm and confirm/cancel races cannot lose an update` のassertionは維持され、今回全suite `ok 288`。追加GP12はwrite停止を強制し、one winner/HEAD_CONFLICTとstate不変をassertし `ok 287`。GP01/02/04/06/08/09等で公開順序・EEXIST/ENOENT・破損停止・実crash・releaseを検証する。

PR86のpre-fix forced regression失敗・修正後成功、Node20/24各79 PASS、PR88の795 PASS/0 FAIL/既存SKIP1は**過去証拠**。今回の元競合とGP12成功および全suite完了結果を別に使用し、過去CIやlucky再実行だけで原本FAILを置換しない。

FA-M01判定：**CLOSED**。原本のblocking理由に対して、承認済み設計・PR86でmerge済みの修正、期待assertionを維持した元競合と強制GP12回帰、CLI/crash/ownership/durabilityを含む新固定mainの省略なし全suite完了を確認した。破損停止や運用制約は維持されている。単なるlucky再実行ではなく修正の仕組み・deterministic証拠と全件証拠を合わせた判定である。過去初回の原因未確定は解消済みとはせず、下記の残存不確定性として明示する。

## candidate EPERMと過去初回失敗

今回sandbox内で `node --test-name-pattern='GP11/14' test/fn004-gate-candidate-integration.test.js` を実行しexit1。fixture childの `execFileSync('git', ... init ...)` が `spawnSync git EPERM` を返すstackを取得した。fixture呼出し（test107行）で失敗しており、後続のstale token/abort/retirement assertion未到達。Git status0とerror EPERMは共存し、status0だけでfixture成功とはしない。

同じ固定sourceのsandbox外全suiteでは同ケースが `ok 396`。今回観測した失敗はfixture準備段階の環境依存エラーであり、Gate assertion違反とは区別する。正確なOS内部/policy ruleは未特定で、特定seccomp ruleやgit一律禁止とは断定しない。

過去初回（bc16c362）の保存ログはファイル単位失敗だけで個別assertion/errno/stackがない。PR88も同一原因を証明していない。今回のEPERMで過去初回を説明済みにせず、**過去初回原因は未確定のまま**残す。これは原本FA-M01のGATE_CORRUPT/HEAD_CONFLICT失敗、今回のfixture EPERM、過去初回の情報欠損という別々の事実である。

## FA-L01 現状

**OPEN / LOW / non-blocking**。Decision・Plan・Transaction正本冒頭の「runtime未実装」が今も残る。現行service/通常Apply/CLIと一致しない進捗注記だが、原本はnormative schema/安全手順の矛盾や未実装codeの証拠とは判定していない。今回もblockingへ格上げせず、一般docs修正は混ぜない。固定SHA史実を保持した別docs整理が必要。

## 今回独立実行・CI

| 今回の検証 | 結果・証拠 |
| --- | --- |
| 省略なし全suite | `npm test -- --test-concurrency=1 --test-reporter=tap`、通常runner（sandbox外）、796 tests / 795 PASS / FAIL0 / 既存SKIP1 / cancelled0 / todo0、actual exit0。4 suites、最終plan `1..706`（nested込み796）。`full.tap` / `full.exit` / `summary.json` |
| 全suite時刻・時間 | 開始baseline 13:37:20Z、actual exit file mtime 15:14:29.753390Z、終了観測15:14:35.825863Z。runner duration 5,828,712.359868ms（約97分9秒）。mtime/観測時刻を厳密なprocess終了時刻の代用にはしない |
| 環境 | Node24.19.0 / npm11.9.0 / Git2.52.0、Linux。file並列度1、test内部の明示競合は維持。assertion/timeout/skipを変更せず、filterなし |
| 既存SKIP1 | `actual GitHub Actions checkout has complete origin/main history`、理由 `Checks the actual Actions checkout; local fixtures run below`。local Git fixturesは同runで成功し、Actions実checkout専用checkは固定main CIで実行された。CI偽装なし |
| CLI | status/help exit0、command inventoryを保存。全suiteの実TTY/公開CLI/JSON/exit/SIGINT/SIGKILL/Recovery testsも成功 |
| rankings/site | `npm run rankings:validate` / `npm run site:build` ともactual exit0、anomaly_count0、generated artifact差分なし |
| 固定main CI | [run43719740670](https://github.com/YutoSuga/helloproject-song-data/actions/runs/43719740670)、head=`a265e8a…`、push/main、全job SUCCESS。Test and build job132828924795は796 PASS / FAIL0 / SKIP0、Gate Node20 job132828925128・Node24 job132828925031は各79 PASS。Deploy job132844973702もSUCCESS。metadataとdecoded生ログを保存 |

CIはPR88 mergeで自動起動済みのrunを今回照会したもので、本タスクが新たにdispatch/deployしたものではない。CIの全件結果、PR86/PR88の過去結果、今回ローカルの全件結果を区別する。保存PRのCIは受入対象mainのCIと別であり、本判定の代替証拠にはしない。

今回の補助sandbox候補テストはexit1だが、全suiteとは別run。fixture EPERMとassertion未到達を記録し、今回の全suite FAIL0へ混入も隠蔽もしない。ログ取得のForbidden、誤directoryでのchecksum照合、CIログ保存時のargument length/patch形式エラーは収集harnessのエラーで、後続に正しい完了証拠を保存した。これらをテスト失敗/PASSに転用しない。

## Productionと不変性

Production statusはexit0、READY/initialized、canonical_effect none、diagnostics[]。repository instance `repo_fde45556-3600-4434-82b2-05cb36841517`、bootstrap hash `08231cac2581b4518d1052672a0842422f2914f7a4c2865743966a1f2277a098`、state hash `e67375c7619ecaa49fcc2a38c35b8c058ef77c6427caec1748d2a4d51d38dc7f`。History0/head=bootstrap/last_apply_id null、state proof verified。14表whole validation成功、canonical manifest `873c96ebee0003d09afeb8c13346d7fa8b3dcf3bbf6d8ec48dad1f31f88ae39f`。完全origin/main監査は固定SHA・all_reachable_parents・196 commits・shallow false/complete true。

HWMはA0/B0/C86/G3/H1/J120/L136/M0/O0/P17/R0/T0/V0/W90。前後manifestはraw bytesのSHA256で、statusのsemantic state_hashとは別物。開始manifestは全追跡regular fileとそのうちdata/stagingの17ファイル。開始時の全ignored entryの独立inventoryは採取していないため、hashで任意の一時的外部変更まで検出したとは主張しない。終了時の実directory entryも保存する。

## 残る制約・運用境界

Node>=20/Linux/atomic no-clobber hard link・sync・同filesystem renameを満たすlocal FS、単一authoritative working tree、同版の協調reader/writerが保証範囲。物理電源断・hardware flush・非協調writerとのcheck/rename race・複数clone/HTTP認証/DB/SCR-002実writeの安全性をこの試験から推測しない。旧writer混在なしのquiescent rollout、容量監視・証拠保管・障害手順は運用判断の前提として残す。

Production Bootstrap initialize/Apply/Recovery、強制unlock、SCR-002実write、コード変更、mergeは行っていない。statusの正規のgate取得/本人releaseはdomain read-only契約内。fixture内のBootstrap/Apply/Recovery/障害注入とは区別する。

本判定はFN-004 v1の正式受入であり、特定Production Planへの人間承認やProduction運用開始・初回Applyの許可ではない。次のProduction操作は別タスク・最新状態とidentity/Decision/Plan/TTY承認の確認を要する。

保存PRは報告と重要証拠のみ、mergeしない。報告・保存完了をもって本タスクを終了する。

## 終了照合と証拠の保存

検証終了時HEADは開始時と一致。全追跡regular file **302件**の前後raw SHA256が一致、Production **17件**の前後raw SHA256が一致。終了data/staging実entryは同じ17 regular filesのみ。`git status --porcelain`空、`git diff --check`成功。保存専用worktreeへのdocs追加は検証treeと分離した。

- `source-before.json` SHA256: `3e9bb9a14c23c5f3e22704909f32281dfcf8cf458693874d6e47fab51a28068d`
- `source-after.json` SHA256: `3e9bb9a14c23c5f3e22704909f32281dfcf8cf458693874d6e47fab51a28068d`
- `production-before.json` SHA256: `52ff38a039099f51e62c250b5b109a41f70b1ef7160787397209068a6e814ace`
- `production-after.json` SHA256: `52ff38a039099f51e62c250b5b109a41f70b1ef7160787397209068a6e814ace`
- `full.tap` SHA256: `d2fb56247fa3d22cf967e50c0580bfcda89da279cf4e6ded0421d374d22d0816`

archiveの`SHA256SUMS`で保存物全件を照合する。生TAP/CIログは内容を整形せず保存するため末尾空白が存在し得る。source/Production manifest・actual exit・summary・Production audit・CI metadata/ログ・今回sandbox stackが重要一次証拠。過去PR88 archiveは重複コピーせず固定main内の保存物とその今回照合ログを参照する。

**最終判定：PASS。FA-M01 CLOSED。** FA-L01と明示した運用制約、過去初回の原因未確定を残したうえで、旧監査のblocking理由に対する修正と正式再受入の必要証拠を確認した。これらを推測で消去した判定ではない。
