# FN-004 FA-L01 merge後の解消確認

正式判定：**OPEN / LOW / non-blocking（CI最終結果の確認待ち）**。
原本の文書指摘は解消している。実装不一致や契約変更は発見しなかったが、PR #90とmerge後mainのTest and buildが未完了であり、今回の必要証拠が揃っていないため正式CLOSEDとは判定しない。CI未完了を失敗と扱っているわけではない。

## 検証対象・環境

2026-11-16 10:06–10:10 UTC、managed Linux 6.18.57 / Node v24.19.0、`/workspace/helloproject-song-data`。GitHubから`git fetch origin main`成功後、固定main **`4fa7907fb54deec77ebfe6618a73fb2f720dab88`** を基点に記録branchを作成した。開始時working treeはclean。ローカルの旧work branchをmainと取り違えず、fetch後のorigin/mainを使用した。

[PR #90](https://github.com/YutoSuga/helloproject-song-data/pull/90)は2026-11-16T10:03:40Zにmerge済み。merge SHAも上記固定mainと同一。`git merge-base --is-ancestor 4fa7907fb54deec77ebfe6618a73fb2f720dab88 HEAD`はexit 0。merge後の追加commit・差分はない。first parentは`cfb6728abcaa3ff072c4a75afd46940ac0dda2d6`、PR headは`bc98dd9ba711223c38b44f0f58afce40be836039`。mergeの3文書差分を独立に読んでmainへの反映を確認した。

## 原本と変更範囲

[旧Final Acceptance](FN-004-Final-Acceptance.md) §9（FA-L01行183、補足195）・§14（240）は、6D〜6F接続済みなのにDecision / Plan / Transactionの冒頭に現在形のruntime未実装が残ることをLOW / non-blockingとして指摘する。schemaや安全手順の不具合ではなく、status注記と現行APIへの案内を別docs PRで整理する要求である。原本に独立した詳細CLOSED条件があるとは解釈しない。

[正式再受入](FN-004-Final-Acceptance-20261115.md)のPASS / FA-M01 CLOSED / FA-L01 OPENは当時の正しい記録として保持する。今回も過去監査を変更しない。

PR #90の変更は以下3文書のみ（20追加 / 6削除）。冒頭の未実装断定を提供範囲と実装・CLIガイドへの案内へ更新し、Planの「後続runtime」の時制、Transactionの既存moduleから安全保証を推定しない説明、Slice 1単体の責務説明を整理している。

- [Decision](../design/FN-004-判断モデル.md)
- [Plan](../design/FN-004-反映計画.md)
- [Transaction / Recovery](../design/FN-004-反映処理・復旧.md)

## 現行コードとの独立照合

| 対象 | 読取確認した実装と結果 |
| --- | --- |
| Decision | `src/fn004-decision-application.js`のcreateDecisionServiceはsaveDecisionDraft / confirmDecision / cancelDecision、getDecision、buildDecisionRegistryを提供。gate・validated store・readinessを検査する。公開adapterはtemplate / import / show / validate / confirmで、`src/canonical-cli.js`にcancel dispatchはない。serviceとCLIの区別は正しい |
| Plan | `src/fn004-plan-application.js`はactive_confirmed選択、generate / save / get / checkを提供。hash・rules・current Decision・再生成payloadを照合し、terminal contextがあればgeneratePlanFromTerminalInputを使う。management.createPlanはrevision/hash照合後save。CLI plan create / show / checkと一致し、更新・削除・batch提供を主張しない |
| 通常Apply | `src/fn004-apply-application.js`はcreateApprovalRequestServiceへexecuteAcceptedRequestを注入。`src/fn004-normal-apply.js`は同live leaseでOwner公開、入力再検証、prepare、commitPrepared、success finalizeへ進む。management.applyPlanは別Approvalとdurable Requestを作り、readonly resultへ進む。CLIはTTY/CI拒否・確認を経る。説明に誇張なし |
| Recovery | management.inspectRecoveryはcollector / OS probe / classifierへ接続。runRecoveryはfresh観測hash・唯一actionの一致を要求し、success/failure serviceへ明示dispatchする。`docs/canonical-cli.md`のSTOP、Owner終了証明、Linux probe、未対応platform停止と一致。通常Apply内の所有者によるfinalizeと、自動Recovery takeoverを混同しない |
| 制約 | Transaction保証範囲のNode20以降、単一authoritative tree、協調reader/writer、local FSのfile/directory sync・同FS rename・exclusive publication、非対応STOP、NFS除外は保持。既存row更新削除、batch、force unlock、SCR-002 / HTTP API非提供とCLIガイドが一致 |

`test/fn004-cli-e2e.test.js`のDecision→Plan→TTY Apply→result/History、no-op、`test/fn004-success-recovery.test.js`と`test/fn004-cli-crash.test.js`の成功確定・SIGKILL/restart・観測hash/action不一致拒否も読取確認した。**今回実行したテストではない**。過去監査の795 PASS / FAIL0 / 既存SKIP1は別時点の証拠であり、今回の独立再実行成功として扱わない。文書変更のみのため全suiteを再実行していない。

## 契約不変性・文書検証

first-parent対mergeの全diffを確認。変更はstatus proseだけで、schema / invariant / hash projection / Decision・Plan・Transactionの正式契約 / Approval・Request承認条件 / Gate・Recovery安全手順 / Acceptance基準に意味的変更なし。全Markdown表とfenced blockは3文書とも親commitと一致することを機械確認し、表外の変更も目視照合した。Approval/Request文書・src・test・scripts・data・staging・過去監査の変更なし。

[検証スクリプト](archive/fn004-fa-l01-closure/check.py)と[実測結果](archive/fn004-fa-l01-closure/document-check.json)を保存。固定mainのrootで`python docs/reviews/archive/fn004-fa-l01-closure/check.py`により再現可能（HEADは固定mergeを想定）。対象3文書の相対リンク50件、fragment 3件は存在・見出し一致。runtime未実装の誤った現在形の断定は0。残る後続slice等の表現は冒頭でSlice単体と全体の範囲を区別しており、全体未実装の断定ではない。`git diff --check HEAD^1 HEAD`はexit 0。

Production Bootstrap / Apply / Recovery、強制unlock、SCR-002 writeは実行していない。Productionデータ操作なし。PR90にProductionデータ差分なし。本記録も報告書と検証証拠のみを追加する。

## CI証拠と判定への影響

最終取得2026-11-16T10:09:59Z。[GitHub API証拠](archive/fn004-fa-l01-closure/github.json)。connectorのcommit workflow検索ではmainのrunが空だったため、GitHub RESTのcheck-runsとrun jobsで実在runを確認した。空の検索結果をCI不存在とは判断しない。

| 対象 | Gate Node20 / Node24 | Test and build |
| --- | --- | --- |
| PR90 [run43841873238](https://github.com/YutoSuga/helloproject-song-data/actions/runs/43841873238) | 両方SUCCESS | job133212265189 IN_PROGRESS、conclusion null |
| merge後固定main [run43845391327](https://github.com/YutoSuga/helloproject-song-data/actions/runs/43845391327) | 両方SUCCESS | job133224156947 IN_PROGRESS、conclusion null |

workflow `.github/workflows/deploy-pages.yml`のTest and buildはnpm test・ranking validation・site build等を含む。必須検証対象の最終成功はまだ確認できない。branch protection設定上のrequired指定とは区別する。未完了を成功や失敗へ推定しない。mainのDeploy完了も主張しない。CIを手動起動・再実行していない。

## 対象外5文書：FOLLOW-UP

以下は原本が直接指定する3正本の冒頭statusではない。原本の解消範囲を拡大せず、別の文書保守課題として残す。一括修正しない。

| 文書 | 評価・FOLLOW-UP |
| --- | --- |
| `docs/design/レビュー準備・canonical反映の全体フロー.md` 5 / 124 | FN-004とSCR-002を一緒に未実装とする全体説明は古く、現状理解を誤らせる。FN-004のstatus整理候補。SCR-002未提供は維持 |
| `docs/design/楽曲管理のCLI・画面連携.md` 3 / 192 / 228 | 6A〜6Fの未来形が残る。公開操作はCLIガイドへ明示誘導されており、将来のstatus整理候補。backend/frontend未提供を消さない |
| `docs/design/FN-004-初期化・ID状態.md` 201 / 207 / 254 / 263 | 将来library・CLI後続・未実装などSlice 3時点の説明が混在。Slice単体の責務と現行接続の注記整理候補。bootstrap自動化や安全条件変更の根拠にしない |
| `docs/design/FN-004-成功履歴・読取検証.md` 147 | publication / terminal proof / state mutationを後続sliceとする責務説明。readonly契約の制約として読めるが現在の全体状況への案内は保守候補 |
| `docs/design/FN-004-承認・反映リクエスト.md` 178 / 195 / 527 | Slice 5 guard・未実装terminal validator・actual Apply後続の説明。529以降のSlice 6接続節が補足し、success-only APIとcomposite proofの境界を保持。将来注記整理候補 |

古い進捗表現には誤解リスクがあるが、今回読取範囲では承認省略・force unlock・非対応FSの使用等を許可する新しい重大な正式契約/運用手順矛盾は見つからなかった。固定SHA調査・過去計画・監査の史実や、未提供SCR-002/backend/frontendを一律置換しない。

## 正式判定・次の作業

**OPENを維持する理由はCI最終証拠の不足**。3正本の原本指摘、現行実装との一致、契約不変性、文書検証は充足した。CLOSED前提の監査とはせず、必要CI未完了を残す。次は上記2runのTest and buildの最終結果を取得し、失敗なら内容と影響を評価する。mainが進めば固定SHAとの差分も再確認したうえで、新しい追記記録で正式CLOSED可否を判断する。設計書の再修正を求める判定ではない。

本記録PRは未mergeであり、この判定記録がmainに保存済みとは扱わない。ユーザーがmergeを判断する。過去Final Acceptanceの判定は不変。本確認はProduction運用開始・特定Plan・初回Applyの承認とは別であり、単一tree / FS / OS等の既存制約、過去監査の初回失敗原因未確定、上記FOLLOW-UPを解消したとは主張しない。
