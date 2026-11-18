# FN-004 FA-M01 残存検証・sandbox失敗切分け

検証日：2026-11-15 UTC。提案：**Final Acceptance再実施へ進める**。

固定mainで省略なし全suiteが **796 tests / 795 PASS / 0 FAIL / 1既存SKIP / cancelled0 / exit0** で完了した。現在のcandidate integrationのsandbox失敗は、GP11/14のfixture子processでの`spawnSync git EPERM`として特定でき、sandbox外で同じテストが成功した。過去初回失敗の個別原因は依然証明できない。この不確定性を受入担当へ引き継いだうえで、別タスクのFinal Acceptanceへ進むことを提案する。**FA-M01 CLOSED・Final Acceptance PASS・Production運用開始の判定ではない。**

## 1. 対象commit・確認資料・環境

- Repository：YutoSuga/helloproject-song-data。
- 固定対象：`7fb5f1b3184449dde4e8af48b121dfd9bc9f3a8f`。検証worktree：`/workspace/fa-m01-main`、detached HEAD。開始・終了SHA一致、終了working tree clean。
- PR85設計 merge：`3f3c67b4de89a0b009976d01dc141aab1b686ee4`。D1–D4/§10.1とPR86反映を確認。
- PR86修正 merge：`bc16c362922835d2af1c98fd833032257a9c9473`。
- PR87原本保存 merge：上記固定対象SHA。各PRのGitHub取得JSONをarchiveに保存。
- 原本 `docs/reviews/FN-004-Final-Acceptance.md` §8/9/10/13/14、回収記録 `docs/reviews/FN-004-Final-Acceptance-Recovery.md`、PR86計画書を確認。
- 前タスク `/workspace/fa-m01-evidence/REPORT.md` は取得できた。前タスクのsandbox失敗・過去CIの記録を今回の実行結果と分離した。前報告の副本をarchiveに保存する。
- Node v24.19.0、npm11.9.0、Git2.52.0、Linux6.18.57 x86_64/glibc2.41、CPU quota2（cpu.max=200000/100000）。NODE_OPTIONSなし。環境記録は`environment.json`。
- sandboxは既定workspace-write/network restricted。sandbox外実行は明示的なrequire_escalatedによるもの。Node/source/command/rootは同じで、sandbox条件を変えて比較した。

原本§9のdeterministic regression・全suite、§14のCLI/crash/ownership/durabilityを今回の省略なし全suiteに含める。原本にない独立したCLOSED条件は定義しない。今回は実装修正・正式設計変更・Final Acceptance再判定を行わない。

## 2. candidate integrationの結果

対象：`test/fn004-gate-candidate-integration.test.js`。表のexitは`.exit`保存値であり、後続のcat/tailを含むshellラッパーのexitと区別する。

| 実行 | 結果 | 証拠 |
| --- | --- | --- |
| sandbox / 通常`node --test --test-concurrency=1 --test-reporter=tap <file>` | exit1、ファイル単位1 FAIL（内部件数を取得できない出力） | `candidate-sandbox-standard.tap/.exit` |
| sandbox / `node <file>`直接実行 | 13 tests、12 PASS / 1 FAIL、exit1 | `candidate-direct-sandbox.log/.exit` |
| sandbox / `node --test-name-pattern='GP11/14' <file>` | 1 FAIL、exit1、fixtureのEPERMとstack取得 | `candidate-direct-last-sandbox.tap/.exit` |
| sandbox外 / 通常`node --test --test-concurrency=1 --test-reporter=tap <file>` | 13 PASS / 0 FAIL / 0 SKIP / cancelled0、exit0（96,810.124ms） | `candidate-unsandboxed.tap/.exit` |
| sandbox外 / 同じ個別GP11/14直接実行 | 1 PASS、exit0 | `candidate-direct-last-unsandboxed.log/.exit` |
| sandbox外 / 全suite内の同ファイル | GP11/14を含む全件成功 | `full-unsandboxed.tap` のGP10/11/13/14、特に`ok 396 - GP11/14 ...` |

直接実行は個別stack取得のための補助条件であり、通常runnerとの同一条件とはいわない。通常runnerでもsandbox失敗・sandbox外成功を別途確認した。補助実行のPASSを全suiteへ加算しない。

### 失敗箇所・fixtureとassertionの区別

失敗テスト名：`GP11/14 candidate stale token blocks mutation; fresh abort/retirement excludes orphan from cleanup`。

呼出しchainは次のとおり。

1. `test/fn004-gate-candidate-integration.test.js:106`で登録、`:107`の`await fixture(t,'abort')`。
2. `test/fixtures/recovery-runtime.js:9–11`がsetup子processをforkし、messageまたはexitを待つ。子processのstderrを収集して、exit時にErrorとして返す。
3. `test/fixtures/recovery-runtime-child.js:45–46`がsynthetic `/tmp/fn004-recovery-*`のGit初期化を実施。`execFileSync('git',['-C',root,'init','-q','-b','main'])`で失敗。
4. 取得エラーは`Error: spawnSync git EPERM`、errno **-1**、code **EPERM**、syscall `spawnSync git`。stackはNode child_process→execFileSync→fixture child46行→fixture親11行→対象test107行を示す。

