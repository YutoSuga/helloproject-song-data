# FN-004 FA-M01 — Gate publication implementation

## Status and basis

FA-M01 remains **OPEN** until independent review, merge/post-merge verification and separate Final Acceptance. This implementation does not declare FN-004 accepted. Its basis is the approved D1–D4 [Gate publication contract](FN-004-FA-M01-Gate公開契約案.md), merged at `3f3c67b4de89a0b009976d01dc141aab1b686ee4`.

Preflight confirmed main/origin/main at that commit, a clean tree, main Actions run `43416211319` completed successfully, and 17 production entries with SHA256 `f7062983872a7e79f8fa99bf396429124437b62aa0d724df761b7ab687da1cf0`. Implementation waited for that run to finish. Production Bootstrap/Apply/Recovery was not executed.

## GP-A: contract and publication

The normative [recovery contract](../../design/functions/FN-004-反映処理・復旧.md), [bootstrap/state contract](../../design/functions/FN-004-初期化・ID状態.md), [Decision contract](../../design/functions/FN-004-判断モデル.md), [CLI contract](../../design/system/楽曲管理のCLI・画面連携.md) and [operator guide](../../management/FN-004-canonical操作ガイド.md) contain the section 10.1 deltas before the new runtime connection.

- [Gate publication](../../../src/fn004-gate-publication.js) completes metadata in its own same-directory wx/0600 candidate, syncs and verifies the creation inode and exact bytes, then links exclusively to the final name. It syncs the directory, verifies final identity/bytes, removes only its verified candidate, and syncs again. No rename fallback exists.
- [Gate leases](../../../src/fn004-gate.js) retain the original creation descriptor in their private WeakMap. Only after publication, post-acquisition guards and fresh ownership verification does the caller receive a lease. Copied tokens do not confer authority.
- EEXIST observations use a separate read descriptor and independently validate full v1 metadata/root and the final pathname identity. Stable valid other owners are BUSY. ENOENT is only evidence of a namespace race; it permits a new exclusive attempt, not a fabricated owner/release proof. Invalid bytes already observed cannot be erased by a later disappearance.
- A link exception leaves publication unknown unless the original inode and bytes are positively observed at final. Even positively observed publication after an exception returns no lease. Failure retains evidence and the original cause/errno/path/phase/descriptor. BUSY cleanup failure also retains the original contention error.
- Release revokes the lease before close/unlink/sync. Failure reobserves same/absent/other/unknown, preserves the original error and never retries unlink against a later owner. Recovery adoption and retirement ordering remain unchanged.

GateMetadataV1, GateWitness, persisted ErrorEvidence, ID rules, artifact schemas, readiness/action vocabulary and hash projections are unchanged.

## GP-B: all consumers

[Candidate classification](../../../src/fn004-gate-candidate.js) recognizes only the exact root-relative lowercase UUIDv4 namespace. [Namespace validation](../../../src/fn004-evidence-namespace.js) classifies it before generic publisherTarget. It is not added to the transaction ArtifactRef allowlist. Symlinks/nonregular entries are unsafe. A candidate name disappearing between listing and lstat confers no domain evidence; other listing/inspection errors stop with their typed cause.

This central publisher exclusion covers the existing terminal-runtime, local-evidence, collections, recovery-snapshot and executor cleanup callers. [Raw Discovery](../../../src/fn004-evidence-discovery.js) retains candidate path/kind/bytes/hash and does not parse candidates as JSON evidence. Observation v2 remains unchanged; candidate addition/change/removal changes its hash and can reject a stale run. Recovery cleanup neither deletes nor adopts orphan candidates.

[Runtime readiness](../../../src/fn004-runtime-state.js) separates exact regular candidates from bootstrap intent/temp and cleanup classification on uninitialized/genesis paths. All bootstrap/state/History/Request/terminal validations remain required. Normal Apply and retry use the existing services, not a new execution path.

