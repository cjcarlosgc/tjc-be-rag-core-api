# WI-CORE-109 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

## Veredicto
**APPROVED** (sin hallazgos ALTA ni MEDIA; tres BAJA opcionales). Reserva atómica correcta, camino sin captura intacto, Run reservado sin Check por todos los caminos existentes, API/roles/migración conformes al alcance aprobado (D1–D4). No sustituye la aprobación del usuario, que sigue pendiente (`W-AWAITING_APPROVAL`) ni autoriza push/PR/merge/deploy.

## Verificaciones ejecutadas (resultados reales)
| Comando | Resultado |
|---|---|
| vitest (unit) | 217 archivos / 3908 pasan, 136 omitidas |
| vitest e2e | 9 archivos / 268 pasan |
| lint, build, contracts:check | verdes |
| validate-harness, validate-work-items (108 WI), sdd-check | verdes |
| pg (`--no-file-parallelism .pg.spec.ts`) | 11 archivos / 136 pasan |
| `prisma migrate status` | 49 migraciones, al día |
| `prisma migrate diff` BD migrada vs `schema.prisma` | sin deriva en `experiment_captures` ni `experimentCaptureId` (solo renombres/tipos previos y ajenos) |
Antes/después: `git status --short` y `git diff` con SHA-256 idénticos (`a4c638f6…` / `e17634a1…`); archivos mutados restaurados con hash verificado.

## Foco obligatorio
1. **Atomicidad/concurrencia.** `experiment-captures.repository.ts` `reserveIfArmed`: `$transaction` con `UPDATE … WHERE projectId AND status='ARMED' RETURNING` y luego `analysisRun.update`; si el segundo falla, la transacción revierte el primero (prueba pg «fallo a mitad»: sigue ARMED, sin `reservedAt`). Bajo READ COMMITTED el segundo UPDATE concurrente espera el lock de fila y reevalúa `status`, por lo que gana uno. Prueba adicional propia (script desechable contra la BD local, borrado): 3 Projects × 10 Runs en paralelo, solo 2 con captura ARMED → exactamente 1 ganador por Project armado, 0 en el Project sin captura, y cada captura enlazada solo a un Run de su propio Project (`WHERE projectId` lo impide por construcción). Carrera `disarmArmed` vs `reserveIfArmed`: resultado consistente (una sola gana; `disarm` devuelve null si perdió). FK única `experimentCaptureId` verificada (P2002). Ver hallazgo B1.
2. **Elegibilidad.** `analysis-runs.service.ts` `startRunFromWebhook`: solo `isNew && repositoryBindingEligible === true && !draft`, antes de devolver el Run; los dos llamadores (`github-webhooks.service.ts:287`, `pull-request-metadata-backfill.job.handler.ts:172`) encolan el snapshot después. Único `analysisRunsRepository.create` es el de `startRunInternal` (`:219`), invocado solo desde ese embudo. Un borrador nunca crea Run por webhook (`opened/ready_for_review/synchronize/edited` devuelven null con `draft`); duplicados/HEAD igual devuelven `isNew:false`. Segundo Run: sin fila ARMED, no reserva (pg y servicio).
3. **Camino sin captura.** `publishForRun` solo añade `if (run.experimentCaptureId)` y la segunda comprobación sobre el Run releído (cero consultas extra); las respuestas solo ganan `experimentCapture: null`; el coste en el embudo es una transacción `UPDATE … RETURNING` sin filas. Diff de tests tocados: `analysis-runs.repository.spec.ts` (+`include` esperado), `analysis-runs.service.spec.ts` y `ct-01` (+provider simulado `reserveIfArmed→null`), `access-matrix.e2e-spec.ts` (+3 rutas y override del servicio), `interop-role-matrix.ts` (+3 filas). Ninguna aserción eliminada ni debilitada.
4. **Run reservado sin Check.** `createCheckRun` solo lo llama `AnalysisRunChecksService.publishForRun` (`analysis-run-checks.service.ts:64`); `publishForRun` solo se invoca desde `snapshot-analysis-job.handler.ts`, `functional-continuation-job.handler.ts` y `analysis-run-validation-job.handler.ts`. Reconciliación, backfill, obsoletar por HEAD nuevo y cierre de PR no publican Checks. El compañero PR (`test-publications`, job `test-publication`) solo se encola por acción manual de usuario (`test-publications.service.ts:79`); no hay publicación automática.
5. **API/autorización.** POST 201 Maintainer, GET Reader, DELETE `current` Maintainer; el guard `ProjectTargets.project('projectId')` da 404 a no visibles y 403 a rol menor (prueba e2e de matriz por rol; el proyecto borrado lógicamente no es visible → 404). El `projectId` sale solo de la ruta (sin cuerpo). 409 por P2002 sin lectura previa; NOT_ARMED 404 (`disarmArmed` null si RESERVED/DISARMED). Paginación `createdAt desc, id desc` + cursor por id (UUID validado, `limit` 1–100, `forbidNonWhitelisted` rechaza query desconocida). POST ignora cualquier cuerpo (no declara DTO), lo cual es coherente con el alcance.
6. **Datos/migración.** SQL: enum, tabla, FK `RESTRICT`, índice único parcial `WHERE status='ARMED'`, columna nullable única + FK, RLS y REVOKE con el patrón de las migraciones previas; rollback manual documentado; sin deriva con `schema.prisma`. `git diff` de `schema.prisma`: +39 líneas, todas del WI (sin reformateo de líneas ajenas). Como las demás, no es idempotente al reaplicarse (Prisma no la reaplica). No hay borrado duro de Projects ni de Runs en `src`, por lo que `RESTRICT` no rompe ningún flujo.
7. **Respuestas de Run.** `experimentCapture` siempre presente. Mapeadores: `toAnalysisRunSummaryResponse` (listas), `toAnalysisRunDetailResponse` (detalle y `analysis-run:update`, vía `findById`), todas con `include` en `findByIdForOwner`, `findById`, `findVisibleForUser`, `findByProjectForOwner` (un `findMany` con join, sin N+1). No hay otro constructor de `AnalysisRunSummaryResponse`. `analysis-run:update` incluye el campo; `contracts:check` verde y sin cambios de esquemas.
8. **Mutaciones (todas detectadas salvo lo indicado).**
| Mutación | Resultado |
|---|---|
| Quitar `status='ARMED'` del UPDATE | 4 pruebas pg fallan (incl. concurrencia) |
| No comprobar `isNew` | 3 fallan (servicio y CT) |
| No comprobar `draft` | 2 fallan |
| No comprobar elegibilidad | 4 fallan |
| Quitar 2.ª comprobación en `publishForRun` | 1 falla |
| Quitar 1.ª comprobación en `publishForRun` | 8 fallan |
| Quitar traducción P2002 | **0 fallan en la suite sin BD** (ver B2); 4 fallan con la prueba pg |
| Quitar `include` en `findByProjectForOwner` / `findVisibleForUser` / `findById` | 1 falla en cada caso |
| POST con rol Writer | 2 fallan (e2e de matriz) |
9. **Alcance.** Integration, Sandbox y Console sin cambios en sus árboles (Console solo conserva un inbox untracked previo de `CS-CORE-20261026-001`); `app/package.json` y lockfile intactos; sin cambios en estados de AnalysisRun; pruebas con fixtures (la pg usa la BD local descartable).

