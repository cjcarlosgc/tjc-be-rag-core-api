[sdd-analyst::GPT-6 Luna / high] · WI-CORE-038 · Verificación SDD

Modelo: sdd-analyst · configurado gpt-6-luna · atendido unknown · esfuerzo high

**status:** `SPEC_VERIFIED`.

**findings:**

- El WI usa HU14/HU15, `ST-CORE-045`, dependencia local `WI-CORE-034` (`W-DONE`) y las rutas canónicas del contrato y feature 016. La rama de trabajo es `feature/jean`.
- El usuario delegó explícitamente a Core la decisión del handoff adicional de `WI-GH-012`. `DEC-CHECK-002` selecciona PostgreSQL técnico, administrado y propiedad exclusiva de GitHub Integration; no comparte la base de dominio Core/Supabase, no restringe el servicio a una réplica y no autoriza provisión externa.
- `GH-INTEROP-1.5` delimita identidad y unicidad, reserva antes del POST, `CREATE_UNKNOWN`, `CREATE_REJECTED`, serialización de actualizaciones y `UPDATE_UNKNOWN`, límites de retry, reconciliación, operación auditada, retención, migración/cutover y fallos cerrados. No promete exactly-once remoto.
- El `POST /internal/v1/github/checks` conserva request y respuesta exitosa `{ checkId }`; el contrato añade el error 503 de coordinación/reconciliación y los consumidores toleran `204` durante la transición. SYSTEM/INTEROP conservan sus versiones y apuntan a GH-INTEROP-1.5.
- `node harness/validate-harness.mjs` pasó; el checkpoint Contract Sync `start` de WI-CORE-038 registra cero pendientes relevantes. No encontré decisión `PENDING`/`PROPOSED` bloqueante aplicable.
- El alcance queda fuera de `app/`, de otros repositorios y de cambios/provisión externos. El CS pendiente asigna espejo a Console e implementación/migración local a GitHub Integration; los ACKs no se tratarán como evidencia de implementación.

**blockers:** ninguno para `SPEC_VERIFIED`.

**filesAffected:** solo este reporte.

**evidence:** `spec/features/016-github-integration/spec.md` (`DEC-CHECK-001/002`); `spec/contracts/github-integration-contract.md` §Check, §Coordinación durable y errores; `spec/contracts/system-contract.md`; `spec/contracts/interoperability-contract.md`; `spec/features/016-github-integration/plan.md`/`tasks.md`; `harness/work-items.json` (WI-CORE-038); `harness/state.json` (PULL `start`); ejecución de `node harness/validate-harness.mjs`.

**recommendedNextStep:** completar la revisión contractual y Contract Sync de salida, registrar la entrega documental en Core y obtener revisión independiente antes de cerrar WI-CORE-038. Mantener la implementación de PostgreSQL, pruebas/cutover y operación en WI-GH-012; Console solo actualiza sus espejos.
