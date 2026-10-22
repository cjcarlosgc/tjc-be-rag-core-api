# WI-CORE-077 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: las claves `SANDBOX_POLL_RETRIES` y `SANDBOX_POLL_RETRY_DELAY_MS` se validan al arrancar según el alcance aprobado por el usuario el 2026-10-21. Commit de código `cbb57db`.

- **Reglas:** ausente = default (3 y 500); vacío o solo espacios = error; `SANDBOX_POLL_RETRIES` entero 0..10; `SANDBOX_POLL_RETRY_DELAY_MS` entero 1..30000; no numérico, negativo, decimal, `+3`, `1e3`, `0x10`, fuera de rango y números enormes fallan el arranque con un mensaje claro (nombre de la variable y valor recortado a 40 caracteres, sin secretos). El valor normalizado se escribe en el config validado y llega a los consumidores como número. Defaults compartidos en `app/src/config/sandbox-poll.defaults.ts` (sin imports, sin ciclos).
- **Sin cambio de comportamiento** con valores válidos o ausentes (el servicio, la cota de latido y los defaults no cambian; contrato, DTO y rutas intactos). Único cambio observable, declarado: `1e3`, `0x10`, decimales, vacío y negativos, antes aceptados por `Number()`, ahora fallan al arrancar.
- **Revisión independiente (`reviewer`):** APPROVED, ciclo 1 de 2; 7 de 7 mutaciones detectadas; los 9 e2e (259) pasan (`wi-core-077-independent-review.md`). `contract-reviewer`: no aplica (`contractImpact=false`); sin Contract Sync.
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.
- Evidencia técnica: `wi-core-077-technical-checks.md` (2628 tests unitarios, 259 e2e).

## Antes de desplegar

Revisar en Render las dos variables: el arranque falla con `SANDBOX_POLL_RETRY_DELAY_MS=0`, `SANDBOX_POLL_RETRIES` mayor de 10, `SANDBOX_POLL_RETRY_DELAY_MS` mayor de 30000, o cualquiera vacía o con unidad. Si no están definidas, valen los defaults y no pasa nada.

## Observaciones no bloqueantes

- L1 (baja): el valor se repite en el mensaje de error sin escapar; un valor con saltos de línea interiores o caracteres de control podría partir la línea de log (requiere controlar el entorno de despliegue; mismo patrón que `LLM_REASONING_EFFORT`); mejora futura: sanear con `JSON.stringify`.
- Fuera de alcance, sin tocar: O3 de WI-CORE-071 (`pollAfterMs` fuera de la cota), `SANDBOX_MAX_POLL_ATTEMPTS` y `SANDBOX_REQUEST_TIMEOUT_MS` sin tope superior.

Cola de Core vacía. Sin push, PR ni merge; sin tag.
