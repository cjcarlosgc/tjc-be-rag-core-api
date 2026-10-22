# WI-CORE-079 (WI-B) — errata E-01 del contrato (propuesta, en cola)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: W-PLANNED.** Se ejecuta después de WI-CORE-078. **Alcance y publicación los aprueba el usuario en el chat de Core.**

## Propuesta

Corregir en INTEROP §6.5 la prosa de `ExperimentResultsResponse` (hoy lista `analysisRunId` y `symbol`; el código emite `targetId`) y, si aplica, esquemas y ejemplos (`spec/contracts/schemas/`): solo documenta lo real, **no cambia el DTO**. Es una **nueva versión documental de INTEROP** (el número lo decide el leader: la siguiente a INTEROP-2.19, es decir 2.20) con un Contract Sync informativo (`breaking: false`) a console, github-integration y sandbox. En ese evento se corrige además E-02 (`scopePaths` del evento de Sandbox lista un archivo que no espeja); E-02 no justifica una versión por sí sola.

## Costo que el usuario debe aceptar antes de publicar

Una **ronda extra de espejos** en los tres repos (los espejos de `interoperability-contract.md` deben ser idénticos byte a byte), solo por una errata. El 2026-10-21 el usuario había decidido «esperar y juntarla con el próximo cambio» (`errata-pendientes-interop.md`); este WI revierte esa decisión por pedido nuevo de cross y requiere su confirmación directa. Console está ocupado con su WI de UX y luego un polling de respaldo: la publicación se coordina con cross.

---

## DECISIÓN DEL USUARIO (2026-10-21, chat de Core): «Mantener esperar»

Con el costo explicado (INTEROP-2.20 y una ronda extra de espejos en los tres repos solo por una errata), el usuario mantiene su decisión anterior: **no se ejecuta ni se publica** WI-CORE-079 ahora. La errata E-01 se corrige junto con el próximo cambio de INTEROP por otro motivo (`errata-pendientes-interop.md`); E-02 se corrige en el siguiente evento de Contract Sync. WI-CORE-079 queda en cola `W-PLANNED`, sin implementar.
