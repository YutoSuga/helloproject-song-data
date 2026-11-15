# FN-004 FA-M01 独立証拠照合（2026-11-15 UTC）

提案：**追加対応が必要**。修正・主要回帰の証拠はあるが、原因不明のpost-merge失敗を残したまま、過去CIの成功で現行main一括検証を代替しない。FA-M01 CLOSEDともFinal Acceptance PASSとも判定しない。本書は受入前の証拠整理である。

## 1. 対象・出所

GitHubからmainをfetchし、`7fb5f1b3184449dde4e8af48b121dfd9bc9f3a8f`に隔離worktree `/workspace/fa-m01-main`を固定した。元checkoutは変更していない。

- [PR85](https://github.com/YutoSuga/helloproject-song-data/pull/85)：MERGED、merge `3f3c67b4de89a0b009976d01dc141aab1b686ee4`。`docs/design/FN-004-FA-M01-Gate公開契約案.md` D1–D4、§10.1が設計基準。
- [PR86](https://github.com/YutoSuga/helloproject-song-data/pull/86)：MERGED、head `4e80d511728a1e3ffcf80b18696c1f7e9886e842`、merge `bc16c362922835d2af1c98fd833032257a9c9473`。24ファイルのコード・設計反映・テスト・workflow差分と`docs/plans/FN-004-FA-M01-Gate-Publication.md`を確認。
- [PR87](https://github.com/YutoSuga/helloproject-song-data/pull/87)：MERGED、mergeは対象mainと一致。
- 原本 `docs/reviews/FN-004-Final-Acceptance.md`、回収記録 `docs/reviews/FN-004-Final-Acceptance-Recovery.md`。原本SHA256を独立計測し `bfab235e98731d4a441ee5f5c55a226f4f5ddbed8e25d66a1c52928070dc92a9` と一致。重点§8/9/10/13/14を含む全文を確認。
- bc16c362は対象mainの祖先。両者間の差分は回収文書・archiveの4ファイルだけで、src/test/workflow/packageの差分なし。

原本§9はdeterministic regressionと全suite、§14(2)は公開/検査窓・破損lock・同時Decision・実CLI code・crash/ownership/durability・main取込後の固定main再受入を要求する。独立した正式CLOSED条件は存在しない。以下はそれらの要求への証拠評価であって、新設した過去のCLOSED条件ではない。

## 2. 要求・証拠対応表

分類は今回取得した範囲に限定する。「充足」もFN-004の受入完了を意味しない。

| 原本要求 | 分類 | 直接証拠・限界 |
| --- | --- | --- |
| Gate metadata公開・検査競合修正（§9/14） | 充足 | bc16c362の`src/fn004-gate-publication.js`：wx/0600 candidateを完成・sync・inode/bytes照合後にexclusive link、directory sync・final照合、本人candidate cleanup。EEXIST→ENOENTは最大8 retry/monotonic 1秒。`fn004-gate.js`のnominal lease返却前guard。GP01–05を今回実行。 |
| 破損lock安全側拒否（§9/14） | 充足 | 同publisherのstrict JSON/metadata/root/descriptor照合、GP06/GP05 invalid observation保持。空・partial・未知version等をGATE_CORRUPTとして保持。BUSYへの一律変換・自動unlockなし。今回GP06成功。 |
| Decision同時更新（§9/14） | 充足 | `src/fn004-decision-application.js`、`fn004-gate-budget.js`が既存5秒予算を共有。`test/fn004-decision-lifecycle.test.js:158` GP12と`:178`旧失敗ケースを保持。一勝者と敗者DECISION_HEAD_CONFLICTを今回確認。 |
| deterministic regression（§9） | 充足 | GP12がmetadata writeを明示pauseして競合を作る。GP04もEEXIST→release→ENOENTを注入。今回92テストに含まれる。旧baseでGP12がFAILしたという反証実験はPR本文・計画書の既存記録であり、今回未再実行。 |
| 全suite再検証（§8/9/13） | 一部充足 | PR86ローカル795 pass/1既存skipは本文の申告。取得CI run 43655287828のjob132632344538では796 pass/0 fail/0 skipをログで確認。しかし実checkoutはPR synthetic merge `cd27ff1e82cf1e4c56d03749b6f53bbd843d11bf`。現在固定mainでの独立unfiltered全suiteは今回未実行。post-mergeの初回失敗も未解決。 |
| 実CLI code（§14） | 一部充足 | `test/fn004-gate-publication.test.js` GP16はerror→CLI projectionの1/5/8/9確認であり実CLI起動と区別。実processの`test/fn004-cli-safety.test.js`（corrupt final exit8/無dispatch/既存bytes+inode保持）、contract/e2e/crash/review84はCI fullに含まれる。PR記録44 CLI pass/18 kill境界。今回実CLI群は未実行。 |
| crash/ownership/durability（§14） | 一部充足 | 今回`fn004-gate-publication-crash.test.js`の14実SIGKILL境界と別process link競合、GP03/07/09のinode・fault・foreign owner保持成功。6A–6F、Recovery successor/retirement/terminal等の広い回帰はCI fullとPR記録で確認する範囲。今回のfocusedでは全範囲を再検証していない。実電源断保証ではない。 |
| 修正PRのmain取込（§14） | 充足 | GitHub merged metadataとgit ancestryによりbc16c362取込を確認。 |
| 新しい固定mainでFinal Acceptance再実施（§13/14） | 未確認 | 今回対象外。実施済みの証拠なし。本書を再受入報告として扱わない。 |

## 3. 今回の独立検証

Node v24.19.0 / Git2.52.0 / Linux6.18.57、default sandbox。作業rootは上記隔離worktree。repo device27、/tmp device34。今回fixtureは既存testのtemp rootであり、同一volume検証を今回実施したとは主張しない。

1. `node --test --test-concurrency=1 --test-reporter=tap test/fn004-gate-publication.test.js test/fn004-gate-publication-crash.test.js test/fn004-decision-lifecycle.test.js`：exit0、3ファイル成功。`independent-focused.tap/.exit`。
2. 同じ3ファイルに`--test-isolation=none`を追加：exit0、92 pass/0 fail/0 skip/0 cancelled。個別名・assertion単位の結果は`independent-detail.tap/.exit`。上記と同じテストの補足実行であり合算しない。
3. `node --test --test-concurrency=1 --test-reporter=tap test/fn004-gate-candidate-integration.test.js`：**exit1、ファイル単位1 fail**、約43,649.5ms。`independent-candidate.tap/.exit`。個別subtest/errno/stackを得られず、原因は未確定。今回もsandbox内の失敗を観測した。過去初回との同一原因も、EPERM原因も断定しない。これを成功した92件と合算して全件成功と扱わない。
4. 原本hash・main ancestry・runtime差分なし・git diff --checkを確認。unfiltered全suite/build/Production監査/CLI全群は今回実行していない。

## 4. 既存証拠とレビュー

[CI run43655287828](https://github.com/YutoSuga/helloproject-song-data/actions/runs/43655287828)：Test and build成功、796 pass/0 fail/0 skip/0 cancelled、rankings/build/generated check成功。Node20 job132632344748、Node24 job132632344793は各79 pass/0 fail/0 skip。DeployはPRのためskip。各decodedログを本directoryに保存した。これは過去CIログの今回の読取りであり今回のテスト実行ではない。CIはheadに関連付くが、ログが示す実行SHAはcd27ff1で、merge/mainのSHAそのものとは異なる。

PR86 review submissionsをAPI照会した結果は空。独立APPROVED reviewを取得したとはいえない。計画書・PR本文にreview対応の記録はあるが、正式review submissionと同一視しない。merge済みという事実からreview完了を推定しない。

post-merge証拠は[コメント6892234765](https://github.com/YutoSuga/helloproject-song-data/pull/86#issuecomment-6892234765)に保存。初回4ファイル実行exit1、candidate integrationファイルのみ失敗、他3ファイル成功。個別assertion/errno/stackは未保存。後続sandbox外candidate13 pass/exit0を記載。元`/workspace/fa-m01-postmerge/`は今回環境に存在せず、生ログhashを独立再照合できない。コメントの引用と生ログ検査を区別する。

## 5. sandbox未確定事項

初回失敗原因は未確定。後続sandboxでのspawnSync git EPERM観測はユーザーから提示された事実として扱うが、今回取得コメントのdiagnostic記載は12 okで終了summaryなしであり、EPERM当該生ログは取得できていない。後続EPERMと初回失敗の同一原因は証明されない。sandbox外13 PASSも初回失敗を取り消さない。

EPERMは子process実行権限という環境制約の証拠になり得るが、初回の実装不具合の否定証拠にはならない。逆に初回非zeroだけで実装欠陥も断定しない。原本§10のwall-clock変動、§13の「CI/過去のPASSだけで必須検証を免除しない」に照らし、未説明の失敗をblockingから根拠なく除外しない。

## 6. 不足証拠と次タスク

追加Codexタスクとして、同じ固定main・source ledger・Node/OS/FS・sandbox/isolation・command・時刻・stdout/stderr・個別TAP・actual exitを保存し、初回と同じ4ファイル構成を含むcandidate失敗の切分けを行う。今回の単独実行でも原因不明のexit1を観測したため、この調査を優先する。sandbox内外は条件差を明記する。初回の失われたassertionを再構成したと主張せず、回収不能であることと新しい説明可能な観測を併記する。

そのうえで固定mainのunfiltered全suite（既存assertion/timeout/skipを緩和しない）、実CLI全群、6A–6F crash/ownership/durabilityを完了し、失敗を含む全ログとsource前後を保管する。現在のCI成功とmainでの実行を区別する。これらは原本検証要求を満たすための提案であり、新しい過去のCLOSED条件ではない。

実装不具合が再現した場合のみ別fix PRを提案し、設計変更が必要なら別途正式検討する。本タスクではPRを作らない。証拠が揃った後に別Codexタスクで新しい固定mainのFinal Acceptanceを実施し、その場で受入を評価する。

## 7. FA-L01 別docs PRの範囲

LOW・non-blockingを維持。`docs/design/FN-004-判断モデル.md:3` Decision runtime未実装、`FN-004-反映計画.md:3` runtime未実装、`FN-004-反映処理・復旧.md:3` Apply/Transaction/Recovery未実装の現在形注記を対象に、現行service/CLI/6D–6Fへの案内と各Slice時点の歴史説明を明確化する。後段の「本docs-only PRでは実装しない」等は当時のscopeなら維持する。#81の固定SHA調査・旧監査原本・normative schema/手順は書き換えない。今回は文書変更なし。

## 8. 引継ぎ・終了

本報告書、PR85/86/87の取得JSON（差分含む）、CI decodedログ、今回TAP/exitは`/workspace/fa-m01-evidence/`に保存。すべてローカルのみでGitHub未投稿・未commit。隔離worktreeは`/workspace/fa-m01-main`に残る。原本・回収archiveはPR87によりmainに永続保存済み。禁止されたProduction操作、強制削除/自動unlock、SCR-002実write、コード/テスト/正式設計変更、PR作成/mergeは行っていない。

**追加対応が必要**を提案する。主要修正の有効性は確認できたが、失敗の切分けと固定mainの必須検証に不足がある。この提案はFinal AcceptanceのPASS/BLOCKED再判定ではない。本報告の完成をもって今回のCodexタスクを終了する。