`fixture`が解決していないため、その後のcandidate stale-token拒否・state/gate bytes不変・fresh abort/retirementのassertionには到達していない。したがって今回の当該失敗は**fixture準備段階の環境依存エラー**と分類する。Gateの意味的assertion違反を観測したものではない。

### EPERMの比較probeと証明範囲

- sandbox内の最小`spawnSync('git',['--version'])`はstdoutにGitバージョン、status0を返しながらerrorフィールドにEPERMを付けた。sandbox外の同じprobeではerrorなし・exit0。`git-probe-*.json/.exit`に保存。
- fixture子processの直接診断もGit initで同じEPERMを示した（`fixture-child-sandbox.json`）。fixture親を実際に呼ぶ補助harnessでも同じstackを取得した（`fixture-parent-corrected-sandbox.log`）。
- `execFileSync`はstatus0でもerrorフィールドがあればthrowする。このため「Git status0だからfixture成功」とは扱えない。syscall/OS内部でEPERMが生成される正確な箇所・sandbox policy ruleまでは未特定であり、git実行そのものの禁止や特定seccomp ruleとは断定しない。
- sandbox外の同command/Node/sourceで全13件と個別GP11/14が成功した。現在の失敗とEPERMの関連はテストstackまで確認済み。
- 過去初回（bc16c362）の保存ログはファイル単位失敗だけで、個別assertion/errno/stackがない。今回の機序と整合するが、**過去初回と同一原因だとは証明できない**。後続成功で初回失敗の事実を消していない。

### 完了結果と区別する診断

`--test-isolation=none`の全candidate/個別診断は最終summaryを得られず手動TERMで終了（exit1）。fork stderr観測preloadの15秒診断はtimeout124でstderr未取得。最初のfixture親probeは`--input-type=module`がforkへ継承されてERR_INPUT_TYPE_NOT_ALLOWEDとなったため、そのログを残して通常の.mjsへ修正し再診断した。これらを通常テストのFAIL/PASSやEPERMの直接証拠に転用しない。timeoutは診断harnessだけの上限で、ソース内のassertion/timeoutは変更していない。

## 3. 固定mainの全suite実測

完了した本検証はsandbox外の次の**単一・省略なし・unfiltered**実行である。

```sh
cd /workspace/fa-m01-main
npm test -- --test-concurrency=1 --test-reporter=tap
```

stdout/stderrを`full-unsandboxed.tap`へまとめて保存し、コマンド終了直後の`$?`を`full-unsandboxed.exit`へ保存した。個別test指定・name filter・新skip・assertion緩和なし。Node24.19.0・2CPU・file並列度1は旧監査と比較可能。test内部の明示的競合は維持されている。

| 指標 | 実測 |
| --- | ---: |
| tests（nestedを含む） | 796 |
| PASS | 795 |
| FAIL | 0 |
| SKIP | 1 |
| cancelled / todo | 0 / 0 |
| suites | 4 |
| actual exit | 0 |
| test runner duration | 5,950,213.521961ms（約99分10秒） |

最終TAP planは`1..706`、nestedを含むglobal testsは796。親子testを重複加算していない。終了codeファイルmtimeは2026-11-15T12:01:46.529426Z。`completion.json`は終了観測後12:01:54Zの整合確認記録で、厳密な終了時刻の代用ではない。

SKIP1は既存の`actual GitHub Actions checkout has complete origin/main history`、理由は`Checks the actual Actions checkout; local fixtures run below`。local Git fixture検証は同run内で実行された。CIへ偽装する環境変数は設定していない。FAIL0のため、当該完了runの失敗原因調査は不要だった。

初めに起動したsandbox内の全suiteはCLI crashファイルの失敗まで観測した後、fixture EPERM確認済みの診断としてTERMで中断した（actual exit143、全suite最終summaryなし）。`full-sandbox.tap`と`full-sandbox-interruption.json`に保存。これは全suite完了結果ではなく、本節の795 PASSに加算しない。完全な実行は上記sandbox外runである。

rankings validation/site buildの独立commandやProduction statusは今回の対象として再実行していない。全suite成功をProduction運用承認や実電源断・hardware flush保証へ拡張しない。

## 4. 過去CI・検証結果との差異

