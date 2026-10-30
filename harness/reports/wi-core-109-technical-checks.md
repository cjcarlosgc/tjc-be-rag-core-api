# WI-CORE-109 — comprobaciones técnicas (HU18, captura armada del próximo PR elegible)

Modelo: claude-haiku-5-5 (Haiku 5.5), rol `implementer`, sin commit, push, stash ni checkout.
Alcance: `wi-core-109-scope.md` (D1–D4 aprobadas por el usuario). Solo `app/` modificado, más este informe.
Contrato INTEROP-2.25 y spec 008 los escribe el leader; no se editó `spec/`, `CHANGELOG.md` ni `harness/` (salvo este informe).

## 1. Comandos y resultados

| Comprobación | Comando (desde `app/`, con `PATH=/Users/cjcarlosgc/.local/node22/bin:$PATH`) | Resultado |
|---|---|---|
| Esquema válido | `corepack pnpm@12.14.0 exec prisma validate` | OK |
| Cliente regenerado | `corepack pnpm@12.14.0 exec prisma generate` (dentro de `build`) | OK |
| Migración sobre base ya migrada | `DATABASE_URL=…55439/rag_core_ct… prisma migrate deploy` | aplicada; `migrate status`: 49 migraciones en total, base al día |
| Migración desde cero | `prisma migrate deploy` sobre base nueva `rag_core_fresh` (luego eliminada) | 49 migraciones aplicadas (todas) |
| Deriva Prisma ↔ BD (objetos nuevos) | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | sin líneas sobre `experiment_captures` ni `experimentCaptureId` |
| Suite unitaria (sin BD) | `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run` | **217 ficheros OK, 12 omitidos; 3908 pruebas OK, 136 omitidas** (referencia: 3859 / 125; +49 pasan y +11 omitidas, las 11 pg nuevas sin BD) |
| E2E (`test/*.e2e-spec.ts`, config propia) | `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run --config ./vitest.config.e2e.ts` | **9 ficheros, 268 pruebas OK** (incluye la matriz de acceso ruta × rol) |
| Specs pg (todos) | `CT_TEST_DATABASE_URL` y las 7 variables `*_TEST_DATABASE_URL` = `postgresql://postgres:postgres@127.0.0.1:55439/rag_core_ct?schema=public`; `vitest run --reporter=default .pg.spec.ts --no-file-parallelism` | **11 ficheros, 135 pruebas OK** (incluye 11 de captura) |
| Lint | `corepack pnpm@12.14.0 lint` (`oxlint src/ test/`) | sin avisos, rc 0 |
| Build | `corepack pnpm@12.14.0 build` (`prisma generate && nest build`) | rc 0 |
| Typecheck de producción | `corepack pnpm@12.14.0 exec tsc --noEmit -p tsconfig.build.json` | rc 0 |
| Contratos (tipos generados) | `corepack pnpm@12.14.0 contracts:check` | rc 0 (sin cambios en `spec/contracts/schemas/`) |
| Harness | desde la raíz: `node harness/validate-harness.mjs` / `node harness/validate-work-items.mjs` / `node scripts/sdd-check.mjs` | OK / OK (108 WI) / OK |

Pruebas de consistencia con el contrato (leídas en `test/support/interop-role-matrix.ts` y `test/access-matrix.e2e-spec.ts`): pasaron con el texto de INTEROP-2.25 que el leader ya escribió (filas Reader y Maintainer, §6.13). No hizo falta reportar mensajes de fallo del contrato.

Nota: `tsconfig.json` (sin `build`) arrastra errores preexistentes en `scripts/evidence-extractor/*.spec.ts`; no son de este WI.

Nota de entorno: la primera suite lanzada en segundo plano con `&` dentro de un subshell se cortó; se relanzó como comando de fondo directo. El test `common/sanitize-failure-message.util.spec.ts` (`no deja fragmento…`, 5 s) falló una vez bajo carga de la suite (timeout) y pasa en aislado (108/108); no está relacionado con este cambio.

## 2. Cambios

**Datos (`app/prisma/`)**
- `schema.prisma`: enum `ExperimentCaptureStatus {ARMED, RESERVED, DISARMED}`; modelo `ExperimentCapture` (`@@map("experiment_captures")`, índice `(projectId, createdAt)`); `AnalysisRun.experimentCaptureId String? @unique` con relación `onDelete: Restrict`; `Project.experimentCaptures`. Se restauró el esquema desde `HEAD` y se reaplicaron solo estas ediciones: `prisma format` había reformateado 269 líneas ajenas.
- `migrations/20261030100000_experiment_captures/migration.sql` (escrita a mano): enum, tabla, columna y FK en `analysis_runs`, índice único parcial `experiment_captures_one_armed_per_project_key ON (projectId) WHERE status = 'ARMED'`, índice único `analysis_runs_experimentCaptureId_key`, FKs, `ENABLE ROW LEVEL SECURITY` y `REVOKE` a `anon`/`authenticated` (mismo bloque que `20261013100000`). Sin backfill.

