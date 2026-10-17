# WI-CORE-036 — Revisión independiente · ciclo 2/2

Modelo: reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## status

CHANGES_REQUESTED

## findings

1. **[P1] El parking no limita las llamadas remotas a una por cada 24 horas.** El `RescheduleJobError` sí limita la frecuencia de los reintentos del job: el delay crece exponencialmente y llega a 24 h; `JobsRepository.reschedule` conserva `attempts`, y el Run queda `QUEUED` sin resultado de dominio. Sin embargo, la ambigüedad se comprueba después de `githubSnapshotMaterializerService.materialize()`. Una materialización llama a `getTree` y luego a `getFileContent` una vez por cada archivo del pool (concurrencia 8; `GithubRepositoryContentService.getFileContent` envía una sola ruta por request). Por tanto, cada reintento diario puede realizar decenas o cientos de requests remotos antes de aparcarse, no una consulta remota. El test del handler comprueba un delay de 8 minutos para `ambiguityDeferrals=3`, no la cadencia máxima ni el volumen remoto; el test de integración PostgreSQL de `JobsRepository` no se ejecutó en este entorno (60 casos skip). Mover la detección de cardinalidad al resultado de `getTree` y aparcar antes de descargar los contenidos, o documentar y probar un límite remoto distinto que esté aprobado. No convertirlo en un estado público ni cerrar `DEC-PHP-ROOT-001`.

## blockers

- El hallazgo anterior impide aprobar el parking multi-manifiesto bajo la condición de limitar la consulta remota a una por cada 24 h. El resto del corte de candidato único no queda bloqueado por `DEC-PHP-ROOT-001`.
- Este fue el ciclo 2/2: no corresponde abrir una tercera revisión automática. Tras cualquier ajuste, dejar el WI listo para revisión humana independiente.

## filesAffected

- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts`
- `app/src/snapshot-intelligence/github-snapshot-materializer.service.ts`
- `app/src/github-app/github-repository-content.service.ts`
- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.spec.ts`
- `app/src/jobs/jobs.repository.pg.spec.ts`

## evidence

- Corrección del hallazgo 1 del ciclo 1: snapshots resueltos pasan `projectRoot` a `completeAndPromote`; la escritura de `Project.projectRoot` y la promoción de `ProjectVersion` usan una transacción. Las pruebas del repositorio y handler verifican `.` para legacy/TypeScript.
- Corrección del hallazgo 2 del ciclo 1: el handler detecta más de un `composer.json` antes de `startProcessing`, compare, parseo, creación/promoción de versión, inserción de chunks/targets, y resultado público. Lanza el `RescheduleJobError` existente; `finally` limpia el workspace. `DEC-PHP-ROOT-001` se conserva pendiente.
- Código de parking: `AMBIGUOUS_SNAPSHOT_RETRY_BASE_MS=60_000`, `AMBIGUOUS_SNAPSHOT_RETRY_MAX_MS=86_400_000`; el payload incrementa `ambiguityDeferrals`. `JobsService` delega a `JobsRepository.reschedule`; `reschedule` conserva `job.attempts` y actualiza `availableAt`/payload.
- Contratos, migración aditiva, DTOs, paths repo-relative, validación de rutas y aislamiento del subtree único: sin hallazgo bloqueante en el diff revisado.
- `npm test` en `app/`: 137 archivos pasaron, 6 skip; 2091 pruebas pasaron, 104 skip. Las pruebas focalizadas de rutas/proyectos/handler/materializador/jobs: 95/95 pasaron.
- `npm run lint`, `npm run build`, `git diff --check`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs` y `node scripts/sdd-check.mjs`: PASS.
- `node harness/contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-036`: PASS, `relevantPendingSyncIds: []`; lectura sin registrar estado nuevo.
- `npm test -- src/jobs/jobs.repository.pg.spec.ts`: archivo saltado; 60 casos skip al no estar disponible la configuración de base PostgreSQL de pruebas.

## recommendedNextStep

No cerrar todavía WI-CORE-036. Si se ajusta el parking para detectar múltiples manifiestos usando solo el árbol remoto antes de bajar contenidos, ejecutar de nuevo los gates; al ser el ciclo 2/2, dejar el resultado para el reviewer humano y no lanzar un tercer reviewer IA. Mantener `WI-CORE-037` separado hasta el cierre aprobado de este WI.
