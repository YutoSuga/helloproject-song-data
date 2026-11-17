# PR label CI

`ci:light` selects light CI. No label selects full CI. Actions does not inspect changed files, titles, or change size. Manual dispatch is always full CI and only main is accepted.

## Events and commit identity

The existing `Deploy ranking site to GitHub Pages` workflow runs on main-targeted PR opened/synchronize/reopened/labeled/unlabeled events. All label events reevaluate the current label list; unrelated label changes also rerun CI to keep event handling simple. PR runs share a concurrency group with cancellation enabled. PRs never upload a Pages artifact or deploy. Closed events are not subscribed, including unmerged closes.

Post-merge CI runs once on `push` to main. `.github/scripts/ci-policy.cjs` paginates PRs associated with the push SHA and requires exactly one merged PR whose `merge_commit_sha`, main base, and base repository match. It rechecks the PR detail before reading labels. Missing/ambiguous matches, API errors, or malformed data log a warning and select full CI. Labels are read at lookup time, not snapshotted at close. Manual dispatch does not query labels.

The selection job outputs the event's `github.sha`. Gate Node 20/24 and build check out that same immutable SHA, with full history for the existing FN-004 audits. Deployment consumes only the Pages artifact from that workflow run, after build and both Gate jobs succeed. This intentionally replaces independent checkouts of moving main with the commit that triggered the run.

A pull_request.closed run retains its event execution ref even if checkout uses main; PR #92's run #116 was rejected by the Environment for `refs/pull/92/merge`. Using main push/manual runs fixes this without widening the Environment's main-only branch policy.

## Publication ordering and permissions

The existing `github-pages` deployment concurrency group now has `cancel-in-progress: false`. Its lock covers the freshness check and the Pages deployment. Immediately before deployment, the job reads main and compares it to the verified SHA. A stale SHA skips publication; lookup failure fails the job. An older run cannot publish after a newer run because all deployments share the lock and check freshness after acquiring it. GitHub does not guarantee FIFO ordering and may replace pending jobs; the newest successful main run is the publication target. A main update during an active deployment can leave the earlier site temporarily visible until the newer run succeeds, but cannot allow that earlier deployment to finish after a newer one in this workflow. External/manual cancellation of an active Pages deployment should be avoided because server-side work may continue.

Only the selection job adds `pull-requests: read` for PR lookup. Build/Gate retain `contents: read`. Deploy retains `pages: write` and `id-token: write`, and adds `contents: read` for main freshness lookup. Checkout does not persist credentials. No `actions: write`, `pull_request_target`, cross-run artifact downloads, or deployment inputs are introduced. Non-main manual runs skip selection and all dependent jobs. The github-pages Environment protection is unchanged.

## Validation scope

Both modes preserve `Test and build` and `Gate publication (Node 20)` / `(Node 24)` names. Gate jobs initialize their Node environments in light mode and succeed with only the test step skipped.

Light CI skips only:

- `npm test` on Node 20 (including FN-004 tests).
- The serial Gate publication/crash/candidate integration tests on Node 20 and 24.

Both modes run whitespace checking, `npm run rankings:validate`, `npm run site:build` (canonical CSV to ranking JSON), and `git diff --exit-code -- site/data/rankings`. Full CI preserves all existing test commands. Main push and main manual dispatch retain the existing Pages artifact and deployment actions.

## Rollout checks

Classic main branch protection could not be read during PR #92 investigation (integration HTTP 403); check names remain unchanged. Pages Environment has a custom branch policy allowing main only.

Before merge, verify policy fallback cases, workflow event/permission conditions, fixed checkout SHA, stale-publication gating, light data/build commands, and full PR CI. Actual main-push label selection, non-main manual rejection, and Pages deployment are rollout checks, not proven by a PR run. After user-approved merge, verify light/full main pushes, current main's artifact/deployment, stale run skip, published content, and no publication on PR/close. Do not merge the implementation PR automatically to perform these checks.

GitHub CLI accepts `gh pr create --label ci:light` but applies labels after creation in a second API call (`cli/cli`, `api/queries_pr.go`, `CreatePullRequest`). An initial full run can start; label-event concurrency replaces it. The GitHub connector's create-PR operation has no labels parameter.
