# WI-CORE-074 (WI-D) — corte 1 (Core): informe del implementer
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Informe del implementer (transcrito por el leader). Alcance: `wi-core-074-scope-approval.md` (D1–D4 y DEC-RT-001 aprobados por el usuario).

## 1. Qué se emite y dónde

AnalysisRun (`app/src/analysis-runs/analysis-runs.service.ts`), siempre después de confirmar la escritura: `transitionTo` (tras `transitionCurrent`; cubre PROCESSING, ACTION_REQUIRED vía `markActionRequiredFromSystem`, continuación, `completeRun`, `obsoleteRun`, cierre/obsolescencia de `closeRun` y de `startRunInternal`), `completeRunFromSystem` (solo si la transición se aplicó), `recordSnapshot` (cambio del DTO sin transición; emite siempre que escribe) y la rama de `closeRun` sin transición. **No** emite al crear el Run.

Experimento (`app/src/experiments/experiment-job.handler.ts`): `statusChanged` inmediato (sin throttle) en `markStarted`, `complete`, `markFailed` (catch de `handle()`) y `markFailed` de `onExhausted` (`EXPERIMENT_WORKER_LOST`); `progressChanged` con throttle en el refresco de `onExhausted`, `closeInterruptedAttempt` (latido vencido) y tras escribir el resultado terminal de una repetición.

Emisores: `analysis-run-realtime.events.ts` (`runChanged`) y `experiment-realtime.events.ts` (`statusChanged`, `progressChanged`); puerto `realtime-publisher.port.ts` (token `REALTIME_PUBLISHER`, implementado por `RealtimeGateway`, provisto en `RealtimeModule` con `useExisting`); los servicios de dominio no importan el gateway. Eventos: `analysis-run:update` (`AnalysisRunDetailResponse`, la misma `toAnalysisRunDetailResponse` que el GET) y `experiment:update` (`ExperimentStatusResponse`, mapeo extraído a `experiments/experiment-status.presenter.ts` usado por el GET y el evento). Salas `analysis-run:<id>` y `experiment:<id>`, sin broadcast global. Garantías: post-commit, best-effort (try/catch con warn, nunca lanza), at-most-once, sin replay ni orden garantizado; el cliente reconcilia con el GET tras reconectar. Sin suscriptores no se lee la base de datos.

## 2. Handshake, suscripciones y CORS

- Handshake: sin token → `AUTH_REQUIRED` (rechazo de middleware, `retryable: false`); token inválido → `INVALID_ACCESS_TOKEN`; identidad no resuelta → `GITHUB_IDENTITY_REQUIRED` / `IDENTITY_UNAVAILABLE` (sin cambio). Mismo `SessionAuthService` que HTTP.
- `subscribe/unsubscribe` de `analysis-run` y `experiment` con el `SubscribeAck` de tres resultados y el mismo flujo que `subscribe:project-version` (método privado `subscribeResource`; Reader sobre el Project con `requireForResource`; id inexistente o sin acceso → mismo ack de denegación). `ProjectSubscriptionsService` guarda salas genéricas (`trackRoom`/`untrackRoom`) para la expulsión por pérdida de acceso; `track`/`untrack` de project-version siguen como wrappers.
- CORS (F5): el aviso «CONSOLE_CORS_ORIGINS no está configurada» sale una vez por proceso (flag y logger a nivel de módulo en `common/cors.ts`); el comportamiento de CORS no cambia.

## 3. AUTH_BYPASS

HTTP (`AuthGuard`) exige `Authorization: Bearer <valor no vacío>` en toda ruta no pública, también con `AUTH_BYPASS_ENABLED`; bajo bypass no verifica el valor (`SessionAuthService.authenticate` devuelve el usuario e identidad GitHub sintéticos). El socket aplica la misma regla: sin token (`auth.token` ni `Authorization`) rechaza con `AUTH_REQUIRED`, también bajo bypass; con cualquier token no vacío llama a `authenticate`. Consecuencia: con `AUTH_BYPASS` y sin token Console deja de conectar y debe enviar cualquier token no vacío. `AUTH_BYPASS_ENABLED` con `NODE_ENV=production` sigue prohibido por `env.validation.ts`.

## 4. Throttle del progreso

`EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS = 1500` (constante documentada en `experiment-realtime.events.ts`, no variable de entorno). Máximo un `experiment:update` de progreso cada 1500 ms por experimento; el progreso dentro de la ventana no se pierde (una emisión trailing con el estado leído al cerrar la ventana, un timer por experimento, `unref`). Los cambios de estado no pasan por el throttle: emiten de inmediato y cancelan el timer pendiente. El mapa de última emisión se borra al llegar un estado terminal.

## 5. Desvíos del informe SDD

1. Puerto: en vez de `RunEventsPublisher`, `REALTIME_PUBLISHER` más dos emisores que componen el DTO fuera del gateway.
2. `recordSnapshot` emite siempre que escribe (una lectura por cambio, solo con suscriptores).
3. `closeInterruptedRepetition` no emite por sí mismo; el progreso sale por el `refreshCompletedRepetitions` que lo acompaña.
4. La prueba «accepts a socket without a token» pasó a comportamiento `AUTH_REQUIRED` (D1/D2; único cambio incompatible).
5. `test/access-matrix.e2e-spec.ts`: la matriz §6.13 aún no lista las suscripciones nuevas; la lista `NEW_SUBSCRIBE_MESSAGES` las excluye temporalmente de la comparación de ruta por rol y se comprueba aparte que declaran Reader. Se quita en el corte 2 al actualizar §6.13.

## 6. Pendientes señalados por el implementer (cambios de estado reales que hoy no emiten)

- `functional-knowledge/functional-questions.repository.ts` (`createForCurrentRun`): pasa el Run de PROCESSING a ACTION_REQUIRED con `updateMany`, sin `transitionTo` (lo llama `functional-context-evaluator.service.ts`).
- `analysis-runs/analysis-runs.repository.ts` (`classifyPullRequest`): puede pasar un Run a OBSOLETE sin transición (lo llaman el backfill y el webhook de GitHub).
- `projects/projects.repository.ts`: al borrar un Project marca sus Runs en vuelo como OBSOLETE; los sockets del Project ya se expulsan, no se emite (constancia).

## 7. Evidencia (desde `app/`, Node 22)

| Comando | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm contracts:check` | exit 0 |
| `pnpm test` | 157 archivos pasan, 7 omitidos; 2605 tests pasan, 104 omitidos (antes 2557) |
| `pnpm test:e2e` | 8 archivos, 252 tests pasan (incluye `access-matrix.e2e-spec.ts` con las suscripciones nuevas) |
