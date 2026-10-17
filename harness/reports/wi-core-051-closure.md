# Cierre — WI-CORE-051
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 (según el coordinador) · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-058

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-051-independent-review.md` (agente `reviewer`, ciclo 1 de 2, APPROVED, 6 mutantes detectados, sin blockers ni decisiones abiertas). Alcance aprobado por el usuario («WI de código y UPDATE puntual»). El usuario es informado y puede reabrirlo. No autoriza push.

## Qué entrega
El análisis de PR persiste el ZIP del workspace en `project-versions/<version.id>/snapshot.zip` y guarda `snapshotKey` en la `ProjectVersion` tras `completeAndPromote`; un fallo de Storage o del update no rompe el Run (warn con solo el nombre del error; `snapshotKey` queda null). Código en `11de8ff0ad7cce7f1c74346355d1e5cdffca7fc5`; evidencia `harness/reports/wi-core-051-technical-checks.md`. Sin tocar experimentos, OE2/OE5, evidencia, métricas, contratos ni la base real.

## Notas
F1 (la prueba de idempotencia verifica determinismo de clave), F2 (ZIP huérfano si `put` ok y `setSnapshotKey` falla), F3 (`zipDirectory` síncrono: memoria/latencia en repos grandes), F4 (informativo): menores, sin acción. **Backfill de las versiones previas: no se hizo**; opción para el usuario: UPDATE puntual sobre la base real con autorización explícita (el coordinador ya hizo uno para la versión 7c419f87).
