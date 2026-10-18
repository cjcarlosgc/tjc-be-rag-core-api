# Fase 3 — estabilización de backends, entorno y CI (ejecutada desde la sesión cross)

Fecha: 2026-10-18. Ejecutada por la sesión cross por orden expresa del usuario (excepción puntual «desde cross»), sin WI. Commits en `feature/jean`, sin push.

## Qué cambia

### Core
- **Poller de jobs:** `JobsService.tick()` captura cualquier fallo de infraestructura (p. ej. un corte de Postgres en `claimNext`, `complete` o `fail`) y reintenta en el siguiente ciclo. Antes la promesa rechazada llegaba a `unhandledRejection` y tumbaba el proceso.
- **Proceso:** `enableShutdownHooks()` y red de seguridad (`unhandledRejection` se registra sin apagar; `uncaughtException` se registra y apaga de forma ordenada con código 1).
- **Sandbox:** reintentos con espera creciente en las consultas GET (estado y resultado) ante fallos transitorios (red, tiempo de espera, 408/425/429/5xx); el POST de creación no se reintenta. El `pollAfterMs` que informa el Sandbox se acota a 30 s.
- **CORS:** `CONSOLE_CORS_ORIGINS` restringe HTTP y WebSocket a los orígenes de la Console. **Si la variable no está definida, el comportamiento sigue abierto** (se avisa en el log) para no romper un despliegue que aún no la configuró.
- **`.env.example`:** completado (`JOBS_STALE_LOCK_MS`, `ACCESS_RECONCILIATION_*`, `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS`, `SANDBOX_POLL_*`, `CONSOLE_CORS_ORIGINS`).
- **Refactor:** `experiment-job.handler.ts` baja de 1843 a 1244 líneas moviendo, sin cambios de lógica, siete funciones de presentación a `experiment-attempt-presenters.ts` y los tipos y auxiliares de módulo a `experiment-job.helpers.ts`.
- **Lint:** `pnpm lint:types` (oxlint con tipos, `no-floating-promises` como error).

### Sandbox
- Repositorio de ejecuciones acotado (terminadas: 24 h y 500 como máximo; las en curso no se expulsan).
- Tope de concurrencia `SANDBOX_MAX_CONCURRENT_EXECUTIONS` (4); las demás esperan en `PENDING`.
- Reconciliación de contenedores `sandbox-*` huérfanos al arrancar.
- `enableShutdownHooks()`, red de seguridad de proceso y validación de entorno (un número mal escrito ya no cae en silencio al valor por defecto).
- `.env.example` completo (incluye `SANDBOX_PNPM_STORE_VOLUME`).

### GitHub Integration
- Los 4xx no previstos (405, 415...) responden `INVALID_REQUEST` no reintentable; antes eran un `503 GITHUB_UPSTREAM_UNAVAILABLE` reintentable. Un 413 conserva su estado.
- `CheckCoordinationStore` descarta entradas `ACTIVE` ociosas (24 h); nunca los estados de incertidumbre.
- Red de seguridad de proceso y configuración de Prettier (sin reformatear código existente).

### Los cuatro
- `engines: node >=22 <23`, `.nvmrc` (22), `@types/node` ^22 y `packageManager: pnpm@12.14.0` (Console: sin `packageManager`, ver pendientes).
- CI en `.github/workflows/ci.yml`: validadores SDD, `contracts:check`, lint, build y tests. Core agrega un trabajo con Postgres/pgvector para las specs `*.pg.spec.ts`.
- Console: `VITE_CORE_API_URL` fijada en `.env.test`; el test `RunsPage` que fallaba dependía del `.env` local (ignorado por git) de quien lo escribió.

## Correcciones a lo dicho antes
- **`no-floating-promises` no habría detectado el bug del poller:** usaba `void this.runOnce()`, que la regla permite a propósito. La corrección real fue capturar el error en su origen; el script `lint:types` queda como red adicional.
- La falta de `phase` en Core no se tocó (ver informe de la Fase 2).

## No se hizo
- **Refactor completo de `runAttempt`** (~350 líneas, con estado compartido) y **extracción del pipeline compartido** entre `experiment-job.handler.ts` y `analysis-run-validation-job.handler.ts`: requieren un WI con revisor independiente.
- **Timeout de 8 s del webhook Integration→Core:** está fijado por el contrato y por el límite de entrega de GitHub (10 s). No se puede absorber un arranque en frío de Render dentro de esa ventana; la mitigación es mantener Core caliente (o rediseñar el webhook para responder primero y procesar después).
- **Códigos genéricos de Core** para `HttpException` sin código (hoy `INVALID_REQUEST` también para 403/404): requieren ampliar el contrato.
- **Estado de lifecycle formal del Sandbox** y persistir ejecuciones (`WI-SANDBOX-010` sigue `W-PLANNED`).

## Al desplegar
1. Core: definir `CONSOLE_CORS_ORIGINS` con el origen de la Console. Sin ella CORS sigue abierto.
2. Sandbox: tras reiniciar, Core recibe 404 en las ejecuciones previas (el estado es en memoria).
3. Los lockfiles de pnpm se regeneraron con pnpm 12 (formato `9.0` intacto, con sufijos de peer-dependencies). Si Render usa una versión antigua de pnpm, comprobar el primer build.
4. La CI no se ha ejecutado en GitHub: se verificó cada paso en local. El trabajo de Postgres es informativo (`continue-on-error`).

## Verificación local

| Repo | lint | build | tests |
| --- | --- | --- | --- |
| Core | OK | OK | 2481 pasan, 104 omitidos |
| GitHub Integration | OK | OK | 201 pasan |
| Sandbox | OK | OK | 228 pasan, 4 omitidos |
| Console | OK | OK | 809 pasan (antes 806 y 1 fallaba) |
