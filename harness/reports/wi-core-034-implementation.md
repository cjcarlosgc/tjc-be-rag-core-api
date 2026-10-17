[leader] · WI-CORE-034 · Evidencia de implementación documental

Modelo: leader · configurado gpt-6-luna · atendido gpt-6-luna · esfuerzo xhigh

**Estado:** implementación documental verificada; no se modificó `app/`.

## Resultado

La aclaración aprobada por el usuario está consolidada en GH-INTEROP-1.4 y alineada con SYSTEM-2.6 / INTEROP-2.7. `DEC-CHECK-001` define identidad por repositorio GitHub estable, GitHub App, `headSha` y `name` exacto; persistencia durable del `checkId`; convergencia concurrente; y error `GITHUB_CHECK_IDENTITY_AMBIGUOUS` para candidatos duplicados. La selección de mecanismo sigue siendo responsabilidad de GitHub Integration.

La superficie previa de ruta y request se conserva. La revisión contractual independiente aprobó el contenido y comprobó esta compatibilidad en `harness/reports/wi-core-034-contract-review.md`.

## Evidencia de propagación

- La revisión canónica está en el commit `46c7046d015d18e49b0e737f6b61cceef1d6889c`; los tres eventos de Core (`CS-CORE-20261010-001/002/003`) apuntan a esa revisión y cubren los consumidores requeridos.
- Los espejos de SYSTEM, INTEROP y GH-INTEROP comparan byte por byte con Core en los worktrees locales de Console y GitHub Integration. Están modificados sin commit en esos repositorios; Core no los editó. La igualdad de contenido está verificada, no se afirma persistencia en commits consumidores.
- En los inbox consumidores, GH acusó `CS-CORE-20261010-001/002` y Console resolvió `CS-CORE-20261010-003` con evidencia de `cmp`. Los estados del consumidor viven en sus copias inbox; el outbox productor se conserva en `C-PENDING` por regla del importador.
- Core resolvió `CS-GH-20261010-001` en su inbox contra GH-INTEROP-1.4 mediante `node harness/contract-sync.mjs resolve`; `implementation-delivery` y `before-review` quedaron registrados con cero pendientes relevantes. Ni esta resolución ni los ACK de Core hacia GH significan que `WI-GH-012` esté implementado.

## Checks ejecutados

- `node scripts/sdd-check.mjs` — PASS.
- `node harness/validate-work-items.mjs` — PASS (35 WI).
- `node harness/validate-harness.mjs` — PASS.
- `git diff --check` — PASS.
- `npm run lint` — PASS.
- `npm test` — PASS (135 archivos pasaron, 6 omitidos; 2076 tests pasaron, 104 omitidos).
- `npm run build` — PASS.

**FilesAffected:** `harness/reports/wi-core-034-implementation.md` (evidencia); contratos, changelog, eventos y espejos citados son cambios previos ya registrados en Git.

**NoProductChanges:** no hubo cambios de código, rutas, DTOs, despliegue, cutover ni infraestructura externa.