**Módulo `app/src/experiment-captures/`** (nuevo, registrado en `app.module.ts`)
- `dto/experiment-capture.response.ts`: `ExperimentCaptureResponse` (`captureId, projectId, status, armedBy, armedAt, reservedAnalysisRunId, reservedAt, disarmedBy, disarmedAt`) y la referencia `{captureId, reservedAt} | null` para el Run.
- `persistence/experiment-captures.repository.ts`: `arm` (traduce P2002 a `ExperimentCaptureAlreadyArmedError`), `list` (más reciente primero, cursor por id), `disarmArmed` (transacción con compare-and-set `status='ARMED'`), `reserveIfArmed` (transacción: `UPDATE … WHERE projectId AND status='ARMED' RETURNING id`, y si afecta una fila, `UPDATE analysis_runs SET experimentCaptureId`).
- `experiment-captures.service.ts`: 409 `EXPERIMENT_CAPTURE_ALREADY_ARMED`, 404 `EXPERIMENT_CAPTURE_NOT_ARMED`, paginación `limit+1`.
- `experiment-captures.controller.ts`: `POST /projects/:projectId/experiment-captures` (201, MAINTAINER), `GET …/experiment-captures` (READER), `DELETE …/experiment-captures/current` (200, MAINTAINER), todas con `@RequireProjectRole` y `ProjectTargets.project('projectId')`.
- `experiment-captures.module.ts`: sin imports de dominio (exporta el repositorio; `AnalysisRunsModule` lo importa; sin ciclo).

**Runs (`app/src/analysis-runs/`)**
- `analysis-runs.service.ts`: `startRunFromWebhook` reserva cuando `isNew && repositoryBindingEligible === true && !draft`, antes de devolver el Run. `reserveExperimentCaptureIfArmed` captura cualquier error, lo registra solo con el nombre de la clase de error, y devuelve el Run normal.
- `analysis-runs.repository.ts`: `RUN_EXPERIMENT_CAPTURE_INCLUDE` (`experimentCapture: {select: {id, reservedAt}}`) en `findByIdForOwner`, `findById`, `findByProjectForOwner` y `findVisibleForUser`: lo que alimenta respuestas o tiempo real, en la misma consulta (sin N+1).
- `dto/analysis-run.response.ts`: `experimentCapture: {captureId, reservedAt} | null` en el resumen (y por herencia en el detalle y en `analysis-run:update`).
- `analysis-runs.module.ts`: importa `ExperimentCapturesModule`.

**Checks (`app/src/checks/analysis-run-checks.service.ts`)**: `publishForRun` retorna sin llamar a GitHub Integration si `run.experimentCaptureId` es truthy; además, tras releer el Run (`findById`), vuelve a comprobar el campo, por si el llamador pasó un objeto sin él. No escribe `checkId` ni `checkPublishedAt`. Log informativo.

**Errores**: `ErrorCode.EXPERIMENT_CAPTURE_ALREADY_ARMED` y `EXPERIMENT_CAPTURE_NOT_ARMED` (`error-code.enum.ts`).

**Matriz de roles**: `test/support/interop-role-matrix.ts` (3 entradas: Reader GET; Maintainer POST y DELETE) y `test/access-matrix.e2e-spec.ts` (`ROUTE_CASES` de las 3 rutas, doble de `ExperimentCapturesService`).

**Pruebas nuevas**
- `experiment-captures/experiment-captures.service.spec.ts` (9)
- `experiment-captures/persistence/experiment-captures.repository.pg.spec.ts` (11, pg)
- `analysis-runs/analysis-runs.experiment-capture.spec.ts` (10, 3 de ellas con `it.each`)
- `analysis-runs/dto/analysis-run.response.experiment-capture.spec.ts` (5: mapeador y listas sin N+1)
- `checks/analysis-run-checks.experiment-capture.spec.ts` (11 con `it.each`)
- `ct/experiment-capture-flow.spec.ts` (13: extremo a extremo y camino por camino)

**Ajustes en pruebas existentes (solo arnés o expectativa de `include`; ninguna aserción de comportamiento cambiada)**
- `analysis-runs/analysis-runs.service.spec.ts` y `ct/ct-01-webhook-intake.spec.ts`: proveedor `ExperimentCapturesRepository` simulado en el módulo de prueba (sin él, Nest no resuelve la nueva dependencia y fallan 39 pruebas).
- `analysis-runs/analysis-runs.repository.spec.ts`: las dos llamadas a `findFirst` esperan además `include: RUN_EXPERIMENT_CAPTURE_INCLUDE`.
- `checks/analysis-run-checks.service.spec.ts`: **sin tocar**.

