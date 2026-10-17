# Revisión acumulada de entrega — `feature/jean`

Modelo: reviewer · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `xhigh`

**status:** `CHANGES_REQUESTED`

## Rango y alcance

- Base: `d838b1f5717d3a81edb99836915d976aef818a72` (`origin/feature/jean`).
- HEAD revisado: `73f3183d564423c6f9d0adbc612e004c483a4160`.
- Rango: `origin/feature/jean..HEAD` — 12 commits. Se excluyeron todos los cambios unstaged y untracked del checkout; este reporte no pertenece al rango evaluado.
- HU incluidas: `HU01`, `HU03`, `HU04`, `HU10`, `HU11`, `HU12`, `HU14`, `HU15`, `HU17`, `HU18`.
- Áreas: detección/persistencia de `projectRoot` PHP, aislamiento de análisis, transporte al Sandbox y rutas de artefactos repo-relative; contratos y Contract Sync de Check Runs; Harness y evidencia de WI-CORE-036 a WI-CORE-040.

## findings

- **[P2] Un nombre de manifiesto con capitalización distinta provoca un falso modo PHP y puede dejar el snapshot sin fuentes.** En `app/src/snapshot-intelligence/github-snapshot-materializer.service.ts:39-43`, `COMPOSER.JSON` satisface `phpProject` por el `toLowerCase()` y selecciona exclusivamente `isPhpPoolFile`. Esa lista excluye, por ejemplo, `src/index.ts`. Sin embargo, el discovery posterior no reconoce `COMPOSER.JSON`: `CONFIG_FILE_PATTERNS` en `app/src/project-versions/indexing.constants.ts:15-23` exige el nombre exacto `composer.json`, y `isPoolFile` usa esa comparación case-sensitive. Reproducción lógica verificada con esos paths: `phpProject: true`, `selected: ["COMPOSER.JSON"]`, `discovered: []`. El contrato especifica `composer.json` como marcador; el falso positivo puede convertir un repositorio TypeScript mixto en un análisis vacío. Alinear la selección y el discovery con el nombre exacto del marcador —o definir soporte case-insensitive de forma consistente— y añadir una regresión para `COMPOSER.JSON` más un archivo TypeScript.

## blockers

- El hallazgo P2 mantiene bloqueada la publicación del rango según la puerta de push: debe corregirse y revisarse nuevamente. No se encontraron otros bloqueantes en el rango.

## filesAffected

- Producto: `app/prisma/schema.prisma`, `app/prisma/migrations/20261011100000_project_roots/migration.sql`, `app/src/project-versions/`, `app/src/projects/`, `app/src/snapshot-intelligence/`, `app/src/experiments/`, `app/src/validation/`, `app/src/generation/`, `app/src/sandbox/`.
- Especificación y coordinación: `spec/features/019-project-root-detection/`, `spec/contracts/`, `CHANGELOG.md`, `harness/contract-sync/`, `harness/state.json`, `harness/work-items.json` y reportes de los WI incluidos.

## Contract Sync y estado cross-repo

- `CS-CORE-20261011-006` está `C-RESOLVED` en los inboxes de Console y GitHub Integration; `WI-CONSOLE-024` y `WI-GH-012` siguen `W-IN_PROGRESS`. Esas resoluciones documentan las acciones del evento, no el cierre de los WIs consumidores. Esto **no bloquea publicar** el rango por Contract Sync; el outbox fuente de Core puede seguir `C-PENDING` mientras cada consumidor conserva su estado local.
- Para el project root: `CS-CORE-20261011-001` está `C-RESOLVED` en Console; `CS-CORE-20261011-003` está `C-RESOLVED` en GitHub Integration. `CS-CORE-20261011-002` fue importado y `ACKNOWLEDGED` por Sandbox antes de que Core enviara el campo; `WI-SANDBOX-001` figura terminado. La acción exigida por ese evento no bloquea la publicación.
- Los eventos `CS-CORE-20261011-004` y `-005` están resueltos por Console y GitHub Integration; `-006` también. La resolución de `-006` incorpora el estado de contrato más reciente sin convertirlo en evidencia de cierre de `WI-CONSOLE-024` o `WI-GH-012`.
- Los hashes de SYSTEM-2.8, INTEROP-2.8 y GH-INTEROP-1.7 coinciden en Core, Console y GitHub Integration según la evidencia contrastada en `harness/reports/wi-core-040-interop-sync-verified.md`.

## evidence

- Trazabilidad Git: los 12 commits contienen `Refs: HU...`; todos los IDs referenciados existen en `spec/backlog.md`. Los commits están separados en cortes contractuales, sincronización, implementación de project root y cierre Harness.
- `node scripts/sdd-check.mjs` — PASS.
- `node harness/validate-harness.mjs` — PASS.
- `node harness/validate-work-items.mjs` — PASS (40 WI).
- `node harness/validate-completions.mjs` — PASS (36 WI completados).
- `node harness/contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-040` — PASS, sin eventos entrantes relevantes pendientes.
- `git diff --check origin/feature/jean..HEAD` — PASS.
- En `app/`: `npm run lint` — PASS; `npm test` — PASS (138 archivos pasaron, 6 omitidos; 2.102 pruebas pasaron, 104 omitidas); `npm run build` — PASS; `npx prisma validate --schema prisma/schema.prisma` — PASS.
- Revisión independiente específica de WI-CORE-040: `harness/reports/wi-core-040-independent-review.md` — `APPROVED`. El review acumulado mantiene `CHANGES_REQUESTED` por el hallazgo P2 anterior.

## recommendedNextStep

Corregir el falso positivo de capitalización en la selección del snapshot y agregar la regresión; después repetir lint, suite, build y validaciones aplicables, y solicitar una nueva revisión independiente del rango completo antes de publicar. No se hizo commit ni push.