- PR86の[CI run43655287828](https://github.com/YutoSuga/helloproject-song-data/actions/runs/43655287828)：796 PASS / FAIL0 / SKIP0。実checkoutはsynthetic merge `cd27ff1e82cf1e4c56d03749b6f53bbd843d11bf`。Node20/24のGate jobは各79 PASS。これは既存証拠であり、今回の独立実行ではない。
- 今回：実commit `7fb5f1b…`、localのためActions専用既存testがSKIPし795 PASS。総796件は同じで、skip理由を特定できている。対象mainはbc16c362から原本回収docs/archiveだけが変わりruntime/test差分なし。
- PR86本文のローカル全suite795 PASS/既存SKIP1は過去申告。今回の同件数成功は新しい独立実測として保存した。
- 旧監査main e119556cの一括実測は713 PASS / FAIL1 / SKIP1、期待DECISION_HEAD_CONFLICTに対するGATE_CORRUPT。今回は修正後mainの当該元競合テストと追加GP12 deterministic regressionを含めFAIL0。件数増は修正後test追加等を含むため、715件と796件を同一sourceの結果として扱わない。
- 前タスクの92 PASSはfocused補助実行。今回の全suite件数へ加算していない。

## 5. Source・Production保護

開始時にgit追跡対象249ファイルのraw SHA256を採取し、終了後に同じ集合を再計測した。HEAD一致、working tree clean、git diff --check成功。`source-before.json`と`source-after.json`はbyte一致。manifest自体のSHA256は次のとおり。

`ee3f81467c10ec11d18e8b5671b996c323eb14979ae8d04d75b7721ff12cdd05`

Production対象は固定mainのdata/stagingの17ファイル（14CSV＋bootstrap＋state＋song-candidates）。各raw hashを`production-before.json`/`production-after.json`へ保存しbyte一致。manifest自体のSHA256：

`52ff38a039099f51e62c250b5b109a41f70b1ef7160787397209068a6e814ace`

既存checkout `/workspace/helloproject-song-data`にも別baseline/終了inventoryを取得し17ファイル一致、固定mainの開始inventoryとも一致した。既存checkoutの追加baselineは10:24時点であり、検証開始前baselineは固定main側の10:20記録と区別する。これらは今回のmanifest形式のhashであり、旧監査の別集計形式f706…と混同しない。

テストは既存の独立temporary fixtureで実施し、Production Bootstrap/Apply/Recovery・Productionデータ書込みcommand・強制gate削除/自動unlock・SCR-002実writeは行っていない。診断で作ったsynthetic fixtureの保持pathは`fixture-child-sandbox.json`等に記録し、gateを強制削除していない。ソース/テスト/正式設計変更なし。保存branchに追加するのは監査文書と証拠のみ。

## 6. 受入証拠として残る不足・次の推奨作業

今回依頼された2点は、現在のsandbox失敗の具体的なfixture/errno/stackの特定と、固定mainの完了全suite結果として証拠化できた。現在のEPERMを除去する実装修正は今回の結果からは要求しない。sandbox設定の改善を検討する場合は環境側の別タスクとし、安全guardを緩和しない。

依然不足するのは、過去初回の失われた個別assertion/errno/stack、現象と同一原因であるという証明である。回収不能な歴史情報を今回の結果で埋めたとは主張しない。原本に独立したCLOSED条件はなく、歴史情報の欠損だけを新たな永久CLOSED条件にもしていない。

次は別Codexタスクで**新しい固定mainのFinal Acceptance再実施**を推奨する。原本の要求・正式契約・今回全ログ・過去の未確定事項を入力に、受入全体を独立して評価する。mainが更新されていれば新SHAを固定して差分と検証の適用範囲を再確認する。今回の検証結果だけで正式受入を代替しない。

FA-L01はLOW/non-blockingのまま、別docs PRでDecision/Plan/Transaction冒頭の古いruntime未実装注記と現行service/CLIへの案内を整理する。原本・固定SHA史実・normative手順は変更しない。本タスクの保存PRへ一般docs修正は混入しない。

## 7. 証拠保存・引継ぎ

ローカル一次保存先：`/workspace/fa-m01-validation-20261115/`。監査資料保存branch：`docs/fn004-fa-m01-validation-20261115`。検証worktreeは固定SHAのまま残し、保存用worktreeは`/workspace/fa-m01-validation-report`に分離した。

本報告書のrepository保存先は`docs/reviews/FN-004-FA-M01-Validation-20261115.md`。証拠は同じPRの`docs/reviews/archive/fn004-fa-m01-validation-20261115/`へコピーし、SHA256SUMSで照合する。保存PRはmergeしない。PRのURLと公開確認結果はタスク最終応答に記す。

重要ファイルは`full-unsandboxed.tap/.exit`、`summary.json`、`completion.json`、source/production前後manifest、candidateの通常/直接/個別のsandbox内外ログ・exit、fixture/probeのstack、commands/environment、前報告副本、PR85/86/87取得JSON。診断の中断・timeout・誤った初期harnessも記録として残す。

一時fixtureの実ファイル群、プロセスのメモリ、過去初回の未保存ログはGitHub保存物に含まれない。今回重要な判定証拠はログ・hash・報告書として保存する。診断・snapshot監視スクリプトは監査資料として`.txt`を付けて保存した。local pathは実行時の位置であり、archive内での再実行はpath調整が必要。生ログの末尾空白はbytes/hashを保持するため整形していない。保存用差分のwhitespace検査は生ログ8箇所の末尾空白を報告するが、検証対象mainのgit diff --checkは成功している。

**提案：Final Acceptance再実施へ進める。** 現在の失敗機序は説明可能となり、緩和なしの固定main全suiteが成功し、Source/Production不変性も確認したためである。過去初回の同一原因証明は未確定として引き継ぐ。FA-M01 CLOSEDやFinal Acceptance PASSの判定は行わず、報告と保存の完了をもって本タスクを終了する。
