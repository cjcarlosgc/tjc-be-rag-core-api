[leader] · WI-CORE-038 · Evidencia de implementación documental

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

**Estado:** cambio documental canónico implementado; no se modificó `app/`, no se implementó el almacenamiento ni se provisionó infraestructura.

## Resultado

Por delegación explícita del usuario, `DEC-CHECK-002` elige PostgreSQL administrado, dedicado y bajo ownership exclusivo de GitHub Integration para la coordinación durable entre réplicas. No se comparte la base de dominio Supabase/Core ni se limita el servicio a una sola instancia. `GH-INTEROP-1.5` precisa la identidad única, el claim transaccional, las transiciones de creación/actualización inciertas, la reconciliación, el fail-closed, la auditoría, la retención, la migración y el cutover.

La garantía es una reserva durable con como máximo un intento automático de creación mientras el resultado remoto sea incierto; no se promete exactly-once ni se permite repetir un `POST` a ciegas. Se mantiene la request y respuesta exitosa existentes (`200 { checkId }`); las identidades temporalmente no verificables responden `503 GITHUB_CHECK_COORDINATION_UNAVAILABLE`, mientras se conserva el `409` para identidad ambigua. No se modificaron DTOs públicos SYSTEM/INTEROP ni las versiones de esos contratos.

## Entrega a consumidores

El Contract Sync `CS-CORE-20261011-004` publica los tres espejos canónicos a Console y GitHub Integration. Console debe espejar y validar, sin cambio de código/API. GitHub Integration debe sincronizar su WI local, alinear su excepción de stack para permitir solo esta base técnica, e implementar la migración/coordinación y su operación según GH-INTEROP-1.5. El evento no es evidencia de que alguno de esos trabajos o de infraestructura externa ya esté hecho.

## Validaciones

- `node harness/validate-harness.mjs` — PASS.
- `node harness/validate-work-items.mjs` — PASS (38 WI).
- `node --test harness/*.test.mjs` — PASS (29/29).
- `git diff --check` — PASS.
- Contract Sync `start` e `implementation-delivery` de WI-CORE-038 — cero eventos pendientes relevantes; dos eventos previos se excluyeron con revisión de alcance registrada.
- No se ejecutaron lint/build de producto: el WI solo cambia SDD, contratos, changelog, Harness y Contract Sync; no hay cambios en código de producto.

**FilesAffected:** contratos `spec/contracts/{github-integration-contract,system-contract,interoperability-contract}.md`; feature 016 (`spec.md`, `plan.md`, `tasks.md`); punteros `spec/README.md`; `CHANGELOG.md`; registro Harness y reportes; evento de salida para Console y GitHub Integration.

**NoProductChanges:** Core no implementa el almacén de Checks ni toca otros repositorios. No se autorizaron provisión, deploy ni cutover externos.
