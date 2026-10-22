# WI-CORE-073 (WI-C) — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** respuesta escrita directamente por el usuario en el chat de la sesión Core (pregunta de alcance con la configuración recomendada), el 2026-10-19: «Apruebo todo lo recomendado».

## Alcance aprobado (configuración recomendada del informe SDD)

1. **Códigos genéricos** alineados con el Sandbox, con mensaje fijo en español que no repite el texto de la excepción: `UNAUTHORIZED` 401 y `FORBIDDEN` 403 (retryable false); `NOT_FOUND` 404, `METHOD_NOT_ALLOWED` 405, `NOT_ACCEPTABLE` 406, `CONFLICT` 409 (false); `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `UNPROCESSABLE_ENTITY` 422 (false); `TOO_MANY_REQUESTS` 429 y `SERVICE_UNAVAILABLE` 503 (true); 5xx sin código (500/502/504) → `INTERNAL_ERROR` (false); cualquier otro 4xx → `HTTP_ERROR` (false). Un código explícito de `AppException` siempre prevalece; un 400 sigue siendo `INVALID_REQUEST`; los 59 códigos existentes no cambian.
2. **`retryable`** solo en los códigos genéricos (true en 429 y 503, false en el resto); los demás errores de Core siguen sin emitirlo; `retryable` y `phase` siguen opcionales en el esquema.
3. **Parser de body** (`request-body-parsers.ts`: 413/400 y 401): se deja como está.
4. **Versión:** una sola **INTEROP-2.18** junto con WI-D. WI-C edita el contrato con `publishesContract=false`; WI-D añade §6.6 a la misma 2.18 y publica el juego único de eventos de Contract Sync a github-integration, console y sandbox.
5. **Tesis Anexo E (C-01–C-10):** se cita por referencia, sin reproducir ni inventar su texto (no existe en `spec/` ni en `harness/reports/`).
6. **DEC-ERR-001 (PROPOSED):** se registra para trazabilidad normativa de los códigos genéricos.

Cambio aditivo/documental en el contrato (`code` es string abierto: solo cambian descripciones del esquema, un ejemplo nuevo y el `ErrorCode` interno de Core); sin push, PR ni merge; sin tag.

## Errata (implementación)

El informe SDD y el alcance decían «59 códigos existentes»; el enum tenía **62** en `HEAD`. La regla aprobada no cambia: ningún código existente cambia (ni sus mensajes) y un 400 sigue siendo `INVALID_REQUEST`.
