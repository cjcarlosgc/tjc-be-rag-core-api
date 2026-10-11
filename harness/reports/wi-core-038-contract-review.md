[contract-reviewer::GPT-6 Luna / high] · WI-CORE-038 · Revisión contractual

Modelo: contract-reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo high

status: APPROVED

findings:
- `GH-INTEROP-1.5` mantiene request y respuesta exitosa de Checks (`200 { checkId }`) y conserva tolerancia de Core a `204`; el nuevo `503 GITHUB_CHECK_COORDINATION_UNAVAILABLE` expresa el fallo cerrado de la base/lease/reconciliación sin habilitar otra creación.
- La identidad exacta `(repositoryId, appId, headSha, name)` se coordina en PostgreSQL técnico propio de GitHub Integration, separado de dominio Core/Supabase. El contrato limita correctamente la garantía: reserva única y sin segundo create automático ante resultado incierto, no exactly-once remoto.
- `CREATE_REJECTED` define hash del request, replay del rechazo sin POST y reintento solo después de una respuesta inequívoca de no creación y request corregido/configuración auditada. `UPDATE_UNKNOWN` verifica por `checkId`, compara campos mutables explícitos y no reenvía PATCH incierto ni permite un payload distinto si no verifica.
- Las reservas/tombstones inciertos no expiran; `CREATE_UNKNOWN` no se libera por una búsqueda vacía. La resolución operativa define guardia GH, doble aprobación, auditoría append-only y estado terminal `ABANDONED`.
- Se fijan ownership, migración aditiva/lazy, drenado de instancias antiguas antes de multi-réplica, readiness, backups/PITR, métricas, alertas y runbook. No se cambia `SYSTEM-*`/`INTEROP-*` porque sus DTOs públicos no cambian; sus punteros a GH se actualizan.
- El cambio es aditivo respecto al body/éxito y restringe conductas peligrosas; no habilita infraestructura, despliegue ni cambios fuera de Core. El Contract Sync debe instruir a Console solo espejar y a GitHub Integration actualizar su WI local/tech-stack e implementar y probar la coordinación.

blockers:
- Ninguno para publicar `GH-INTEROP-1.5` mediante Contract Sync.

filesAffected:
- `spec/contracts/github-integration-contract.md`
- `spec/contracts/system-contract.md`
- `spec/contracts/interoperability-contract.md`
- `spec/features/016-github-integration/spec.md`
- `spec/features/016-github-integration/plan.md`
- `harness/work-items.json`

evidence:
- `spec/contracts/github-integration-contract.md` §Check, §Coordinación durable, tabla de errores y §Operación/compatibilidad/migración.
- `spec/features/016-github-integration/spec.md` `DEC-CHECK-002`; `spec/contracts/system-contract.md` y `spec/contracts/interoperability-contract.md` punteros a `GH-INTEROP-1.5`.
- `node harness/validate-harness.mjs`, `node harness/validate-work-items.mjs` y `git diff --check` pasan.

recommendedNextStep:
- Publicar `CS-CORE-20261011-004` con scope exacto de los tres contratos y acciones separadas para Console/GH; después ejecutar los checkpoints restantes y revisión independiente.
