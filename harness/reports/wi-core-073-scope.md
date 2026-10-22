# WI-CORE-073 (WI-C) — contrato de errores más descriptivo (propuesta de alcance, en cola)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: W-PLANNED.** Pedido por la sesión cross por decisión del usuario (se hace antes del tag `arch-v1.0`, que sigue siendo del usuario). Un solo WI activo: arranca cuando cierre WI-CORE-071. Su verificación SDD y la aprobación de alcance se piden al usuario en el chat de Core.

## Qué se propone

- Aclarar en INTEROP y en `spec/contracts/schemas/error-envelope.schema.json` (con `examples/`) los 4xx no previstos (401/403/404/405/406/415) que hoy salen como `400 INVALID_REQUEST` no reintentable sin estar enumerados en INTEROP ni en GH-INTEROP: códigos genéricos y mensajes claros.
- `retryable` y `phase` siguen opcionales. Cambio aditivo y documental, sin romper consumidores.
- Core implementa los códigos genéricos sin cambiar el comportamiento de los códigos existentes.
- Cita tesis Anexo E (C-01–C-10).

## Versión de INTEROP y Contract Sync (propuesta de Core a Cross y al usuario)

Una sola versión **INTEROP-2.18** y un solo juego de eventos CS para WI-C y WI-D, para minimizar rondas: WI-C edita el contrato (INTEROP-2.18, errores) con `publishesContract=false`; WI-D añade §6.6 a la misma versión 2.18 y **publica** los eventos para github-integration, console y sandbox (`publishesContract=true`). Contrapartida honesta: entre el cierre de WI-C y el de WI-D el canónico de Core (2.18) estará por delante de los espejos, sin consumidores afectados porque no se publica nada hasta WI-D. Alternativa: WI-C publica su propio juego (2.18) y WI-D otro (2.19), con una ronda más de importación en cada repo.
