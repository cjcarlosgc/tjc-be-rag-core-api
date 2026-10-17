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


---

# Rediseño tras CHANGES_REQUESTED (DEC-FK-005, opción A)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium (reporte y verificación). Implementación: `implementer-high` · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high. Reemplaza la descripción de riesgo y del paso de dedupe de arriba: esa migración fue rechazada y ya no existe.

## Corte
| Commit | Refs | Contenido |
|---|---|---|
| `42e214a` | HU07, HU09 | Migración `20261008150000` reescrita: backfill `EXPECTED_RESULT`/`LEGACY` (solo NULL), detección de duplicados ACTIVE por (projectId, scope, COALESCE(targetRef,''), scenarioKey), `RAISE EXCEPTION` con listado ordenado y sin tocar `status` (la transacción revierte el esquema), NOT NULL e índice único parcial solo sin duplicados, `IF NOT EXISTS` para reejecutar. Consulta de solo lectura `app/prisma/preflight/20261008150000_functional_knowledge_active_duplicates.sql`, script `app/prisma/validation/validate-functional-knowledge-scenarios.sh` (+ fixture DDL previo) y prueba estática `app/src/prisma/functional-knowledge-scenarios-migration.spec.ts` |

El hash original del implementer (`8970a49`) se reescribió a `42e214a` solo para corregir el trailer a `Co-Authored-By: Claude Sonnet 5.5` (commit local, no publicado). Verificado por el leader: la migración no contiene `UPDATE` de `status` ni asigna `SUPERSEDED` (solo aparece en comentarios); diff de producto sin cambios en `app/src` salvo la prueba nueva.

## Validación de la migración (implementer-high)
30 comprobaciones PASS en 6 escenarios: sin datos, sin duplicados, mismo target con scenarioKey distintos, duplicados equivalentes (aborta), duplicados distintos (aborta, listado idéntico al preflight), reejecución tras resolver con SUPERSEDE/KEEP_EXISTING. Entorno: PostgreSQL 14 local desechable creado con initdb/pg_ctl y borrado al terminar (Docker no estaba disponible); no es pg16 ni tiene pgvector. No se usó `app/.env` ni Supabase.

## Verificación (leader, DATABASE_URL/DIRECT_URL = postgresql://nouser:nopass@127.0.0.1:1/none)
`validate-harness` pasa; `pnpm lint` exit 0; `pnpm test` 108 archivos pasan, 1 omitido, 1337 tests pasan, 36 omitidos; `pnpm build` exit 0; `pnpm test:e2e` 7 archivos, 222/222. Contract Sync `implementation-delivery` y `before-review`: sin pendientes relevantes; CS-005/006/007 son eventos propios (producidos, sin cambio funcional nuevo).

## Riesgos / decisiones abiertas para el usuario ANTES DE DESPLEGAR (no decididas)
- A) Un duplicado ACTIVE histórico sin pregunta PENDING puede no ser resoluble por la API: `resolveKnowledge` solo se alcanza al responder una pregunta con `conflictId = question.id`. ¿Se resuelve por pregunta, por un script de datos aprobado o con una ruta nueva?
- B) Transaccionalidad y `P3009` de `prisma migrate deploy` en Prisma 7.10.0 sin verificar (Context7 habló de Prisma 8): confirmar en un entorno de prueba que el abort revierte el esquema y qué estado deja en `_prisma_migrations`.
- C) La validación se hizo en PostgreSQL 14, no en pg16/pgvector.
