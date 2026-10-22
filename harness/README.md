# Harness — checklist de homologación (SDD 3.1)

Core es la referencia del SDD y del Harness. Todo cambio de reglas se define aquí y se replica a GitHub Integration (`GH`), Sandbox (`SANDBOX`) y Console (`CONSOLE`) en el mismo corte de trabajo. Esta lista dice qué debe coincidir entre repositorios y qué puede diferir.

## Idéntico byte a byte en los cuatro repositorios

Verificable con `shasum`; si difiere, el repo está desalineado.

- `harness/agent-assignment.mjs`, `harness/contract-sync-id.mjs`, `harness/contract-sync-lifecycle.mjs`.
- `harness/roles/human-reviewer.md`.
- `.claude/settings.json` y los agentes `.claude/agents/` `sdd-analyst`, `implementer`, `implementer-high`, `contract-reviewer`, `reviewer`, `merge-reviewer`.
- `spec/contracts/schemas/` completa (esquemas JSON y `examples/`) y `app/scripts/generate-contract-types.mjs`; los tipos de `app/src/contracts/generated/` deben salir idénticos al regenerar (`pnpm contracts:check`). Para un directorio, comparar el hash agregado: `cd <directorio> && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`.
- Contratos espejados desde Core con Contract Sync: `spec/contracts/system-contract.md` e `interoperability-contract.md` en los cuatro; `github-integration-contract.md` en Core, `GH` y `CONSOLE`.

## Mismas reglas, parámetros propios del componente

Se mantienen con el mismo comportamiento, pero cada repo conserva sus diferencias legítimas:

- `AGENTS.md`, `harness/WORKFLOW.md`, `harness/roles/` (salvo `human-reviewer.md`) y `.claude/agents/leader.md`, `.claude/hooks/check-subagent-title.mjs`: las mismas reglas con redacción propia del componente (p. ej. Prisma en Core, mocks en Console, WI de ejemplo).
- `harness/validate-harness.mjs`, `harness/validate-work-items.mjs`, `harness/validate-completions.mjs`, `harness/contract-sync.mjs` y `scripts/sdd-check.mjs`. Cada uno cubre una parte: `scripts/sdd-check.mjs` y `harness/validate-harness.mjs` exigen `sddVersion: 3.1`; solo `validate-harness.mjs` rechaza `awayMode`; solo `validate-work-items.mjs` valida el campo `lane` de los WI (rechaza `FAST` con impacto de contrato); `validate-completions.mjs` y `contract-sync.mjs` no comprueban ninguno de los tres. Unificarlos en un único validador parametrizado queda como mejora futura.
- `harness/agent-profiles.yaml` (mismos perfiles; `ux-reviewer` solo en Console).
- `harness/state.json`, `harness/work-items.json`, `spec/backlog.md` y `spec/features/`.

## Diferencias permitidas

- `app/src/contracts/contract-validator.ts`: misma lógica en los cuatro; Console difiere solo en formato (sin punto y coma). Si cambia la lógica, cambia en los cuatro.

- `ux-reviewer` (rol, agente y gate `uxReviewed`) y `noMocksPresentedAsLive`: solo `CONSOLE`.
- `external-dependency-gate`, `work-item-dependencies`, `work-item-story-scope` y `calibration/`: hoy solo en Core.
- `.agents/skills`: según el stack de cada repo.

## Reglas SDD 3.1 comunes

- Revisión independiente por defecto: agente `reviewer`. El usuario aprueba alcance, arquitectura, contratos y decisiones `DEC`. No existe el «Modo fuera de casa» ni `awayMode`.
- Vía rápida: campo opcional `lane: "FAST"` en `harness/work-items.json` para WI sin impacto de contrato (ver `harness/WORKFLOW.md`).
- Reviewers bajo demanda: `contract-reviewer` solo con `contractImpact`, `ux-reviewer` solo con `uiImpact`.
- Un solo WI activo por repositorio; los agentes trabajan en paralelo dentro del corte.
- Trabajo en `feature/jean`; commit autónomo por corte; push, PR y merge solo por orden del usuario.
- La coordinación entre repositorios la hace la sesión **cross** (carpeta raíz `Tesis/`).
