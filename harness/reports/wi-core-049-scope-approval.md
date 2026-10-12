# WI-CORE-049 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Origen:** instrucción del coordinador en el chat de Core (relay de la solicitud del usuario; sin cita textual directa). El resultado es una decisión **PROPOSED**: no cambia la infraestructura ni la regla vigente de `DEC-INF-001`, y requiere la aprobación del usuario.

## Alcance (solo documentación; sin `app/`, VM, firewall ni Render)
- Registrar `DEC-INF-002` (PROPOSED) en SYSTEM: sustituye parcialmente solo el párrafo «Red» de `DEC-INF-001` para el servicio del Sandbox (HTTPS desde la IP de salida de Render, TLS y bearer); SSH/administración siguen IAP-only con OS Login y 2FA; el puerto del servicio nunca es público, solo detrás de un proxy TLS con firewall limitado a las IP de Render; el resto de `DEC-INF-001` no cambia.
- Riesgos honestos, criterio de reversión (volver al túnel IAP), impacto en experimentos/métricas (nulo en validez y resultados; las métricas de duración incorporan tiempo de red), cambios previstos y preguntas abiertas para el usuario.
- Corrección editorial de la deuda F3 de `WI-CORE-048` en el mismo bump (SYSTEM-2.11).
- Contract-reviewer antes de editar SYSTEM. Un WI de código pequeño (`isAllowedSandboxUrl`) queda aparte; lo de la VM es de Sandbox/Cross con aprobación operativa.
