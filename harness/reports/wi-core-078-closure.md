# WI-CORE-078 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: validación de entorno endurecida según el alcance aprobado por el usuario el 2026-10-21 (O3 sin tocar; WI-CORE-079 en espera). Commit de código `83d758e`.

- **Escape (L1):** `echoEnvValue` recorta a 40 puntos de código y escapa después (`JSON.stringify` más U+007F–U+009F, U+2028 y U+2029); ESC/ANSI, `\r`, `\n` y `\u0085` salen escapados; valores normales dan el mismo texto que antes. Se usa en `LLM_REASONING_EFFORT`, `SANDBOX_POLL_RETRIES`, `SANDBOX_POLL_RETRY_DELAY_MS` y los dos topes nuevos.
- **Topes:** `SANDBOX_MAX_POLL_ATTEMPTS` entero 1..600 (default 120) y `SANDBOX_REQUEST_TIMEOUT_MS` entero 100..60000 ms (default 10000), con la regla estricta de `SANDBOX_POLL_*` (regex `^\d+$` tras trim, `Number.isSafeInteger`, ausente = default, vacío = error, `1e3`/`0x10`/`+3`/decimal/unidad/fuera de rango = error). Defaults compartidos en `app/src/config/sandbox-poll.defaults.ts`; sin cambio de comportamiento con valores válidos o ausentes.
- **Revisión independiente (`reviewer`):** APPROVED, ciclo 1 de 2, 7 de 8 mutaciones detectadas (la que sobrevive es redundante, ver F-1); 259 e2e pasan; sin literales U+2028/U+2029/U+0085 en `app/src` (`wi-core-078-independent-review.md`). `contract-reviewer`: no aplica (`contractImpact=false`); sin Contract Sync.
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.
- Evidencia técnica: `wi-core-078-technical-checks.md` (2646 tests unitarios, 259 e2e).

## Antes de desplegar

Revisar en Render `SANDBOX_MAX_POLL_ATTEMPTS` y `SANDBOX_REQUEST_TIMEOUT_MS`: el arranque fallaría con 1000 intentos, 120000 ms, vacío, o valores con unidad, decimales o notación científica. Si no están definidas, valen los defaults.

## Observaciones no bloqueantes

- **F-1 (baja):** la asignación del valor normalizado de `SANDBOX_MAX_POLL_ATTEMPTS` a `validated` no está protegida por una prueba (la mutación sobrevive porque `plainToInstance` ya convierte `' 600 '` a 600); defensa redundante.
- **F-2 (informativa):** no se añadió una prueba de `sandboxHttpBoundMs` con los topes máximos (la función es aritmética pura y no cambió; el peor caso con T=60000, P=600, R=10, D=30000 da ≈ 5,8e8 ms, muy por debajo de 2^53). Opcional.
- **Con los topes máximos la cota de latido no queda acotada de forma conjunta** (un tope por variable): con 600 intentos y 60 s de timeout sube a unas 40 horas; una cota conjunta rechazaría combinaciones plausibles y no se recomendó.
- **O3** (`pollAfterMs` fuera de la cota de latido): sin tocar por decisión del usuario; sumarlo llevaría `heartbeatStaleMs` de 5 393 500 a 8 993 500 ms (+1 hora de detección de un intento muerto).

**WI-CORE-079** (errata E-01, INTEROP-2.20): en cola, sin ejecutar por decisión del usuario («mantener esperar»). Cola de Core: solo ese WI. Sin push, PR ni merge; sin tag.
