# Contract Sync provenance correction — CS-GH-20261011-003

**Purpose:** record the monotonic correction authorized by the user after the local merge review found that `CS-GH-20261011-002` referenced `feature/jean@working-tree` instead of an immutable source revision.

## Evidence

- The original `CS-GH-20261011-002` remains unchanged in Core's inbox. Its SHA-256 before and after importing the correction is `649b9df83cf7f3fc1b93f7654f581a5badd9b6b23eb12b78062107a434b8a16f`.
- Integration created a distinct event, `CS-GH-20261011-003`, in commit `1c32c2cc0653e3a3086e9ed17ab265472151737b`.
- The correction's `sourceRevision` is the full commit `e9de71dd51c15b84d004b7f4ebb84f49213604c7`. `git cat-file -e '<sourceRevision>^{commit}'` succeeded in the Integration repository.
- Core imported only `CS-GH-20261011-003` from the Integration outbox; `consumerImportedAt` is `2026-10-12T04:32:52.678Z` UTC. The event does not modify contract text, product behavior, deployment, or cutover.
- Scope maps to the completed local `WI-CORE-040`, which owns `spec/contracts/github-integration-contract.md`. Import and acknowledgement do not rewrite that WI's closed snapshot.

## Disposition

Acknowledged as a provenance-only correction. This records Core's receipt without claiming new product implementation or changing the historical event. Integration repeated the local merge review over `origin/feature/jean..bdb57546be107c5664a56ffb889abd9d1c4e348a`; the final report is `harness/reports/merge-review-wi-gh-012-bdb5754.md` and records `APPROVED`. No push, PR, merge, or deployment was performed or authorized by this correction.

## Re-verificación idempotente — 2026-10-12

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

Contract Sync `import` sobre el outbox de Integration devolvió `imported: 0`; la importación y el `C-ACKNOWLEDGED` existentes se conservaron. El SHA-256 actual de `CS-GH-20261011-002` coincide con el valor preservado arriba; no se reescribió ese evento.