## 3. Qué cubre cada grupo (requisitos del alcance)

| Requisito | Prueba(s) |
|---|---|
| Servicio: armar, segunda ⇒ 409, desarmar, desarmar sin captura ⇒ 404, estados y fechas | `experiment-captures.service.spec.ts`; pg `arm`/`disarmArmed`/`list` |
| Autorización por rol (Reader lista; Writer 403 al armar/desarmar; Maintainer y Admin sí; Project ajeno 404) | `test/access-matrix.e2e-spec.ts` (ROUTE_CASES y matriz §6.13) y `default-deny.spec.ts` |
| Reserva: elegible nuevo ⇒ RESERVED y `experimentCaptureId` | `analysis-runs.experiment-capture.spec.ts`; `experiment-capture-flow.spec.ts`; pg |
| No la consumen: borrador, duplicado/HEAD sin cambios, PR anterior al vínculo (false), sin clasificar (null), ausente | `it.each` de `analysis-runs.experiment-capture.spec.ts`; flujo (`no consumen…`, `un Run creado antes de armar…`) |
| El segundo Run no reserva; captura ya consumida no se reusa | flujo (`solo el primer Run…`, `un HEAD nuevo…`); pg `una captura ya consumida o desarmada no se reserva de nuevo` |
| Fallo del reservador ⇒ Run normal y captura ARMED | `analysis-runs.experiment-capture.spec.ts` (error inesperado); flujo (`si el reservador falla…`); la reserva es transacción (pg `un fallo a mitad…` revierte) |
| Índice único parcial: una sola ARMED por Project | pg `arma…`, `el índice rechaza una segunda ARMED…` (SQL directo) |
| Dos reservas concurrentes ⇒ exactamente una | pg `dos reservas concurrentes…` (`Promise.all`) |
| Migración aplicable sobre base ya migrada y desde cero | comprobado (sección 1); RLS y definición del índice parcial verificados en pg (`la migración deja RLS…`) |
| `experimentCaptureId` único | pg `experimentCaptureId es único…` |
| Checks: Run reservado ⇒ sin llamada a Integration, sin `checkId` | `analysis-run-checks.experiment-capture.spec.ts` (todos los estados publicables); flujo (camino por camino) |
| Checks: Run no reservado ⇒ igual que antes | `analysis-run-checks.experiment-capture.spec.ts` (null y ausente); control del flujo (`control: el mismo camino sin captura…`); suite existente sin cambios |
| Respuestas con el campo (nulo y poblado), listas sin N+1 | `analysis-run.response.experiment-capture.spec.ts` |
| Extremo a extremo armar ⇒ webhook ⇒ Run reservado ⇒ snapshot ⇒ sin Check ⇒ `POST /experiments` aceptado | `ct/experiment-capture-flow.spec.ts` (primera prueba; `experiments.createRun` real con dobles, `experimentRunsRepository.create` recibe el Run reservado) |
| Caminos del snapshot/validación/continuación | `ct/experiment-capture-flow.spec.ts`, `it.each` de 6 caminos (ver límites) |

## 4. Mutaciones (cada una detectada; cada archivo restaurado y verificado con `cmp`)

| Mutación | Archivo | Pruebas que fallan |
|---|---|---|
| (a) reserva sin `AND "status" = 'ARMED'` | `persistence/experiment-captures.repository.ts` | 4 pg: `tras RESERVED o DISARMED…`, `una captura ya consumida…`, `dos reservas concurrentes…`, `experimentCaptureId es único…` |
| (b) `publishForRun` ignora `experimentCaptureId` (ambas comprobaciones) | `checks/analysis-run-checks.service.ts` | al menos 12 (la salida se truncó con `head`): los 8 estados reservados, `detecta la reserva…` (objeto sin campo), los caminos `snapshot:*` del flujo y el extremo a extremo |
| (c) reserva sin `!result.isNew` | `analysis-runs/analysis-runs.service.ts` | 3: `duplicado…`, `no consumen…`, `Run creado antes de armar…` |
| (d) reserva de borrador (sin `|| input.draft`) | `analysis-runs/analysis-runs.service.ts` | 2: `un borrador no consume…`, `no consumen…` |

## 5. Decisiones donde el alcance dejaba margen

