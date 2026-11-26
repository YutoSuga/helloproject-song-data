# Codex PR / CI operation

- Start a dedicated branch from latest main. Never push directly to main or merge automatically.
- CSV direct editing is the normal operation. See [CSV guide](docs/management/CSV直接編集ガイド.md). Preserve whole-canonical validation and update new IDs and data/id-high-water.json together.
- Run npm test (ordinary suite), canonical:validate, ids:validate against latest main, site:build, songs:validate, rankings:validate and site:check-generated. Review existing identity changes and cite sources.
- Normal CI is unified; do not use ci:light to skip tests. See [.github/CI.md](.github/CI.md).
- FN-004 is a completed archived asset. Do not apply it to new-operation canonical. Its manual workflow pins saved code/data and origin/main.
- Owner confirmed 2026-11-25: no rulesets, classic branch protection or required checks. Do not add protection settings without authorization. Human verifies final CI and merges sequentially after checking latest main.
