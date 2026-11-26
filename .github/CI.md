# 通常CI・保存版CI

正本は[通常workflow](workflows/deploy-pages.yml)、[比較境界選択](scripts/id-ci-base.cjs)、[CSV運用ガイド](../docs/management/CSV直接編集ガイド.md)。通常CIは一本化し、ci:lightラベルによる省略は行わない。旧ci-policy.cjsと対応テストは過去資産として残るが通常workflowから呼ばない。

## 通常workflow

main宛PR、main push、main手動実行で`Test and build`を毎回実行。固定SHA checkout、全14表strict検証、ID台帳差分、全通常回帰、ランキング検証、楽曲JSON契約/再生成一致、site build、生成物差分・未追跡検査。自動commit/pushなし。

- PR：event pull_request.base.sha → github.sha（検証用merge commit）。公開しない。
- main push：event before → event after。afterとgithub.sha一致を確認。複数commitをまとめて比較。
- 手動：mainのみ、必須input base_sha → github.sha。元pushのbefore等の既知の祖先を明示。
- 不正/同一/all-zero SHA、基準未取得、非先祖では失敗。HEAD^へのfallbackなし。取得済みGit objectを使い、通常CIでFN-004履歴監査は行わない。

main build成功後のみ同一runのsite artifactをupload。Deployはcontents:read/pages:write/id-token:write、github-pages Environment、cancel-in-progress:falseのlockを維持。lock内で現在mainと検証済みSHAを比較し古ければskip、API失敗は失敗。PRにはupload・deployなし。非main手動実行も公開なし。

Rulesets・Classic branch protection・required checksは設定なし（2026-11-25所有者確認）。既存設定の移行不要。新設は今回対象外。人間が最新mainを取り込み、最終headのCI成功後に順次手動マージする。PR時成功とマージ後公開成功を区別する。

## テスト選択・保存版

`npm test`はtest/直下の全*.test.js/cjsを実行し、fn004-*専用ファイルだけ保存版へ分離する。canonical検証、公開・集計・生成・収集・レビュー、新reader/採番/停止guardは通常suiteに含む。既存の不正データ検出は減らさない。

[保存版手動workflow](workflows/fn004-archive.yml)は常に保存SHA `9363c69cc0c119ad4ac251e029061e43d9016d76`のコード・CSVをcheckoutし、ローカルorigin/mainもそこへ固定。旧全suiteとGate Node20/24を実行し、公開しない。新運用のCSVを旧suiteに渡さない。保存suiteは長時間かかるため、通常CIのneedsには含めない。通常branchでnode --testを直接全件起動するのは避け、保存試験はこのworkflowを使う。

失敗時はSHA・比較基準・最初の失敗stepを確認。チェック削減・lightラベル・再実行だけで失敗を隠さない。実時間は[受入記録](../docs/history/reviews/CSV簡素化受入.md)へ比較値を記録する。
