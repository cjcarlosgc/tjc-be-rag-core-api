# WI-CORE-071 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** respuesta escrita directamente por el usuario en el chat de la sesión Core (pregunta de opciones A/B/C), el 2026-10-19.

Cita literal del usuario: «Apruebo el alcance de WI-CORE-071. Política: heartbeatStaleMs se calcula incluyendo el tiempo máximo de los reintentos de GET (SANDBOX_POLL_RETRIES y SANDBOX_POLL_RETRY_DELAY_MS), derivado de las variables existentes y sin constantes nuevas. La política de relanzamiento no cambia salvo el momento en que se considera vencido un intento. Los reintentos de GET no cuentan como reintento del trial (tesis 3.3.8). Dime el valor por defecto resultante antes de implementar.»

## Alcance aprobado (equivale a la opción A del informe SDD, con la fórmula derivada de las variables existentes)

- La cota HTTP del Sandbox suma, por cada GET (hasta `maxPollAttempts` de estado y el de resultado), el tiempo máximo de sus reintentos: `(R+1)·timeout + Σ min(base·2^i, MAX)` con `R=SANDBOX_POLL_RETRIES` y `base=SANDBOX_POLL_RETRY_DELAY_MS`. Sin constantes nuevas.
- Sin cambio en la política de relanzamiento (`resolveSlotAction`: un solo reintento de intento, sin tercer intento) salvo el momento en que un intento se considera vencido.
- Los reintentos de GET no incrementan `attempt` ni cuentan como reintento del trial (tesis 3.3.8).
- `EXPERIMENT_HEARTBEAT_STALE_MS` configurado sigue mandando.

## Valor por defecto resultante (informado al usuario antes de implementar)

Defaults: timeout 10_000 ms, `maxPollAttempts` 120, `R`=3, `base`=500 ms, MAX 30_000 ms, generación 120_000 ms. Por GET: 4·10_000 + (500+1_000+2_000) = 43_500 ms (antes 10_000, +33_500 ms). Con 121 GET: +4_053_500 ms. `sandboxHttpBoundMs`: 1_220_000 → **5_273_500** ms. `heartbeatStaleMs`: 1_340_000 (22,3 min) → **5_393_500 ms (≈ 89,9 min)**. Con `R=0` no cambia. Un intento realmente muerto se relanza o cierra ≈ 67,6 min más tarde.
