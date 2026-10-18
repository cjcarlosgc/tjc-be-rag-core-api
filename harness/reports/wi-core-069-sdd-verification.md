Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-069 — verificación SDD del corte «desde cross»

Rango revisado: `62938f3..6714019`, limitado a 3955398, 3e66b2a y 6714019. Los commits de SDD 3.1 (5fa5666, 9945342) están fuera de alcance. No se ejecutaron lint, build ni tests (análisis estático del diff).

## Veredicto: CHANGES_REQUESTED (ajustes menores; ninguna decisión bloqueante)

## 1. Coherencia contratos, esquemas, ejemplos y código

El texto normativo (SYSTEM-2.13, INTEROP-2.17, GH-INTEROP-1.8) es coherente con los esquemas y con el código en lo esencial: `phase` opcional, `retryable?`, `executionProfile` requerido en `RunnerFacts`, y GH-INTEROP-1.8 apuntando al `ErrorEnvelope` completo. `sandbox.types.ts` deriva de los tipos generados. `all-exceptions.filter.ts` ya emite la forma del envelope.

Contradicciones y huecos concretos:

- **F1 (medio): `pollAfterMs` en la respuesta de estado.** `sandbox-execution.service.ts` (`pollUntilTerminal`) lee `status.pollAfterMs` de `GET /executions/{id}`. `SandboxExecutionStatusResponse` en `spec/contracts/schemas/sandbox-execution.schema.json` no lo declara, aunque el esquema admite campos aditivos. INTEROP §5 (línea 87) dice que `pollAfterMs` va en la creación asíncrona, no en el GET. Core lo trata como opcional y lo acota a 30 s. Ese tope (`MAX_POLL_AFTER_MS`, 30 s) y los reintentos (`SANDBOX_POLL_RETRIES`, `SANDBOX_POLL_RETRY_DELAY_MS`) no están en INTEROP ni en el esquema; solo en los informes cross y en `.env.example`. Es un comportamiento de Core, no de cable, pero conviene una línea en INTEROP §7.
- **F2 (bajo): validación solo informativa.** `warnOnContractDrift` valida únicamente `SandboxExecutionAcceptedResponse` y `SandboxExecutionResultResponse`. La respuesta de estado y el request de creación no se validan en runtime; el request sí tiene contract test (`sandbox-execution.contract.spec.ts`). INTEROP §10 dice que cada backend valida «las respuestas y los inputs que recibe de otro servicio en la frontera (sin `as T`)». El código sigue usando `getJson<{...}>` con genéricos, que es un `as T` implícito. Hay que declarar la brecha como transitoria o acotar §10. Está alineado con la decisión de cross de no endurecer lecturas, pero la prosa sobrepromete.
- **F3 (bajo): `phase`.** El esquema y la prosa son coherentes con Core, que no lo envía. La brecha OC09 sigue abierta y queda declarada. Es una decisión del usuario, no se reabre.
- **F4 (bajo, `Sha256` y `url`).** `EphemeralDownloadRef.url` exige el patrón `^https://`. Si Core usa URLs firmadas de almacenamiento local o `http` en dev, el contract test lo detectaría; el diff no muestra fallo. Sin acción.

## 2. Criterios de aceptación

Los criterios del WI son verificables en lo funcional: lint, build, test, `contracts:check` y los validadores. El cuarto criterio exige «publishedSyncIds», que aún no existen (`W-SELECTED`).

- **Alcance silencioso o sin criterio explícito:**
  - `.nvmrc`, `engines` y `packageManager` aparecen en el alcance del WI (reporte de regularización) pero solo vagamente en los criterios.
  - El workflow de CI (`.github/workflows/ci.yml`) tiene un trabajo Postgres con `continue-on-error`, informativo.
  - Cambios menores en `realtime.gateway.ts` (CORS para socket.io), `main.ts` (red de seguridad de proceso) y specs pre-existentes (`repetition-artifact.spec.ts`, `map-sandbox-result.spec.ts`, `sandbox-evidence-facts.spec.ts`): ajustes por tipos generados.
  - Recomendación: añadir el criterio «CI definida; el trabajo Postgres es informativo y no se ha ejecutado en GitHub» y «gateway Socket.IO usa el mismo origen que HTTP».
- **Criterios sin evidencia todavía:** CI no ejecutada en GitHub (lo dice el informe fase 3); reviewer y contract-reviewer pendientes; `publishedSyncIds` vacío.
- **Refactor «sin cambio de lógica»:** el diff mueve ~600 líneas entre `experiment-job.handler.ts`, `experiment-attempt-presenters.ts` y `experiment-job.helpers.ts`. No hay prueba de equivalencia más allá de los tests existentes (2481 pasan). El reviewer debe confirmar el movimiento con un diff por hunks.
- **Dependencia `dependsOn: WI-CORE-068`:** verificar que esté cerrado (pendiente de comprobar por el leader).

## 3. Decisiones (Blocks)

Ninguna decisión `D-PENDING`/`D-PROPOSED` alcanza este corte. Las decisiones del usuario (phase opcional, `CONSOLE_CORS_ORIGINS` opt-in, timeout de 8 s, historial git, ciclos de revisión) están cerradas y no se reabren.

- **Bloqueantes:** ninguna.
- **No bloqueantes (PENDING/PROPOSED existentes que no tocan el corte):** `DEC-VAL-001` (alcance de datos de validación en repos piloto), `DEC-RAG-001` (test-aware retrieval), `DEC-PHP-ROOT-001` (varios `composer.json`; su `Blocks` es la feature 019) y `DEC-INF-002` (reflejada como PROPOSED en `spec/features/018-php-laravel-support/tasks.md` línea 9, aprobada as-built en SYSTEM-2.12). Esta última merece reconciliar el estado en las tasks, pero fuera de este WI.
- Cuestión de proceso (no decisión SPEC): la regularización retroactiva debe quedar registrada como excepción única; el WI ya lo hace.

