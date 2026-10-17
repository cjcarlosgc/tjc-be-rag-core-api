# WI-CORE-003 — Carrera de ACTION_REQUIRED y Runs obsoletos

**HU:** HU08, HU14  
**Subtarea:** ST-CORE-016  
**Estado del WI:** sigue `W-IN_PROGRESS`; visto bueno personal pendiente.

## Diagnóstico

Los logs de Core para el Run `7846f0f2-6e20-43f1-9bb5-793331b597ca` muestran que a `2026-09-27T01:40:16.814Z` el job intentó cambiarlo de `OBSOLETE` a `ACTION_REQUIRED`; a `01:40:16.820Z` intentó además marcarlo `INFRASTRUCTURE_FAILURE`. El evento `pull_request.opened` del PR #3 llegó a `01:40:33Z`, después de esos intentos. El Run ya obsoleto procedía de trabajo anterior.

La evaluación funcional persistía la pregunta `PENDING` antes de cambiar el estado del Run. El cambio de HEAD podía obsoletar el Run entre ambas escrituras. Además, `GET /action-required` filtraba por el Project visible, pero no por vigencia/estado del Run asociado. Las transiciones de jobs escribían el nuevo estado sin compare-and-set.

## Corrección

- La transición condicional de `PROCESSING` a `ACTION_REQUIRED`, junto con la creación de la pregunta, ocurre en una transacción.
- Al obsoletar un Run, sus preguntas pendientes pasan a `OBSOLETE`; el borrado lógico también lo hace en la misma transacción.
- El inbox filtra preguntas por Run actual en `ACTION_REQUIRED`.
- Los jobs usan compare-and-set y el publicador vuelve a leer la vigencia antes de crear el Check; un job tardío no sustituye el estado obsoleto ni publica un Check para un Run ya obsoleto.
- No hay cambio de DTO ni migración de base de datos.

## Verificación

- `node scripts/sdd-check.mjs`: OK.
- `node harness/validate-work-items.mjs`: OK.
- `node harness/validate-harness.mjs`: OK.
- `pnpm --dir app exec oxlint src/`: OK.
- `pnpm --dir app build`: OK.
- `pnpm --dir app test`: 1,111 passed, 36 skipped; 100 test files (1 skipped).

La revisión final y el cierre de `WI-CORE-003` quedan pendientes del usuario.
