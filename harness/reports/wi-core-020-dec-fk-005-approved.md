# WI-CORE-020 — DEC-FK-005 aprobada (opción A)

Modelo: leader (Sonnet 5.5 / Medium), estado, spec y reportes.

El Human Reviewer eligió la opción A en chat (2026-10-08). `DEC-FK-005` pasa a APROBADO en `spec/contracts/system-contract.md` (commit `0c9965e`), `plan.md` de `013-pr-driven-analysis` y `CHANGELOG.md` quedan alineados. Se descartan B y C.

- WI-CORE-020: `W-DECISION_REQUIRED` -> `W-IN_PROGRESS`; `blockingDecisionIds: []`, `DEC-FK-005` pasa a no bloqueante (resuelta); `noBlockingDecisions: G-PASSED`. Gates de implementación, checks técnicos, revisión contractual, revisión independiente y sync se reinician a `G-NOT_RUN` porque la migración se rediseña.
- Contract Sync: `CS-CORE-20261008-006` apunta a la revisión `2b0e89a` de `system-contract.md`, que cambió; no se altera. Se emite el documental adicional `CS-CORE-20261008-007` (sourceRevision `0c9965e`), sin cambio funcional, para que Console y GitHub Integration refresquen el espejo SYSTEM.
- Siguiente: implementer-high rediseña la migración y las pruebas contra un Postgres docker desechable.