[Decision acquisition](../../../src/fn004-decision-application.js) shares its existing five-second acquisition budget with [the internal monotonic context](../../../src/fn004-gate-budget.js). Namespace relinks remain bounded to eight retries and one second from first contention, limited by the remaining Decision budget. The budget does not cancel an in-flight syscall or callback. Callback entry prevents automatic redispatch. OCC still determines DECISION_HEAD_CONFLICT after acquisition; corrupt gates are not reclassified as ordinary conflicts.

No orphan GC, stale-PID unlock, candidate reuse, forced Recovery, new CLI option, or production operation is introduced. Deploy all participating readers/writers together; mixed old/new writers do not satisfy this contract.

## GP-C regression evidence

Current source ledger SHA256: `12f1205d3e7719ea6c6750359236ba4161adeff52645b44c567e32f3b250cc0f`. The ledger covers runtime/scripts/tests/workflow/package inputs and the approval schema document consumed by existing tests; documentation validation is recorded separately. The current-source focused rerun recorded identical before/after ledgers, exit 0, **148 pass / 0 fail / 0 skip / 0 cancelled**. The current source differs from the preceding148-pass ledger06b only in the CLI corrupt-final regression described below. Earlier 143-pass evidence preceded the double-I/O preservation fix and is retained separately, not reused as the final result.

| Focused file | Pass |
| --- | ---: |
| [Gate publication](../../../test/fn004-gate-publication.test.js) | 51 |
| [Real process crash and link competition](../../../test/fn004-gate-publication-crash.test.js) | 15 |
| [Candidate integration](../../../test/fn004-gate-candidate-integration.test.js) | 13 |
| [Decision lifecycle](../../../test/fn004-decision-lifecycle.test.js) | 26 |
| [Repository regression](../../../test/fn004-repository.test.js) | 37 |
| [Normal Apply guards](../../../test/fn004-normal-apply-guards.test.js) | 6 |

| ID | Direct evidence and remaining verification |
| --- | --- |
| GP01 | Completion/sync/readback/0600/inode precede lease and callback; normal release and forged/stale tokens |
| GP02 | Paused partial candidate allows another acquirer; real separate-process writer paused mid-write never exposes partial final |
| GP03 | Two independent completed publishers link one final: one winner, one BUSY; same bytes/lock ID on a different inode, adjacent BigInt inodes above 2^53, EXDEV/ENOTSUP without fallback |
| GP04 | EEXIST → actual release → ENOENT → fresh exclusive acquisition; ABA validates the replacement owner and preserves its file |
| GP05 | Nine maximum total link attempts; one monotonic second from first contention; shared expired budget; wall-clock changes; inode replacement independently validated; EIO/EACCES/EPERM retained |
| GP06 | Empty/partial/invalid UTF-8/array/unknown version/unknown field/wrong root/mode final rejected and retained; invalid observation not erased by ENOENT |
| GP07 | Before/after effects for candidate create/write/sync/readback/link/directory sync/unlink, publication true/false/unknown, descriptor/native cause and original BUSY on cleanup failure |
| GP08 | Actual SIGKILL and restart at 14 preparation/publication/response/release boundaries; no synthetic Owner/Receipt, orphan cleanup or stale-PID takeover |
| GP09 | Close-before/after-effect, unlink-after-effect, sync failure, later owner, double release and candidate cleanup failures; no foreign unlink |
| GP10 | Empty/partial/non-UTF8/full alias/orphan classification, malformed paths, unsafe entries/list failure, independent ArtifactRef rejection and fresh Recovery cleanup exclusion |
| GP11 | Raw candidate observation retained; addition/change/removal rejects stale commands, two-pass race has no allowed action; actual stale run does not mutate state/gate |
| GP12 | Same added regression FAILs on isolated pre-fix main; new runtime reaches one successful Decision update and DECISION_HEAD_CONFLICT for the loser; original races retained. A separate single-process probe held the gate and observed GATE_BUSY after 5001.842 ms with identical owner bytes and no domain artifacts |
| GP13 | Actual normal Apply with a paused competing candidate; readonly retry preserves Request bytes, state and the single History, with one initial dispatch |
| GP14 | Fresh abort/retirement retains orphan; existing adoption/successor/retirement regressions passed in the completed unfiltered full run |
| GP15 | Existing R80/R82/R83/R84, known-mixed, terminal, high-water and success/rollback regressions passed in the completed unfiltered full run |
| GP16 | Gate error projection 1/5/8/9 and single JSON; existing CLI 6/7, TTY/CI/bypass rejection and inspect/run tests passed in the completed unfiltered full run |

