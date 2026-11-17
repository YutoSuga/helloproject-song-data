# PR label CI

`ci:light` selects light CI. No label selects full CI. Actions does not inspect changed files, titles, or change size. `workflow_dispatch` remains full CI.

The existing `Deploy ranking site to GitHub Pages` workflow runs on main-targeted PR opened/synchronize/reopened/labeled/unlabeled events. All label events reevaluate the current label list; unrelated label changes also rerun CI to keep event handling simple. PR runs share a concurrency group with cancellation enabled, so adding/removing the label replaces an in-flight run.

Merged `pull_request.closed` runs use the original PR's labels, check out latest main with full history, and publish to Pages. Unmerged closes skip all jobs. The main push trigger is removed to avoid duplicate post-merge runs. Manual dispatch is retained. Post-merge runs have a separate concurrency group and are serialized; existing Pages deployment concurrency is retained.

Both modes preserve `Test and build` and `Gate publication (Node 20)` / `(Node 24)` names. Gate jobs still initialize their Node environments in light mode and succeed with only the test step skipped. Deploy continues to depend on build and both Gate matrix jobs.

Light CI skips only:

- `npm test` on Node 20 (including FN-004 tests).
- The serial Gate publication/crash/candidate integration tests on Node 20 and 24.

Both modes run whitespace checking, `npm run rankings:validate`, `npm run site:build` (canonical CSV to ranking JSON), and `git diff --exit-code -- site/data/rankings`. Full CI preserves all existing test commands. PRs never upload/deploy Pages; merged PRs and manual dispatch retain the existing artifact and deployment actions, environment, and permissions. No new token permissions are granted.

## Administration and rollout checks

Repository rulesets were empty at investigation time. Classic main branch protection could not be read (integration returns HTTP 403), so configured required checks could not be fully audited. Check names and successful light-mode Gate jobs are preserved to avoid pending required checks. Pages environment has a custom branch policy allowing `main`.

After merging, verify a light PR and a full PR; add/remove `ci:light` during a run and confirm replacement/cancellation. After user-approved merges, verify original PR label selection, checkout of latest main, Pages artifact upload/deploy, and the published site. Closing an unmerged PR must not build or publish. These live post-merge cases must not be tested by merging the CI implementation PR automatically.

GitHub CLI accepts `gh pr create --label ci:light` but applies labels after creation in a second API call (`cli/cli`, `api/queries_pr.go`, `CreatePullRequest`). This can briefly start full CI; labeled-event concurrency is the simple mitigation. The GitHub connector's create-PR operation has no labels parameter.
