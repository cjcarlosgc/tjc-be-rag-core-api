# Contract Sync — CS-CORE-20261011-006

**WI emisor:** `WI-CORE-040`
**Estado publicado:** `C-PENDING`
**sourceRevision:** `313f560d405a582cd549255e27d5630bd668ad7e`
**Revisión contractual:** `APPROVED`; consumidores aún pendientes.

## Alcance publicado

- Targets: `github-integration`, `console`.
- Scope: `spec/contracts/system-contract.md`, `spec/contracts/github-integration-contract.md`.
- `breaking: true`: se retira la garantía operativa de coordinación compartida multiinstancia y se exige una sola instancia activa; no cambian DTOs públicos.
- Integration debe importar/acknowledge bajo WI local, actualizar los espejos a SYSTEM-2.8/GH-INTEROP-1.7, revisar o sustituir WI-GH-012 para retirar PostgreSQL/multiinstancia y luego implementar/verificar conforme a 1.7.
- Console debe importar/acknowledge bajo WI local, actualizar los espejos y validar el sync sin cambio de UI.
- El evento distingue expresamente `C-ACKNOWLEDGED` (recepción/compromiso) de implementación y exige evidencia del WI consumidor para resolver.

## Evidencia

- La fuente canónica está en el commit `313f560d405a582cd549255e27d5630bd668ad7e`; el `sourceRevision` del evento coincide con ese HEAD al publicar.
- `node harness/contract-sync.mjs publish --id CS-CORE-20261011-006 ...` — PASS; archivo creado en `harness/contract-sync/outbox/CS-CORE-20261011-006.yaml`.
- Contract Reviewer: `APPROVED`, sin hallazgos; confirmó el scope, targets, clasificación breaking, fuente y acciones por consumidor.
- No se copiaron contratos a los repos consumidores, no se creó ni alteró su WI y no se implementó código de Integration o Console desde Core.

## Handoff de revisión

`[contract-reviewer::GPT-6 Luna / high] · WI-CORE-040 · Contract Sync` — evento aprobado; importación y evidencia de cada WI consumidor siguen abiertas. Modelo servido: `unknown`.

## Validaciones locales de Core

- `node harness/contract-sync.mjs check --checkpoint implementation-delivery --work-item WI-CORE-040 --record`: PASS; cero eventos relevantes pendientes. Los dos eventos históricos reconocidos quedaron clasificados `NOT_RELEVANT` solo para este WI; el checkpoint está registrado.
- `node harness/validate-harness.mjs`: PASS.
- `node scripts/sdd-check.mjs`: PASS.
- `node harness/validate-work-items.mjs`: PASS (40 WIs).
- `git diff --check`: PASS.
- No se modificó `app/`; lint, pruebas de producto y build no aplican a este corte documental.

La importación/espejo por los consumidores sigue pendiente en `CS-CORE-20261011-006` (`C-PENDING`). Por eso `interopSyncChecked` permanece `G-NOT_RUN` y WI-CORE-040 sigue abierto; estas validaciones no acreditan la implementación de Console o GitHub Integration.
