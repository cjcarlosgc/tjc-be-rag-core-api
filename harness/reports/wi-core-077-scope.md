# WI-CORE-077 — validar SANDBOX_POLL_* al arrancar
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Origen: observaciones O1–O3 del cierre de WI-CORE-071 (`wi-core-071-closure.md`) y pedido de la sesión cross. Alcance **aprobado por el usuario** directamente en el chat de Core el 2026-10-21 (respuesta «Apruebo WI-CORE-077» a la pregunta de alcance).

## Qué se hace

Validar en `app/src/config/env.validation.ts` las claves `SANDBOX_POLL_*` que Core lee (`SANDBOX_POLL_RETRIES`, `SANDBOX_POLL_RETRY_DELAY_MS` y las demás `SANDBOX_POLL_*` que el análisis SDD encuentre en `app/src/sandbox/sandbox-execution.service.ts`, `app/src/experiments/` y `.env.example`): valor no numérico, no entero donde corresponda o negativo ⇒ **fallo de arranque con mensaje claro** (hoy da `NaN`, la cota de latido deja de vencer o el servicio reintenta sin fin). Con valores válidos o con la variable ausente (se conservan los defaults actuales) no cambia nada: sin cambio de comportamiento observable, de contrato ni de DTO.

## Criterios

- Cada clave `SANDBOX_POLL_*` declarada con su regla (entero ≥ 0, o > 0 donde cero no tenga sentido, con tope razonable si el análisis lo justifica); mensaje de arranque claro con el nombre de la variable y el valor recortado (sin secretos).
- Pruebas: arranque falla con no numérico, vacío (decidir si vacío equivale a ausente o es error: el análisis lo propone), negativo, decimal y valor absurdo; pasa con valores válidos y ausentes; `.env.example` documenta las reglas.
- Sin cambio de contrato; `lint`, `build` y `test` en verde; revisión independiente.

Sin push, PR ni merge; sin tag.
