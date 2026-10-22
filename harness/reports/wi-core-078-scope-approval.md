# WI-CORE-078 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** respuestas escritas directamente por el usuario en el chat de la sesión Core, el 2026-10-21, a la pregunta de alcance con los números del informe SDD.

- **WI-A:** «Apruebo WI-CORE-078». Alcance aprobado: (1) escape del valor en los mensajes de error de `LLM_REASONING_EFFORT` y `SANDBOX_POLL_*` (helper `echoEnvValue`: recorta a 40 puntos de código y escapa después; el texto no cambia para valores normales); (2) `SANDBOX_MAX_POLL_ATTEMPTS` entero 1..600 y `SANDBOX_REQUEST_TIMEOUT_MS` entero 100..60000 ms con el patrón de `validateSandboxPollSettings` (regex `^\d+$`, ausente = default, vacío o con unidad/decimal/notación científica = error con mensaje claro); valores y defaults actuales siguen válidos; sin cambio de contrato.
- **O3:** «No tocarlo». `pollAfterMs` fuera de la cota de latido queda como observación sin cambio (sumarlo llevaría `heartbeatStaleMs` de 5 393 500 a 8 993 500 ms, +1 hora de detección de un intento muerto: cambio de comportamiento observable que requeriría su propio WI y aprobación).
- **WI-B (WI-CORE-079):** «Mantener esperar». La errata E-01 de `ExperimentResultsResponse` sigue anotada en `errata-pendientes-interop.md` y se corrige junto con el próximo cambio de INTEROP por otro motivo; WI-CORE-079 queda en cola sin ejecutar y sin ronda extra de espejos; E-02 se corrige en el siguiente evento de Contract Sync que haya.

Sin push, PR ni merge; sin tag. Antes de desplegar conviene revisar en Render `SANDBOX_MAX_POLL_ATTEMPTS` y `SANDBOX_REQUEST_TIMEOUT_MS` (fallarían, por ejemplo, 1000 intentos o 120000 ms, o valores con unidad, decimales o notación científica).