## Hallazgos
- **B1 (BAJA) — `reserveIfArmed` no protege a un Run ya enlazado.** `experiment-captures.repository.ts` (`tx.analysisRun.update` sin `experimentCaptureId: null` en el `where`). Reproducido con script propio: armar, reservar el Run X, armar otra, reservar de nuevo X → ambas capturas quedan `RESERVED` apuntando a X y el Run se sobrescribe a la segunda; la FK única no lo impide (es única por captura, no por Run). No alcanzable hoy: el embudo reserva solo en `isNew` y una sola vez por Run. Endurecimiento opcional: `updateMany` con `where {id, experimentCaptureId: null}` y revertir si `count 0`.
- **B2 (BAJA) — la traducción P2002 solo se prueba con la BD.** En `experiment-captures.service.spec.ts` el repositorio va simulado y lanza ya el error de dominio; sin `CT_TEST_DATABASE_URL` quitar el `catch` de `arm` sobrevive. Con la BD (CI de Postgres) la prueba pg lo atrapa. Opcional: spec unitaria del repositorio con Prisma simulado que lance `{code:'P2002'}`.
- **B3 (BAJA) — ventanas de fallo parcial, fail-safe.** Si `reserveIfArmed` falla tras crear el Run, el Run publica Check normal y la captura sigue ARMED (consume el siguiente PR, no el «siguiente por resultado»); si tras reservar falla el `enqueue` del snapshot, la captura queda consumida con un Run sin job (misma fragilidad que ya existe para cualquier Run). Ambas conformes al alcance (§3.3 del alcance); solo conviene declararlas como límites.

## Qué debe corregirse
Nada bloqueante. Opcional antes de cerrar: B1 y B2. Queda pendiente la aprobación del usuario (alcance/contrato, `W-AWAITING_APPROVAL`).
