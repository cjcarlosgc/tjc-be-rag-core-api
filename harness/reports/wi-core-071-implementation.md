# WI-CORE-071 — implementación (F3: reintentos de GET en la cota del Sandbox)
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Informe del implementer (el leader lo transcribe; el implementer no escribe en `harness/reports/`). Cambio aprobado por el usuario (`wi-core-071-scope-approval.md`).

## Cambio

- Fórmula (`app/src/experiments/attempt-recovery.ts`): `B = T + (P+1)·((R+1)·T + Σ_{k<R} min(base·2^k, MAX))`; con `R=0`, `B = T·(P+2)`. El POST cuenta una vez; cada GET (P de estado + 1 de resultado) suma sus reintentos. Firma nueva: `sandboxHttpBoundMs(requestTimeoutMs, maxPollAttempts, retries, baseDelayMs, maxPollAfterMs)`. Sin constantes nuevas: el handler importa `DEFAULT_POLL_RETRIES`, `DEFAULT_POLL_RETRY_DELAY_MS` y `MAX_POLL_AFTER_MS` de `sandbox-execution.service.ts`.
- Handler (`experiment-job.handler.ts`): lee `SANDBOX_POLL_RETRIES` y `SANDBOX_POLL_RETRY_DELAY_MS` del `ConfigService` con los mismos defaults que el servicio. `resolveHeartbeatStaleMs` no cambió: `EXPERIMENT_HEARTBEAT_STALE_MS` configurado sigue mandando y el piso de 3×intervalo se conserva.
- Valores por defecto (T=10_000, P=120, R=3, base=500, MAX=30_000, generación 120_000): `sandboxHttpBoundMs` 1_220_000 → **5_273_500**; `heartbeatStaleMs` 1_340_000 → **5_393_500** (≈ 89,9 min). Con `SANDBOX_POLL_RETRIES=0` no cambian. Con los 60_000 de generación de los fixtures del spec, el umbral es 5_333_500.
- Hallazgo corregido: `ConfigService` entrega las claves `SANDBOX_*` no validadas como texto (`env.validation.ts` no declara `SANDBOX_POLL_*`); sin normalizar, la suma concatenaba cadenas. Se normaliza con `Number()` dentro de `sandboxHttpBoundMs` (un valor no finito cuenta como 0 reintentos).
- Fixture: en `experiment-job.handler.spec.ts`, `rowWithHeartbeat(expired=true)` pasó de 1 h a 2 h (7_200_000 ms) porque 1 h quedaba por debajo del nuevo umbral y los tests de vencimiento dejaban de vencer; consecuencia directa del alcance aprobado.
- `.env.example`: comentario actualizado con la fórmula y el valor por defecto.

## No cambia

`resolveSlotAction` (un reintento de intento, sin tercer intento), reintentos reales de GET, POST sin reintento, corte C, DTO, contratos, migraciones. Los reintentos de GET no incrementan `attempt` ni cuentan como reintento del trial (tesis 3.3.8): con un 503 transitorio en un GET de estado, las 6 repeticiones ejecutan un único intento cada una (6 `beginAttempt`, requestId de intento 1, `closeInterruptedRepetition` no llamado) y el contador del cliente marca `{status:1, result:0}`.

## Pruebas (13 nuevas)

`attempt-recovery.spec.ts`: valores con defaults; `R=0` igual a los valores anteriores; esperas acotadas por `MAX` con base alta; entrada en texto; la cota suma reintentos a cada GET sin tocar el POST; `configuredMs` vigente; piso de 45_000 sin cambios. `experiment-job.handler.spec.ts` (describe WI-CORE-071): umbral por defecto, `SANDBOX_POLL_RETRIES=0`, `SANDBOX_POLL_RETRY_DELAY_MS=1`, valores en texto, `EXPERIMENT_HEARTBEAT_STALE_MS`, GET reintentado sin incrementar el intento.

## Evidencia (desde `app/`, Node 22)

| Comando | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm contracts:check` | exit 0 |
| `pnpm test` | 155 archivos pasan, 7 omitidos; 2527 tests pasan, 104 omitidos (antes 2514, +13) |
