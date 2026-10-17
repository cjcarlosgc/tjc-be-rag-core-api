Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-051 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**Veredicto: APPROVED**

Rango de código: `11de8ff^..11de8ff` (4 archivos, +154/-2; HEAD revisado 09fe101). Reviewer independiente del implementer (claude-haiku-5-5). No sustituye decisiones DEC ni aprobación de alcance; no hay decisión abierta que alcance este WI.

## Verificación por punto (evidencia ejecutada)

1. **Persistencia y consumidores.** `persistSnapshot` corre tras `completeAndPromote` con `zipDirectory(workspace.dir)` y `put('project-versions/${version.id}/snapshot.zip', buf, 'application/zip')` seguido de `setSnapshotKey`. `experiment-job.handler.ts:418-436` lee `version.snapshotKey` (string, null => error claro) y hace `objectStorageService.get(snapshotKey)`; `context-traces.service.ts:392-410` hace `get(snapshotKey)` + `zipExtraction.extract`; ambos esperan un ZIP completo, igual que lo que escribe `zipDirectory` (contraparte documentada de `listSafeZipEntries`). El Sandbox recibe esa clave vía `buildSnapshotRef` -> `presignGet(snapshotKey)` y `snapshotBuffer` (sandbox-execution.service.ts:186-200). Coherente. El ZIP incluye todo el workspace (también `projectRoot` PHP), igual que el snapshot del job de validación.
2. **Fallos.** Pruebas confirman: `put` rechazado o `setSnapshotKey` rechazado => `handle` resuelve, no se llama `setSnapshotKey` tras fallo de `put`, el check se encola, `warn` con solo el nombre del error (sin mensaje/URL firmada). `snapshotKey` queda null (no se escribe).
3. **Idempotencia.** Clave determinista por `version.id`; cada reintento llama `createPending` y obtiene otra versión => otra clave; sin sobrescritura cruzada. `createPending` y `completeAndPromote` no incluyen `snapshotKey` en `data` (pruebas de guarda); `setSnapshotKey` solo escribe esa columna.
4. **DI.** Sonda desechable (`Test.createTestingModule`, `design:paramtypes` + módulo `@Global` que provee `ObjectStorageService`): el handler compila y recibe la instancia. `ObjectStorageModule` es `@Global` y está en `AppModule`. Fakes en `app/test/support` sin cambios necesarios.
5. **Mutantes** (spec del handler, 33 pruebas): omitir `put` => 5 fallan; omitir `setSnapshotKey` => 4; relanzar el error => 2; clave sin `version.id` => 1; filtrar `error.message` en el log => 2; persistir antes de `completeAndPromote` => 1. Todos muertos.
6. **Alcance.** Solo handler, repositorio y sus specs; sin experimentos, OE2/OE5, evidencia, métricas, sandbox/, contratos, migraciones ni base real; sin secretos (las cadenas "secret" están solo en fixtures de prueba negativa).
7. **Gates** (worktrees desechables, ya eliminados; sin build): `vitest run` completo 140 archivos pasan / 6 omitidos, 2198 pruebas pasan / 104 omitidas; `oxlint src/snapshot-intelligence src/project-versions` sin hallazgos (exit 0); `tsc --noEmit` 45 errores en ambos, diff por archivo contra 11de8ff^ = 0; `validate-harness` pasa; `node --test harness/*.test.mjs` 31/31.

## Hallazgos

| # | Severidad | Hallazgo | recommendedNextStep |
|---|---|---|---|
| F1 | low | La prueba de idempotencia reutiliza el mismo `version-1` en ambas invocaciones (mock fijo de `createPending`); prueba determinismo de la clave, no que un reintento con otra versión produzca otra clave. La propiedad se cumple por construcción del código. | Opcional: ajustar la prueba en un WI futuro; no bloquea. |
| F2 | low | Si `put` tiene éxito y `setSnapshotKey` falla queda un ZIP huérfano en Storage (no enlazado). Sin limpieza. | Aceptar; considerar limpieza/backfill con la opción de UPDATE ya prevista. |
| F3 | low | `zipDirectory` (adm-zip) es síncrono y carga el ZIP completo en memoria en el event loop antes de la detección de símbolos; riesgo de latencia/memoria en repos grandes (ya declarado por el implementer). Acotado por el límite de tamaño de extracción previo. | Aceptar; vigilar en uso real. |
| F4 | info | El `warn` no conserva la causa (decisión deliberada para no filtrar URLs firmadas); el diagnóstico depende del nombre del error. | Aceptar. |

blockers: ninguno · filesAffected: `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts`, `app/src/project-versions/project-versions.repository.ts` (+ specs).

recommendedNextStep: el leader puede registrar `W-DONE` de WI-CORE-051 con esta evidencia; el backfill de versiones previas sigue como opción del usuario (no push/PR).
