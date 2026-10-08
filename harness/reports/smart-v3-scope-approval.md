# Autorización de alcance — SMART V3 (Core)

**Fecha:** 2026-10-08 (America/Lima)
**Autoriza:** usuario

El usuario aprobó de una vez el alcance de `WI-CORE-017` a `WI-CORE-027`, para que los Leaders locales los tomen en orden de dependencias sin pedir aprobación por corte. La aprobación cubre los comportamientos y contratos descritos en SYSTEM-2.6 e INTEROP-2.7 y las decisiones `DEC-EXP-FK-001` (cerrada), `DEC-EXP-003`, `DEC-FK-001`, `DEC-FK-002` y `DEC-ORG-003`.

Decisiones confirmadas por el usuario: OE2 encaja en HU05 y HU17 sin HU nueva; las reglas ACTIVE múltiples se distinguen con un `scenarioKey` derivado por Core; Writer puede todo lo del Maintainer salvo responder preguntas funcionales y registrar `UNKNOWN`; `UNKNOWN` deja la pregunta `PENDING` y el Run en `ACTION_REQUIRED`; el agente generalista puede leer las pruebas existentes; PHP y Sandbox (`WI-CORE-013`, `WI-CORE-028`, `WI-CORE-029`) se difieren sin bloquear el resto.

Esta autorización no cubre `WI-CORE-028` ni `WI-CORE-029` (diferidos), no autoriza push, PR, merge, despliegue ni cambios en Sandbox, y no sustituye la revisión humana de cada WI antes de `W-DONE`. `WI-CORE-017` queda sujeto a la revisión humana de la SDD preparada.
