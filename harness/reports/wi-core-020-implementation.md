# WI-CORE-020 — Implementación y evidencia técnica
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer-high` (configurado claude-haiku-5-5, esfuerzo high; escalado desde el inicio por migración con índice parcial y carrera). Verificación SDD por `sdd-analyst` (`wi-core-020-sdd-verification.md`).

## Corte (commit local, sin push)
| Commit | Refs | Contenido |
|---|---|---|
| `5ffcdee` | HU07, HU09 | Migración `20261008150000_functional_knowledge_scenarios` (columnas, backfill `EXPECTED_RESULT`/`LEGACY`, dedupe idempotente de ACTIVE duplicadas, NOT NULL, índice único parcial `ACTIVE` sobre project+scope+COALESCE(targetRef)+scenarioKey, reversión documentada); `findActive` con clave; P2002 a 409 con la regla ganadora; herencia de la pregunta; evaluador por clave; DTO con los dos campos; pruebas |
| `2f4ef6a` | HU07, HU09 | INTEROP-2.7 §6.11 y CHANGELOG: implementado |

Desviación declarada: el evaluador pasó de saltar el target entero cuando hay regla a evaluar cada construcción por su clave (consecuencia de DEC-FK-003). El trailer del commit se corrigió a Sonnet 5.5 (amend local, sin push). El informe de implementación lo escribió el leader a partir del handoff del implementer.

## Validación de la migración (por el implementer, Postgres 14 local desechable, sin pgvector)
Se aplicó el SQL real sobre el DDL previo: dedupe conserva la más reciente por target; backfill y NOT NULL; el índice rechaza duplicados ACTIVE (también con targetRef NULL) y acepta claves distintas; dedupe idempotente; reversión probada. Carrera contra Postgres real: uno gana, el otro recibe el conflicto; con otra clave coexisten. No se usó app/.env ni Supabase.

## Verificación (desde `app/`, ejecutada por el Leader, DATABASE_URL/DIRECT_URL en 127.0.0.1:1)
- `pnpm lint`: exit 0. `pnpm test`: 107 archivos pasan, 1 omitido; 1329 tests pasan, 36 omitidos. `pnpm build`: exit 0. `pnpm test:e2e`: 7 archivos, 222/222.
- `node harness/validate-harness.mjs`: pasa.

## Riesgo para el Human Reviewer
La migración pasa a `SUPERSEDED` reglas ACTIVE duplicadas por target donde existan (no se revierte con DROP COLUMN); con datos sanos no cambia nada. Antes de aplicarla fuera de local conviene consultar duplicados. `prisma migrate diff` mostrará deriva por el índice parcial con expresión (documentado en schema).
