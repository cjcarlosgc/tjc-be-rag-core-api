[reviewer::GPT-6 Luna / xhigh] · WI-CORE-036 · Revisión independiente excepcional ciclo 4/4

Modelo: reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## status

APPROVED

La revisión cubre el corte aprobado de candidato único de WI-CORE-036. El usuario autorizó expresamente este ciclo excepcional 4/4 con “Sì.” y `awayMode.enabled` continúa activo. Esta aprobación no resuelve `DEC-PHP-ROOT-001` ni aprueba el subcaso de múltiples manifiestos; ese subcaso permanece aparcado.

## findings

- No quedan hallazgos abiertos del ciclo 3. La migración asigna `Project.projectRoot='.'` solo a filas `projects` con `currentVersionId IS NOT NULL`; la columna sigue nullable y los Projects sin versión vigente conservan `null`. Las pruebas cubren el predicado de migración y la respuesta del Project legacy.
- Los hallazgos anteriores sobre múltiples manifiestos y reintentos no reaparecen: el handler detecta más de un `composer.json` antes de `compare`, `startProcessing`, parseo, persistencia, promoción o resultado público. El Run se conserva `QUEUED` y se difiere con `RescheduleJobError`, sin inventar un estado de producto ni seleccionar raíz.
- Para la misma `headSha` y versión de política, el marker de parking activa una salida temprana antes de consultar binding, materializar el snapshot o redescubrir archivos. El backoff está limitado a 24 horas; `JobsRepository.reschedule` mantiene los intentos y el `JobsService` no procesa el diferimiento como fallo.
- El binding uno-a-uno, el root único anidado, los paths repo-relative y la compatibilidad TypeScript/legacy permanecen preservados. No se incorporó `GITHUB_CHECK_CREATE_REJECTED`; ese asunto corresponde a WI-CORE-039.

## blockers

- Ninguno para el alcance de candidato único aprobado en WI-CORE-036. `DEC-PHP-ROOT-001` sigue pendiente exclusivamente para dos o más candidatos `composer.json`, fuera del alcance aprobable de este corte.

## filesAffected

Archivos de implementación revisados:

- `app/prisma/schema.prisma`
- `app/prisma/migrations/20261011100000_project_roots/migration.sql`
- `app/src/prisma/project-roots-migration.spec.ts`
- `app/src/project-versions/project-root.util.ts` y `app/src/project-versions/project-root.util.spec.ts`
- `app/src/project-versions/project-versions.repository.ts` y `app/src/project-versions/project-versions.repository.spec.ts`
- `app/src/project-versions/indexing.constants.ts`
- `app/src/projects/projects.service.ts` y `app/src/projects/projects.service.spec.ts`
- `app/src/snapshot-intelligence/github-snapshot-materializer.service.ts`
- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts` y `app/src/snapshot-intelligence/snapshot-analysis-job.handler.spec.ts`
- DTOs y servicios de Project/ProjectVersion en `app/src/projects/` y `app/src/project-versions/`

Este review solo añade el presente reporte; no modifica código de producto ni Contract Sync.

## evidence

- PULL Contract Sync `before-review`, read-only, ejecutado en esta revisión: `relevantPendingSyncIds: []`; nueve eventos relevantes `C-RESOLVED` y dos eventos históricos `NOT_RELEVANT`. `checkedAt`: `2026-10-11T17:57:46.581Z`.
- Pruebas dirigidas con Vitest: 5 archivos, 66 pruebas pasaron; incluyen migración, raíz, promoción, respuesta Project y parking del handler.
- Suite completa de Vitest: 138 archivos pasaron, 6 omitidos; 2,098 pruebas pasaron, 104 omitidas.
- `pnpm run lint`, `pnpm run build` y `pnpm exec prisma validate --schema prisma/schema.prisma`: PASS.
- `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs` y `git diff --check`: PASS.
- `harness/state.json`: la excepción de WI-CORE-036 registra el máximo 4 y la autorización adicional del usuario “Sì.”; `reviewCycles=4`, `maxReviewCycles=4`, `awayMode.enabled=true`. La validación del Harness acepta el registro.

## recommendedNextStep

Registrar este veredicto como handoff del reviewer y como evidencia de `independentReviewPassed`; después ejecutar el PULL `before-done`, validar los gates de cierre y cerrar WI-CORE-036. Solo entonces continuar con WI-CORE-037. Esta revisión no autoriza push ni incorpora el cambio de GitHub Check de WI-CORE-039.
