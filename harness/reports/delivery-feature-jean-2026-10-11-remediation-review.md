# Revisión acumulada de entrega — remediación `feature/jean`

Modelo: reviewer · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `xhigh`

**status:** `APPROVED`

## Rango y alcance

- Base: `d838b1f5717d3a81edb99836915d976aef818a72` (`origin/feature/jean`).
- HEAD revisado: `e8ec80e4d8b3d07e5a42f6ce5be73e01880b3e3a`.
- Rango: `origin/feature/jean..HEAD` — 13 commits.
- HU incluidas: `HU01`, `HU03`, `HU04`, `HU10`, `HU11`, `HU12`, `HU14`, `HU15`, `HU17`, `HU18`.
- Revisados los cambios de detección/persistencia de `projectRoot`, aislamiento PHP, transporte opcional hacia Sandbox, contratos/Contract Sync de Check Runs, Harness y WIs `WI-CORE-036` a `WI-CORE-041`.
- Los cambios locales unstaged/untracked en `AGENTS.md`, `harness/WORKFLOW.md`, `harness/agent-profiles.yaml`, `harness/roles/*.md` y `harness/reports/morning-card-cross-contract-blockers-2026-10-11.md` no forman parte del candidato revisado.

## findings

Ninguno. El P2 de la revisión previa queda resuelto: solo el nombre base exacto y case-sensitive `composer.json` activa la selección PHP o cuenta como candidato de raíz. `COMPOSER.JSON` ya no cambia el pool a PHP y, con `src/index.ts`, el materializador conserva esa fuente TypeScript. Las regresiones también mantienen los casos canónicos de manifiesto en raíz/subdirectorio y la ambigüedad de varios manifiestos exactos.

## blockers

Ninguno para publicar este rango. `DEC-PHP-ROOT-001` continúa pendiente únicamente para el caso fuera de alcance de dos o más manifiestos canónicos. Las resoluciones de Contract Sync en consumidores acreditan las acciones registradas, no el cierre de sus WIs; no se interpretan como despliegue o cutover.

## Contract Sync y Harness

- Los outboxes `CS-CORE-20261011-001` a `-006` permanecen `C-PENDING` en el productor, como corresponde a los estados locales independientes. La evidencia del candidato registra `CS-CORE-20261011-002` importado/ACKNOWLEDGED por Sandbox antes de que Core enviara `projectRoot`; `-001`/`-003` resueltos por los consumidores; y `-004`/`-005`/`-006` resueltos en Console y GitHub Integration según sus evidencias locales.
- Para `CS-CORE-20261011-006`, los hashes registrados de SYSTEM-2.8, INTEROP-2.8 y GH-INTEROP-1.7 coinciden en Core, Console y GitHub Integration; la resolución no afirma el cierre de `WI-CONSOLE-024` ni `WI-GH-012`.
- `WI-CORE-036` a `WI-CORE-041` figuran `W-DONE`, con gates obligatorios en `G-PASSED` y sin pendientes relevantes en sus checkpoints registrados `before-done`. Para WI-041, los eventos globales antiguos `CS-20260920-001` y `CS-20260921-003` están excluidos solo para su alcance, con digest y razón persistidos.
- El intento de ejecutar un nuevo PULL `before-review` tras el cierre no es aplicable porque `contract-sync.mjs check` exige un WI activo; por ello se contrastaron los checkpoints `before-done` persistidos y la evidencia de Contract Sync de cada WI, sin modificar Harness durante la revisión.

## evidence

- Los 13 commits contienen `Refs:` y todos los IDs referenciados existen en `spec/backlog.md`.
- `node scripts/sdd-check.mjs` — PASS.
- `node harness/validate-harness.mjs` — PASS.
- `node harness/validate-work-items.mjs` — PASS (41 WI).
- `node harness/validate-completions.mjs` — PASS (38 WI completados).
- `git diff --check origin/feature/jean..HEAD` — PASS.
- En `app/`: `pnpm --dir app run lint` — PASS; `pnpm --dir app test` — PASS (138 archivos aprobados, 6 omitidos; 2.103 pruebas aprobadas, 104 omitidas); `pnpm --dir app run build` — PASS; `pnpm --dir app exec prisma validate --schema prisma/schema.prisma` — PASS.
- Revisión independiente de WI-CORE-041: `harness/reports/wi-core-041-independent-review.md` — `APPROVED`, sin findings; revisión específica de WI-CORE-040: `harness/reports/wi-core-040-independent-review.md` — `APPROVED`.
- Los cambios locales listados como fuera de alcance aparecen aún en `git status --short` y no en `git diff origin/feature/jean..HEAD`.

## recommendedNextStep

El commit final exacto revisado (`e8ec80e4d8b3d07e5a42f6ce5be73e01880b3e3a`) queda `APPROVED` conforme a la puerta de push. No se modificó producto, ni se hizo commit o push. El reporte es evidencia posterior a la aprobación según `spec/constitution/delivery-workflow.md`; antes de push, comprobar que el único cambio posterior sea este reporte y que HEAD siga siendo el mismo commit revisado.