## 4. Riesgos y Contract Sync

Riesgos:

- **Despliegue (CORS):** sin `CONSOLE_CORS_ORIGINS` el CORS sigue abierto (aprobado). Riesgo residual de seguridad hasta que el usuario lo defina en Render. Origen exacto sin barra final.
- **pnpm 12 en lockfiles:** si Render usa un pnpm antiguo, el primer build puede fallar. `engines: node >=22 <23` puede rechazar el build si Render usa otro Node.
- **Sandbox sin persistencia:** tras reiniciar, Core recibe 404 en ejecuciones previas; los reintentos solo cubren 408/425/429/5xx, no 404. Es comportamiento previo, no regresión.
- **Reintentos de GET:** hasta 3 reintentos con espera exponencial por consulta; en el peor caso un job espera más. El POST no se reintenta (correcto por idempotencia).
- **`uncaughtException` apaga con código 1** tras `app.close()`: si `close()` se cuelga, no hay temporizador de salida forzada. Menor.
- **Datos:** sin migraciones ni cambios de esquema de BD en el diff.

Contract Sync (acciones por consumidor):

| Consumidor | Qué debe hacer | Breaking |
| --- | --- | --- |
| github-integration | Espejar `system-contract`, `interoperability-contract`, `github-integration-contract` y `schemas/` byte a byte. Emitir `ErrorEnvelope` completo con `retryable` siempre presente (GH-INTEROP-1.8). | No para consumidores que ignoran campos desconocidos. Aditivo. Core como consumidor del callback debe tolerar los campos nuevos. |
| console | Espejar los mismos documentos y `schemas/`. Ignorar campos desconocidos y `retryable?`. Su origen debe estar en `CONSOLE_CORS_ORIGINS` cuando el usuario la defina; si no está listado, el navegador fallará. | No hoy (CORS abierto); pasa a breaking operativo al activar la variable si el origen no coincide. |
| sandbox | Espejar los documentos y `schemas/`; migrar de SYSTEM-2.2. Validar que respuestas incluyan `executionProfile` en `RunnerFacts` y `stage` válido en la evidencia (ahora normativos). Seguir aceptando request sin `phase` (equivale a `GENERATED_TESTS`). | `executionProfile` requerido en `RunnerFacts` es la única restricción nueva sobre el Sandbox; si un Sandbox anterior no lo emite, Core solo avisa en log (no rompe). |

## 5. Secretos, hosts e IP en el árbol actual

- IP/hostname de la VM del Sandbox (`136.115.2.208`, `136-115-2-208.sslip.io`): sin coincidencias en el árbol versionado. Redacción correcta.
- Credenciales tipo `ghp_`, `sk-`, claves privadas: solo fixtures de prueba (`sanitize-failure-message.util.spec.ts`). Las cadenas `postgresql://usuario:clave@...` y `postgres:postgres@127.0.0.1` son valores de ejemplo y de CI local.
- **F5 (medio): residuos sin redactar de Supabase.** El ref `<SUPABASE_PROJECT_REF>` sigue en `app/.env.example` línea 6 (`SUPABASE_URL`) y en `spec/constitution/tech-stack.md` línea 12 (ref, URL pública y host PostgreSQL `db.<ref>.supabase.co`). El commit 3955398 pretendía redactar «host de BD» y no alcanzó `tech-stack.md`. No es un secreto (el ref es identificador), pero contradice el propósito del commit y es más sensible con el host de BD expuesto. Como el repo pasará a privado, es riesgo bajo; aun así conviene reemplazar por `<SUPABASE_PROJECT_REF>` o aceptarlo explícitamente en el WI.
- Token de context7 e IP en el historial: ignorados por decisión del usuario.

## IDs de decisión

Ninguna decisión bloqueante. Cerradas por el usuario y no reabiertas: phase opcional, `CONSOLE_CORS_ORIGINS` opt-in, timeout de 8 s, historial git, ciclos de revisión.

## Cambios solicitados antes de implementar la regularización final

1. Documentar en INTEROP §7 (o declarar fuera del cable) `pollAfterMs` opcional en el estado, el tope de 30 s y los reintentos de GET (F1).
2. Acotar la frase de INTEROP §10 sobre validación en frontera o declararla transitoria (F2).
3. Añadir criterios para CI, `engines`/`.nvmrc`/`packageManager` y el gateway Socket.IO (alcance silencioso).
4. Decidir sobre los residuos de Supabase (F5): redactar o aceptar expresamente.
5. Confirmar que `WI-CORE-068` está cerrado.

## Resolución del leader (ciclo SDD)

- F1/F2: nota añadida en INTEROP §5 (`pollAfterMs` opcional en el GET de estado, tope de 30 s, reintentos de GET) y §10 (validación en la frontera es transitoriamente solo aviso en log para Core). Aditivo y documental; se publica dentro de INTEROP-2.17.
- F5: redactado el ref de Supabase en `app/.env.example` y `spec/constitution/tech-stack.md`.
- Alcance silencioso: se añade al WI un criterio para CI, `engines`/`.nvmrc`/`packageManager` y `realtime.gateway.ts` (mismo origen CORS), y se pide al reviewer comparar los hunks del refactor de `experiment-job.handler.ts`.
- Decisión sobre DEC-INF-002 (`spec/features/018-php-laravel-support/tasks.md` línea 9 en PROPOSED): no bloquea este corte; queda anotada para el WI de 018.
