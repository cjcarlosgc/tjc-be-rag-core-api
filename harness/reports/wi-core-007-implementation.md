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

## Corte C — corrección del saneado (respuesta al ciclo 1 de la revisión independiente)
Reporte del reviewer: `harness/reports/wi-core-007-independent-review.md` (CHANGES_REQUESTED, 2 importantes y 2 menores). Corte C por `implementer-high` (Haiku 5.5 / high). `reviewCycles` sigue en 1 de 2.
- `aa141ce` (3 archivos: `sanitize-failure-message.util.ts`, su spec y `experiment-job.handler.spec.ts`; +284/-18):
  - Rendimiento: se quitó el prefijo `[\w-]*` de `SENSITIVE_PAIR` y se acota la entrada a 16 384 puntos de código antes de las expresiones (el último token se descarta entero si el tope corta).
  - Fugas cerradas: listas `[...]`, userinfo de URL hasta el último `@` (también con `/` en la clave), comillas escapadas y sin cierre; PEM insensible a mayúsculas y bloque PGP.
  - Prueba del camino de fallo LLM con `failure` ausente.
- Decisiones del implementer: sobre-redacción aceptada (`https://host/@scope/pkg` queda `https://[REDACTED]@scope/pkg`; una comilla sin cierre consume hasta el final); la clave no exige límite de palabra antes (`monkey=` también se redacta).
- Medición del leader (`node --experimental-strip-types`, solo la llamada): `'a-'.repeat(50000)` 3,7 ms; `'a-'.repeat(100000)` 2,2 ms; base64url de 200k 1,8 ms; `password=[` x20000 1,4 ms; `password="` x20000 1,8 ms; `u:p@` x30000 1,5 ms. Antes (reviewer): 53 s con 100k.
- Verificación del leader en HEAD: lint 0; build 0; `tsc --noEmit` 43 con cliente regenerado (también en `aa141ce` por worktree desechable); `pnpm test` x3: 1770 pasan, 82 omitidos, 1852 total; e2e 237. El implementer enmendó dos veces su commit local antes de cerrar (sin publicar).
- `IDEA-016` ampliada con `credential|auth|signature=` y `password hunter2` sin separador; conviene ampliar el helper antes de que `WI-CORE-027` lo reutilice.
