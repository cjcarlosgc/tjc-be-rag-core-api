[sdd-analyst::GPT-6 Luna / high] · WI-CORE-034 · Verificación SDD para retomar la aclaración de Checks

Modelo: sdd-analyst · configurado gpt-6-luna · atendido gpt-6-luna · esfuerzo high

**status:** `SPEC_VERIFIED` recomendado.

**findings:**

- La dependencia `WI-CORE-026` está `W-DONE`; su aceptación incluye `checkId` en la traza y consumo de `GH-INTEROP-1.3`. `CS-CONSOLE-20261010-001` ya está `C-RESOLVED` por la implementación independiente `WI-CORE-035`; no queda pendiente el request OE5 V3 de Console.
- `DEC-CHECK-001` está aprobada explícitamente por el usuario y consolidada en `spec/features/016-github-integration/spec.md`. `GH-INTEROP-1.4` define identidad por repositorio estable/App/headSha/name, persistencia durable, convergencia concurrente, duplicados ambiguos y deja el mecanismo técnico a GitHub Integration. Las referencias SYSTEM-2.6 e INTEROP-2.7 son coherentes; no encontré una decisión `PENDING`/`PROPOSED` que bloquee este alcance.
- `CS-GH-20261010-001` está `C-ACKNOWLEDGED`, no resuelto. Su petición de aclarar identidad/selección/duplicados/concurrencia quedó atendida en el contrato canónico ya publicado. El ACK no prueba implementación de `WI-GH-012`, y el evento debe resolverse formalmente contra esta evidencia antes del cierre final de WI-034.
- Los tres eventos Core de salida existen. GitHub Integration acusó `CS-CORE-20261010-001/002`; Console resolvió `CS-CORE-20261010-003`. Los ACKs de GH no acreditan implementación de Check. Los tres espejos de ambos consumidores son byte a byte iguales a Core en el estado actual (SHA-256 SYSTEM `52f98f596c3d4efe900739b68cdb43f30716cbfe681edbd87ffae3a6c903ccf8`, INTEROP `20adb87240b479b801f57febd18d3b8020efffaa6749b3157ebb7211a9835143`, GH-INTEROP `24ba51156cf3d98edbbca836cc4563981a6f5df2b9adf2df9d0c3bd84f605e0a`). Los espejos aparecen modificados y sin commit en ambos repos consumidores; la evidencia demuestra igualdad en los worktrees, no persistencia en commits. Esto queda fuera del cambio de Core. Core debe conservar el outbox `CS-CORE-20261010-003` en `C-PENDING`: el protocolo exige eventos fuente namespaced `C-PENDING` y cada consumidor registra su estado/evidencia en su propio inbox. Por tanto, que Console tenga su copia `C-RESOLVED` es el resultado esperado, no un desfase que Core deba reconciliar.
- `node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-034` devolvió `relevantPendingSyncIds: []`; el checkpoint start quedó registrado en `harness/state.json`. Al registrar la clasificación de alcance, `CS-20260920-001` y `CS-20260921-003` quedan excluidos de checkpoints posteriores.

**blockers:** ninguno para `SPEC_VERIFIED`. Para `W-DONE` aún faltan el cierre de checkpoints/revisión y la conciliación formal del CS-GH entrante y del CS-CORE-003 saliente; esto no implica implementar el trabajo de GitHub Integration dentro de Core.

**filesAffected:** solo este reporte.

**evidence:** `harness/work-items.json` (WI-CORE-026 `W-DONE`, dependencia de WI-CORE-034); `spec/features/016-github-integration/spec.md` (`DEC-CHECK-001` aprobada); `spec/contracts/github-integration-contract.md` §Check y error `GITHUB_CHECK_IDENTITY_AMBIGUOUS`; outbox Core `CS-CORE-20261010-001/002/003`; inbox Core `CS-GH-20261010-001` y `CS-CONSOLE-20261010-001`; inbox y reportes consumer en `tjc-be-github-integration-api` y `tjc-fe-rag-developer-console`; hashes y `git status` de mirrors; checkpoint `start` no registrado, ejecutado 2026-10-11T06:11:07.883Z.

**recommendedNextStep:** registrar `SPEC_VERIFIED`, completar la ejecución documental de Core, resolver en el inbox Core `CS-GH-20261010-001` contra GH-INTEROP-1.4 y completar checkpoints/revisión. Mantener la implementación de `WI-GH-012` en GitHub Integration: los ACKs no la acreditan, y el modo fuera de casa activo dirige la revisión independiente de este WI al agente `reviewer`.
