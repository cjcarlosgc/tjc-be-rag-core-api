# WI-CORE-071 — F3: reintentos de GET dentro de `sandboxHttpBoundMs` (en cola)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: W-PLANNED. No se implementa ni se pide aprobación de alcance todavía.** Registrado por pedido de la sesión cross (decisión puntual del usuario) y fuera de WI-CORE-070.

## Qué es

Hallazgo F3 de la revisión de WI-CORE-069: `sandboxHttpBoundMs` (`app/src/**/attempt-recovery.ts:~99-101`) ignora los reintentos de GET al Sandbox (`withTransientRetries`, `SANDBOX_POLL_RETRIES`, `SANDBOX_POLL_RETRY_DELAY_MS`). Sumarlos a `heartbeatStaleMs` y al relanzamiento de intentos vencidos corrige que un intento con reintentos de GET pueda considerarse vencido antes de tiempo.

## Es un cambio de comportamiento observable

Cambia los **tiempos** (`heartbeatStaleMs` por defecto sube hasta ~4x; `attempt-recovery.spec.ts` fija hoy 1_220_000) y los **relanzamientos** de intentos vencidos. Por eso **requiere decisión del usuario antes de ejecutarse** y no puede entrar como refactor en WI-CORE-070.

## Marco de tesis

Tesis 3.3.8: un único reintento de trial por fallo externo demostrable (incluido `SANDBOX_RESTARTED`); la política de reintentos de transporte (GET) no repite el trial. Cualquier ajuste debe conservar esa propiedad: los reintentos de GET no cuentan como reintento del trial ni lo duplican.

## Antes de ejecutarse

1. Decisión del usuario sobre el nuevo valor y la política de relanzamiento.
2. Aprobación de alcance en `W-AWAITING_APPROVAL`; sin cambio de contrato previsto (`contractImpact=false`).
3. Depende de `WI-CORE-070` (el refactor mueve `runAttempt`).
