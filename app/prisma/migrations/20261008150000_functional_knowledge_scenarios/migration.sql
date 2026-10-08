-- WI-CORE-020 (INTEROP-2.7, DEC-FK-001, DEC-FK-004; HU07, HU09): varias reglas ACTIVE por target con scenarioKey.
--
-- Pasos (en orden, dentro de la transacción de `prisma migrate deploy`):
--   1. Añade `scenarioKind` y `scenarioKey` nullable.
--   2. Backfill de reglas históricas: `EXPECTED_RESULT` / `LEGACY` (DEC-FK-004). No borra ni reescribe contenido.
--   3. Paso idempotente previo al índice: deja una sola regla ACTIVE por (projectId, scope, COALESCE(targetRef, '')),
--      la más reciente (createdAt desc, id desc); las demás pasan a SUPERSEDED. Con datos que cumplan la
--      invariante anterior (una ACTIVE por target) no cambia ninguna fila. Es el único cambio de `status`.
--   4. Columnas NOT NULL.
--   5. Índice único parcial ACTIVE sobre (projectId, scope, COALESCE(targetRef, ''), scenarioKey).
--
-- Reversión manual (la transacción de migración no se revierte sola):
--   DROP INDEX "functional_knowledge_active_scenario_key";
--   ALTER TABLE "functional_knowledge" DROP COLUMN "scenarioKey", DROP COLUMN "scenarioKind";
-- El paso 3 no se revierte con DROP COLUMN: las filas que pasó a SUPERSEDED permanecen SUPERSEDED, y su
-- historia (createdAt, supersedesId, contenido) se conserva intacta.
-- No crea tablas, así que no requiere RLS adicional.

-- AlterTable
ALTER TABLE "functional_knowledge"
  ADD COLUMN "scenarioKind" "ScenarioKind",
  ADD COLUMN "scenarioKey" TEXT;

-- Backfill (reglas históricas)
UPDATE "functional_knowledge"
SET "scenarioKind" = 'EXPECTED_RESULT',
    "scenarioKey" = 'LEGACY'
WHERE "scenarioKind" IS NULL OR "scenarioKey" IS NULL;

-- Idempotente: una sola ACTIVE por target antes de crear el índice único.
WITH "ranked" AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "projectId", "scope", COALESCE("targetRef", '')
           ORDER BY "createdAt" DESC, "id" DESC
         ) AS "rn"
  FROM "functional_knowledge"
  WHERE "status" = 'ACTIVE'
)
UPDATE "functional_knowledge" AS "fk"
SET "status" = 'SUPERSEDED'
FROM "ranked"
WHERE "fk"."id" = "ranked"."id"
  AND "ranked"."rn" > 1;

-- AlterTable
ALTER TABLE "functional_knowledge"
  ALTER COLUMN "scenarioKind" SET NOT NULL,
  ALTER COLUMN "scenarioKey" SET NOT NULL;

-- CreateIndex (único parcial; Prisma no lo modela, ver schema.prisma)
CREATE UNIQUE INDEX "functional_knowledge_active_scenario_key"
  ON "functional_knowledge" ("projectId", "scope", (COALESCE("targetRef", '')), "scenarioKey")
  WHERE "status" = 'ACTIVE';
