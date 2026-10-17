# WI-CORE-036 — SDD verification

Modelo: sdd-analyst · configurado gpt-6-luna · atendido unknown · esfuerzo high

## Handoff

- `status`: `SPEC_VERIFIED`
- `findings`:
  - `WI-CORE-036` maps to `ST-CORE-043` in feature 019 and covers `HU01`, `HU03`, `HU04`, component `CORE`, sprint `PHP compatibility cross`; its acceptance criteria are traceable to the approved behavior in feature 019 and the current SYSTEM/INTEROP contracts.
  - The approved scope is the unique-candidate case: one repository remains one Project, a single PHP `composer.json` candidate determines normalized POSIX `projectRoot`, no candidate preserves legacy detection, and TypeScript remains rooted at `.`. Multiple candidates are explicitly excluded from implementation behavior; no ranking or Console selector may be added.
  - `DEC-PHP-ROOT-001` is `PENDING`, with `Blocks: spec/features/019-project-root-detection (solo el subcaso con dos o más composer.json; no bloquea candidato único)`. For this WI, record it as non-blocking and leave `blockingDecisionIds` empty.
  - Contract Sync `start` is registered for this active WI and returns zero relevant pending IDs. The checkpoint records `CS-CONSOLE-20261010-001` and the listed GH events as resolved, and two other events as acknowledged. This verifies only the local start gate; it does not prove downstream consumers have implemented or acknowledged the new outgoing INTEROP contract.
  - Contract impact is true. Contract Reviewer must independently review before implementation; no contract edits are needed to implement this already-approved single-candidate scope.
- `blockers`: none for the WI-036 unique-candidate specification scope. The multiple-candidate subcase remains blocked by `DEC-PHP-ROOT-001` and must stay out of scope.
- `filesAffected`: `harness/reports/wi-core-036-sdd-verification.md` (evidence only; no product or contract files modified).
- `evidence`:
  - `node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-036` — passed; `relevantPendingSyncIds: []`.
  - `node harness/validate-harness.mjs` — passed.
  - `node harness/validate-work-items.mjs` — passed (CORE, 38 WI).
  - `node scripts/sdd-check.mjs` — passed.
  - Canonical sources reviewed: `spec/backlog.md`; `spec/constitution/project-context.md`, `planning-model.md`, `delivery-workflow.md`; `spec/features/019-project-root-detection/{spec,plan,tasks}.md`; `spec/features/018-php-laravel-support/spec.md`; `spec/features/002-project-version-indexing/spec.md`; `spec/contracts/system-contract.md`; `spec/contracts/interoperability-contract.md`; `harness/work-items.json`; `harness/state.json`; `harness/WORKFLOW.md`; `harness/roles/sdd-analyst.md`.

## Data and implementation risks

- Persisting `Project.projectRoot` and snapshot-frozen `ProjectVersion.effectiveProjectRoot` requires a forward-only migration with `.` as the backfill/default for existing rows. Preserve historical version semantics; do not rewrite old snapshots or derive their roots from the current Project.
- Keep the existing `RepositoryBinding.repositoryId @unique` invariant and one-to-one project/repository cardinality unchanged. A single-candidate discovery must update the existing Project rather than create sibling Projects.
- Ensure path normalization and symlink containment checks use the logical snapshot root, excluding incidental ZIP wrappers. Keep public, trace, and artifact paths repository-relative even while parsing/indexing only the project subtree.
- Preserve legacy Project/ProjectVersion response compatibility, root-level TypeScript behavior, and PHP recognition without implying PHPUnit executability.
- WI-036 does not authorize Core to send `projectRoot` to Sandbox. WI-037 separately requires Sandbox support and resolved Contract Sync before transport is activated.

## Recommended next step

Set the active WI decision gate to checked with `DEC-PHP-ROOT-001` in `nonBlockingDecisionIds`, then record `sddVerified: G-PASSED` with this report as evidence. Obtain the required Contract Reviewer handoff before implementation; keep WI-037 and all external-repository work separate.
