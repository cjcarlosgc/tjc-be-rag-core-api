-- WI-CORE-020 (INTEROP-2.7, DEC-FK-001, DEC-FK-004, DEC-FK-005; HU07, HU09): varias reglas ACTIVE por target
-- con scenarioKey.
--
-- Pasos (en orden, dentro de la transacción de `prisma migrate deploy`):
--   1. Añade `scenarioKind` y `scenarioKey` nullable (IF NOT EXISTS: re-ejecutable).
--   2. Backfill de reglas históricas: `EXPECTED_RESULT` / `LEGACY` (DEC-FK-004). Solo rellena columnas NULL.
--      No modifica `status` ni el contenido de ninguna regla.
--   3. Detección de duplicados ACTIVE por identidad (projectId, scope, COALESCE(targetRef, ''), scenarioKey),
--      evaluada tras el backfill (DEC-FK-005). Si hay al menos una identidad con más de una regla ACTIVE:
--      RAISE EXCEPTION con un listado determinista de los casos. La migración aborta y la transacción revierte
--      todos los pasos anteriores: esquema y `status` quedan como antes de ejecutarla. Nunca se elige una regla
--      ganadora, nunca se marca SUPERSEDED automáticamente y no se considera equivalencia textual de
--      `normalizedRule`. Cada caso se resuelve de forma explícita con SUPERSEDE o KEEP_EXISTING (flujo vigente)
--      y después se reintenta la migración.
--      Consulta de solo lectura previa al despliegue, que reporta los mismos casos con el mismo orden y formato:
--      app/prisma/preflight/20261008150000_functional_knowledge_active_duplicates.sql
--   4. Solo si no hay duplicados: columnas NOT NULL.
--   5. Índice único parcial ACTIVE sobre (projectId, scope, COALESCE(targetRef, ''), scenarioKey).
--
-- Reversión manual (la transacción de migración no se revierte sola una vez confirmada):
--   DROP INDEX "functional_knowledge_active_scenario_key";
--   ALTER TABLE "functional_knowledge" DROP COLUMN "scenarioKey", DROP COLUMN "scenarioKind";
-- No hay efecto residual en datos: ningún paso de esta migración cambia `status`, así que el DROP COLUMN
-- no deja filas que haya que reconstruir. Las resoluciones SUPERSEDE/KEEP_EXISTING aplicadas antes de migrar
-- son decisiones de datos y permanecen.
-- No crea tablas, así que no requiere RLS adicional.

-- AlterTable
ALTER TABLE "functional_knowledge"
  ADD COLUMN IF NOT EXISTS "scenarioKind" "ScenarioKind",
  ADD COLUMN IF NOT EXISTS "scenarioKey" TEXT;

-- Backfill de reglas históricas (DEC-FK-004). Solo rellena lo que está NULL.
UPDATE "functional_knowledge"
SET "scenarioKind" = COALESCE("scenarioKind", 'EXPECTED_RESULT'),
    "scenarioKey" = COALESCE("scenarioKey", 'LEGACY')
WHERE "scenarioKind" IS NULL OR "scenarioKey" IS NULL;

-- Detección de duplicados ACTIVE por identidad de escenario tras el backfill (DEC-FK-005).
-- Solo lectura sobre `status`: si hay casos, aborta; si no, no hace nada.
DO $$
DECLARE
  v_casos integer;
  v_listado text;
BEGIN
  SELECT count(*),
         string_agg(
           format(
             'projectId=%s scope=%s targetRef=%L scenarioKey=%s activeCount=%s activeIds=%s',
             "projectId", "scope", "targetKey", "scenarioKey", "activeCount", "activeIds"
           ),
           E'\n' ORDER BY "projectId", "scope", "targetKey", "scenarioKey"
         )
  INTO v_casos, v_listado
  FROM (
    SELECT "projectId",
           "scope",
           COALESCE("targetRef", '') AS "targetKey",
           "scenarioKey",
           count(*) AS "activeCount",
           string_agg("id", ',' ORDER BY "createdAt", "id") AS "activeIds"
    FROM "functional_knowledge"
    WHERE "status" = 'ACTIVE'
    GROUP BY "projectId", "scope", COALESCE("targetRef", ''), "scenarioKey"
    HAVING count(*) > 1
  ) AS "duplicados";

  IF v_casos > 0 THEN
    RAISE EXCEPTION '%', format(
      E'WI-CORE-020 (DEC-FK-005): %s identidad(es) con más de una regla ACTIVE (projectId, scope, targetRef, scenarioKey). '
      'La migración aborta; ninguna regla fue modificada ni se eligió ganadora.\n%s',
      v_casos, v_listado
    )
    USING HINT = 'Resuelva cada caso con SUPERSEDE o KEEP_EXISTING (flujo vigente, DEC-FK-005) y reintente la migración.';
  END IF;
END
$$;

-- AlterTable (solo si no hay duplicados)
ALTER TABLE "functional_knowledge"
  ALTER COLUMN "scenarioKind" SET NOT NULL,
  ALTER COLUMN "scenarioKey" SET NOT NULL;

-- CreateIndex (único parcial; Prisma no lo modela, ver schema.prisma)
CREATE UNIQUE INDEX IF NOT EXISTS "functional_knowledge_active_scenario_key"
  ON "functional_knowledge" ("projectId", "scope", (COALESCE("targetRef", '')), "scenarioKey")
  WHERE "status" = 'ACTIVE';