The final full run is one ordinary unfiltered `npm test -- --test-concurrency=1`, with TAP, JSONL, exit code, source ledgers and timestamps saved by a one-shot native job. It completed with **795 pass / 0 fail / 1 existing skip / 0 cancelled, exit 0**, identical before/after source ledgers and no timeout. FN-004 named test-file summaries within that same execution total **627 pass / 0 fail / 1 existing skip / 0 cancelled**; this is a subset, not an additional execution or an aggregate substituted for the full run. Actual full-run duration was 9,546,461.949 ms.

The first full run was deliberately interrupted after a further typed-error preservation finding; its partial logs are retained and are not PASS evidence. A second full run reproduced a legacy CLI exact-file-set assertion failure and was deliberately interrupted after preserving the evidence. The corrected CLI test verifies every existing artifact's bytes and BigInt inode, exact newly retained candidate count/type/metadata/root/filename, unchanged exit 8 and no dispatch. This implements D2 evidence retention without allowing domain changes or deleting candidates to satisfy the old test. That corrected test also passed independently in an isolated worktree with the same current source ledger (1 pass, exit 0).

The single existing local skip checks the actual GitHub Actions checkout; local fixtures run separately and CI executes that check. No new skip or relaxation of existing assertions/timeouts was added. The 6F CLI file summaries total 44 passes, including 18 actual process-kill boundaries; the GP08 gate suite adds 14 actual SIGKILL boundaries plus one independent-process link race. R80/R82/R83/R84 regressions, Request concurrency/idempotency, reader restart, known-mixed diagnostics and success/failure Recovery passed.

Rankings and site each exited 0, anomaly_count was 0, Markdown checked 33 files/522 local links/16 fragments with 0 broken, generated data/staging/rankings diff and git diff --check passed, and production remained 17 entries at the preflight hash.

A new read+close double-fault regression first reproduced the original-cause loss (47 pass/1 fail, exit 1); the fix retains the first EACCES/descriptor plus the secondary close error. The temporary 60-second diagnostic cap on the new Apply test was removed after locating a DTO assertion error; the test uses the same default timeout as existing normal-Apply tests, with its semantic assertions retained.

## Environment and operational limits

The isolated same-volume probe used Node 24.19.0/Linux 6.18.57 as UID 1000 on workspace overlay device 27. Candidate wx/0600, file sync/readback, concurrent exclusive link with EEXIST, directory sync and BigInt identity succeeded. The native same-device gate/crash suite also passed 66 tests with exit 0, no failures/skips/cancellations on the current source ledger; both fixture and repository device were 27. This is syscall evidence, not certification of storage flush behavior or physical power-cut survival.

The CI [Gate compatibility job](../../../.github/workflows/deploy-pages.yml) tests Node 20 and 24 on Linux without replacing the existing full-suite/build job. Its results must be checked on the final PR head. Unsupported primitives fail safely; no weaker fallback is provided.

Production capacity thresholds, monitoring interval/evidence storage location, actual operational volume/storage guarantees and quiescent rollout remain operator prerequisites from the approved design. Orphan candidate GC and Gate-only-orphan automatic rescue remain out of scope. Production data must remain at the preflight hash. FA-L01, SCR-002 writes, and FN-004 Final Acceptance are separate tasks.
