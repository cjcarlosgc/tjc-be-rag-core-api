# WI-CORE-069 — aprobación de alcance y contratos
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** aprobación escrita por el usuario directamente en el chat de la sesión Core, el 2026-10-18. Antes, la sesión cross había relayado una aprobación del usuario («Apruebo todo»); el sistema de permisos exigió confirmación directa, que el usuario dio después.

Cita literal del usuario: «Apruebo el alcance de WI-CORE-069, la publicación por Contract Sync de SYSTEM-2.13, INTEROP-2.17, GH-INTEROP-1.8 y spec/contracts/schemas a Integration, Console y Sandbox, y las dos notas editoriales de INTEROP §5 y §10.»

Aprobado:
1. Alcance del WI retroactivo (PRODUCT, `contractImpact=true`, `publishesContract=true`, HU11/HU14/HU17, `ST-CORE-076`) que cubre `3955398..6714019`; `5fa5666` y `9945342` quedan fuera; no se reescribe historia.
2. Publicar por Contract Sync a `github-integration`, `console` y `sandbox` SYSTEM-2.13, INTEROP-2.17, GH-INTEROP-1.8 y `spec/contracts/schemas/` con `examples/`.
3. Dos notas editoriales aditivas en INTEROP: §5 (`pollAfterMs` opcional en el GET de estado, tope de 30 s, reintentos de GET) y §10 (la validación en frontera de Core es solo aviso en log, de forma transitoria).

Decisiones ya cerradas que no se reabren: `phase` opcional, `CONSOLE_CORS_ORIGINS` opt-in, timeout de 8 s del webhook, historial git. Sin push, PR ni merge.
