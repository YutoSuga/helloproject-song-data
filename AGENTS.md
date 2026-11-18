# Codex PR / CI operation

- Create a dedicated branch from current main; do not push directly to main or merge PRs automatically.
- For documentation-only changes, minor changes, and future SCR-101 generated PRs, normally use `ci:light`. For ordinary implementation changes or uncertainty, leave this label off (full CI).
- Prefer `gh pr create --label ci:light` when light CI is appropriate. GitHub CLI creates the PR and then applies metadata in a second API call; an initial full run can start. The label event replaces that run through PR concurrency. Verify the label and latest checks after creation.
- Do not classify changes automatically in Actions or introduce a `ci:full` label.
- See [.github/CI.md](.github/CI.md) for CI behavior and verification limitations.
