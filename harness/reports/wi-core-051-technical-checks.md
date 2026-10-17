# WI-CORE-051 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low); verificación del leader.

- Rojo → verde: 6 pruebas nuevas fallaban antes (persistencia, orden tras `completeAndPromote`, fallo de `put`/`setSnapshotKey` sin romper el Run, reintento con la misma clave, `setSnapshotKey` del repositorio); después `src/snapshot-intelligence` y `src/project-versions` 107/107. `createPending` y `completeAndPromote` no incluyen `snapshotKey` en `data` (prueba de guarda).
- `npx vitest run` (app): 140 archivos pasan, 6 omitidos; 2198 pruebas pasan, 104 omitidas.
- `npx oxlint src/snapshot-intelligence src/project-versions`: sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base; el cambio no añade errores).
- `node harness/validate-harness.mjs` y `node --test harness/*.test.mjs` pasan.
- Sin build en `app/`; `app/.env` y la base real no tocados. `app/test/support` no referencia `snapshotKey` ni `completeAndPromote`.
- DI: `ObjectStorageModule` es `@Global` y está en `AppModule`; el módulo de snapshot no necesita cambio (no verificado en arranque real: sin build).
- Riesgos declarados: `zipDirectory` es síncrono (adm-zip) y corre en el event loop antes de los símbolos (latencia en repos grandes); un fallo de Storage deja `snapshotKey` null y el experimento falla con su mensaje claro; sin backfill de versiones previas (opción para el usuario: UPDATE sobre la base real con autorización explícita).
