# WI-CORE-071 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: F3 resuelto con el alcance aprobado por el usuario el 2026-10-19: la cota del tiempo del Sandbox (`sandboxHttpBoundMs`) y por tanto `heartbeatStaleMs` incluyen el tiempo máximo de los reintentos de GET, derivado de `SANDBOX_POLL_RETRIES`, `SANDBOX_POLL_RETRY_DELAY_MS` y `MAX_POLL_AFTER_MS`, sin constantes nuevas. Valores por defecto: `sandboxHttpBoundMs` 1_220_000 → 5_273_500 ms; `heartbeatStaleMs` 1_340_000 → 5_393_500 ms (≈ 89,9 min); con `SANDBOX_POLL_RETRIES=0` no cambian. Commit `1e768b6`.

- Revisión independiente (`reviewer`): APPROVED, ciclo 1 de 2, sin bloqueantes; la fórmula coincide con `withTransientRetries` y 6 mutaciones fueron detectadas (`wi-core-071-independent-review.md`).
- Tesis 3.3.8 intacta: `resolveSlotAction` sin cambios (un solo reintento de intento, sin tercer intento); los reintentos de GET no incrementan `attempt` (prueba con el cliente real y un 503 simulado: 6 repeticiones, 6 intentos únicos).
- `contractImpact=false`, `publishesContract=false`; Contract Sync `start`, `implementation-delivery`, `before-review` y `before-done` sin relevantes pendientes.
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.
- Costo conocido y aprobado: un intento realmente muerto se relanza o se cierra ≈ 67,6 min más tarde que antes.

## Observaciones no bloqueantes (sin WI propio salvo decisión del usuario)

- O1 (baja): con `SANDBOX_POLL_RETRIES` no entero (p. ej. 2.5) el servicio redondea hacia arriba y la cota hacia abajo; subestima un reintento.
- O2 (informativa, riesgo preexistente): `SANDBOX_POLL_*` no se validan en `env.validation.ts`; con `SANDBOX_POLL_RETRY_DELAY_MS` no numérico la cota da NaN, y con `SANDBOX_POLL_RETRIES="abc"` el servicio reintenta sin fin mientras la cota asume 0. Candidato a un WI de validación de configuración.
- O3 (informativa, preexistente): la cota no incluye las esperas `pollAfterMs` entre consultas de estado.

Fuera de alcance: WI-CORE-073 (WI-C) y WI-CORE-074 (WI-D), en cola; sin push, PR ni merge; sin tag.
