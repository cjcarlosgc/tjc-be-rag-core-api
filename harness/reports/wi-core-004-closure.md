# Cierre — WI-CORE-004
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Estado:** `W-DONE` · **Historias:** HU03–HU16 · **Subtarea:** ST-CORE-004 · **Casos:** OC01–OC15

## Veredicto del usuario
Directo en el chat de Core (2026-10-12): «Sí, cerrar 004 y abrir el WI de contrato» (opción con la corrección del encabezado de la feature 013 incluida). Revisión humana: el usuario fue el reviewer independiente; no se lanzó reviewer agente.

## Qué entrega
Formalización de los happy paths OC01–OC15 en la feature 013 (entrada, salida observable, invariantes, estado final del Run y del Check, cobertura existente verificada y prueba propuesta) con las decisiones del usuario del 2026-10-12 (`wi-core-004-user-decisions-2026-10-12.md`), corrección de la narrativa de §Pipeline (respuesta tardía de OC15) y del encabezado de la feature (SYSTEM-2.9 / INTEROP-2.8 / GH-INTEROP-1.7; HU02–HU16). Solo documentación de spec y harness: el diff `04ae22b..51b9dff` no toca `app/`. Ningún caso sale de `O-CATALOGUED` (O-READY exige subcasos `OCxx.a` aprobados por el usuario).

## Deuda y siguiente
- Consolidaciones de contrato (código de error de OC15 en INTEROP §6.11, tabla y precedencia de OC08 en SYSTEM, semántica de `functionalBehaviorValidated`, `continuationAttemptId` null y OC11): WI de contrato abierto a continuación.
- WI pequeño de OC11 (mensaje y reintento) y WI de código de OC08: después, con aprobación de alcance.
- Baseline (OC09), `history` de Run y pruebas de integración de pipeline: WIs propios si el usuario los aprueba; correcciones de la vista de Console por handoff compacto tras su confirmación.
