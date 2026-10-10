# WI-CORE-007 — Implementación (diagnóstico detallado de fallos experimentales)
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Cortes A y B por `implementer-high` (Haiku 5.5 / high; motivo: migración y saneado de secretos). Reporte redactado por el leader a partir del informe del implementer; los checks los volvió a correr el leader.

## Commits (cada uno compila con `tsc -p tsconfig.build.json` en worktree desechable con `prisma generate`; trailer Haiku 5.5)
- `9ac7506` corte A: columna `failure Json?` en `ExperimentRepetition`, migración aditiva `20261009180000_experiment_repetition_failure` (sin backfill, rollback manual documentado, la tabla ya tiene RLS), helper puro `sanitizeFailureMessage` (`app/src/common/sanitize-failure-message.util.ts`) con su spec.
- `9618e6b` corte B: `experiment-failure-fact.ts` (`toExperimentRepetitionFailure`), `ExperimentRepetitionInput.failure`, escritura en la misma `updateMany` con guarda `RUNNING` de `updateRepetitionById`, handler (`runAttempt`/`recordRepetition`) y pruebas, incluida la de que el DTO no contiene `failure`.

## Verificación (leader, 2026-10-09)
- lint 0; build 0; `tsc --noEmit` 43 con cliente regenerado (también en cada commit); `pnpm test` x3: 1728 pasan, 82 omitidos, 1810 total (antes 1689/82); e2e con URL inalcanzable 237 pasan (el implementer observó un `socket hang up` transitorio en repository-access: 237/237 en el reintento y 28/28 aislado; flake conocido).
- Specs pg del implementer (3 files, 82/82) en PostgreSQL desechable con las migraciones y shim de pgvector no commiteado; verificación manual 11/11 con rollback probado.
- Sin cambios en `ExperimentRepetitionResponse`, `TargetRunResult`, DTO, INTEROP ni contratos; `contractImpact=false`. Sin Contract Sync.

## Revisión del leader
- El hecho se escribe solo si el resultado del Sandbox no es `COMPLETED` y trae un hecho válido; `stage` y `category` fuera de su conjunto o `code` vacío dan `null` (clave omitida, nunca un `null` explícito); `code` se trunca a 64 y `message` se redacta y luego se trunca a 500 (puntos de código).
- La guarda `RUNNING` se hereda de la misma `updateMany` (H3 de WI-CORE-030); `closeInterruptedRepetition` no cambia y deja `failure` NULL.
- Patrones del helper: bloques PEM, pares `clave=valor` sensibles (password, secret, token, key, authorization), Bearer, JWT, `sk-`, tokens de GitHub, claves AWS, credenciales en URL y query/fragmento de URL. Razonable y cerrado; la revisión humana debe validar la lista.
- «Filas previas leen null»: cubierto en la prueba pg y por la naturaleza de la columna nullable; se acepta documentado (no se pide prueba unitaria adicional).

## Deudas
- Confirmación de alcance de una línea por parte del usuario PENDIENTE: `WI-CORE-007` no está listado literalmente en `smart-v3-scope-approval.md`; no se cierra `W-DONE` sin ella.
- `IDEA-015`: `map-sandbox-result.ts` toma `failure.category` sin validar contra `FailureType` y `errorSummary` copia `failure.message` crudo (sale en `ExperimentRepetitionResponse`); WI aparte.
- `code` del hecho se trunca pero no se redacta (se asume un identificador corto del Sandbox); un patrón de secreto no cubierto llegaría a la evidencia de `WI-CORE-027`.
- Migración `20261009180000` no aplicada a ninguna base real; verificación con Postgres real pendiente del agente principal.
- `WI-CORE-027` debe reutilizar `sanitizeFailureMessage` para el `failureMessage` de la evidencia de un `AnalysisRun`.