1. `reservedAnalysisRunId` es referencia **lógica** (sin FK); la FK fuerte es `analysis_runs.experimentCaptureId` (como `experiment_runs.analysisRunId`). Evita una FK circular entre las dos tablas.
2. La captura se carga con `include` en las cuatro lecturas que alimentan respuestas. Si una lectura no la cargara, el mapeador responde `null` (no inventa `reservedAt`); el test `sin el include cargado` lo documenta.
3. La reserva devuelve `{ ...run, experimentCaptureId }` sin releer el Run: los llamadores del webhook solo usan `run.id`, y cualquier lectura posterior va a base.
4. Armar/desarmar exigen Maintainer (D2). Rutas sin `ParseUUIDPipe`, igual que los demás controladores de Project (`@Param('projectId')`).
5. Orden del listado: `createdAt desc, id desc` (igual que los Runs y las comparaciones).
6. `publishForRun`: comprobación en dos puntos (objeto recibido y lectura fresca). Se mantiene la del objeto recibido porque es la que pide el alcance; la segunda cubre llamadores con objetos anteriores a la reserva.
7. Coherencia del embudo verificada: webhook (`startRun`) pasa `repositoryBindingEligible: true` y `draft` ya filtrado (los casos `opened/ready_for_review/synchronize/edited` solo llaman si `!pr.draft`); backfill (`resumePendingEvent`) pasa `true` y `draft` tras su guarda `event.pull_request.draft` → `return`. Ambos son coherentes; no se cambió ningún llamador.
8. Tiempo real: `realtime-events.schema.json` no fija `additionalProperties: false` en las respuestas (`AnalysisRunDetailResponse` admite campos aditivos), así que el campo nuevo no rompe el esquema; `contracts:check` pasa sin cambios en `schemas/`. **Para el leader/Contract Sync:** ese esquema no declara todavía `experimentCapture`; decidir si se declara (cambio de `spec/`, fuera de mi alcance).

## 6. Límites

- **Camino por camino a nivel de servicio, no de handler.** Las pruebas de caminos usan `AnalysisRunsService` y `AnalysisRunChecksService` reales con las mismas transiciones que hacen los jobs (`startProcessing`, `recordSnapshot`, `completeRunFromSystem`, `markActionRequiredFromSystem`). No instancian `SnapshotAnalysisJobHandler`, `AnalysisRunValidationJobHandler` ni `FunctionalContinuationJobHandler` con su cola, GitHub y workspaces; eso exigiría dobles de toda su cadena y no añadiría una protección distinta al embudo `publishForRun`, que es el único punto que llama a `createCheckRun` (verificado con grep).
- **Sin red ni cola real.** El extremo a extremo usa un repositorio de Runs en memoria y una captura simulada; la atomicidad real y la concurrencia se prueban solo en las pruebas pg (PostgreSQL local, `rag_core_ct`).
- **Ciclo del webhook.** El webhook real (`GithubWebhooksService`) se cubre por `ct-01-webhook-intake.spec.ts` (sigue verde con el proveedor nuevo), no con una captura armada de punta a punta.
- **Base de datos de desarrollo de Supabase no tocada.** Solo `127.0.0.1:55439` (contenedor local descartable).
- **Deriva preexistente, fuera de alcance:** `prisma migrate diff` sigue mostrando diferencias en tablas ajenas (`context_traces`, `discovered_files`, `experiment_repetitions`: nombres truncados y tipos de timestamp). No las tocó este WI.
- **`ExperimentCapturesService` sin Prisma de memoria en el e2e de acceso:** la matriz e2e usa dobles para el servicio (igual que las demás rutas dependientes de tablas no modeladas por `InMemoryPrisma`); la lógica se prueba en las pruebas del servicio y pg.
- Sin push, PR, merge ni despliegue (D4). Sin commit.

## 7. Archivos

Creados: `app/prisma/migrations/20261030100000_experiment_captures/migration.sql`; `app/src/experiment-captures/` (controller, service, module, dto/response, persistence/repository, service.spec, persistence/…pg.spec); `app/src/analysis-runs/analysis-runs.experiment-capture.spec.ts`; `app/src/analysis-runs/dto/analysis-run.response.experiment-capture.spec.ts`; `app/src/checks/analysis-run-checks.experiment-capture.spec.ts`; `app/src/ct/experiment-capture-flow.spec.ts`.

Modificados: `app/prisma/schema.prisma`; `app/src/app.module.ts`; `app/src/common/errors/error-code.enum.ts`; `app/src/analysis-runs/analysis-runs.module.ts`; `app/src/analysis-runs/analysis-runs.repository.ts`; `app/src/analysis-runs/analysis-runs.service.ts`; `app/src/analysis-runs/dto/analysis-run.response.ts`; `app/src/checks/analysis-run-checks.service.ts`; `app/test/support/interop-role-matrix.ts`; `app/test/access-matrix.e2e-spec.ts`; pruebas existentes ajustadas: `app/src/analysis-runs/analysis-runs.service.spec.ts`, `app/src/analysis-runs/analysis-runs.repository.spec.ts`, `app/src/ct/ct-01-webhook-intake.spec.ts`.

Generados (no versionados): `app/src/generated/prisma/` (regenerado), `app/dist/` (build).
