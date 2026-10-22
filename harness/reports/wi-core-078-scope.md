# WI-CORE-078 (WI-A) — endurecer la validación de entorno (L1, topes del Sandbox, evaluar O3)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Origen: observaciones del cierre de WI-CORE-077 (`wi-core-077-closure.md`, L1 y topes) y de WI-CORE-071 (O3), por pedido de cross con decisión del usuario. **El alcance lo aprueba el usuario en el chat de Core antes de implementar.**

## Propuesta

1. **L1:** escapar el valor repetido en los mensajes de error de entorno (p. ej. `JSON.stringify` del valor recortado a 40 caracteres) en `SANDBOX_POLL_*` y `LLM_REASONING_EFFORT` (y `LLM_MODEL` si aplica el mismo patrón), para que un valor con saltos de línea o caracteres de control no parta una línea de log. Sin cambio de qué se acepta o rechaza.
2. **Topes superiores** para `SANDBOX_MAX_POLL_ATTEMPTS` (hoy `>= 1`, sin tope) y `SANDBOX_REQUEST_TIMEOUT_MS` (hoy `>= 100`, sin tope): el análisis SDD propone rangos y defaults que **no cambien el comportamiento con los valores actuales válidos** (defaults de código y `.env.example`); un valor por encima del tope falla el arranque con mensaje claro.
3. **O3 (`pollAfterMs` fuera de la cota de latido):** se **evalúa primero**; si tocarlo cambia el comportamiento observable (tiempos, relanzamientos), no se toca sin una decisión explícita del usuario.

Sin cambio de contrato; sin push, PR ni merge; sin tag.
