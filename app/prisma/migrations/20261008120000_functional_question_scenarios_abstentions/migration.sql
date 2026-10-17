-- WI-CORE-018 (DEC-FK-002, DEC-FK-004): escenarios de pregunta y abstenciones auditadas.
--
-- Migración aditiva: no reescribe filas, no hace backfill. Las preguntas y los símbolos
-- históricos quedan con columnas nulas; la API expone `scenarioKind=EXPECTED_RESULT` y
-- `scenarioKey=LEGACY` para las preguntas históricas.
--
-- Rollback manual (solo si no hay abstenciones que conservar; ejecutar en este orden):
--   DROP TABLE "functional_question_abstentions";
--   ALTER TABLE "analysis_symbols" DROP COLUMN "behaviorConstructs";
--   ALTER TABLE "functional_questions" DROP COLUMN "scenarioKey", DROP COLUMN "scenarioKind";
--   DROP TYPE "ScenarioKind";

-- CreateEnum
CREATE TYPE "ScenarioKind" AS ENUM ('EXPECTED_RESULT', 'BOUNDARY', 'EXCEPTION', 'STATE_TRANSITION', 'OBSERVABLE_SIDE_EFFECT', 'FUNCTIONAL_PRECONDITION');

-- AlterTable
ALTER TABLE "functional_questions"
  ADD COLUMN "scenarioKind" "ScenarioKind",
  ADD COLUMN "scenarioKey" TEXT;

-- AlterTable
ALTER TABLE "analysis_symbols"
  ADD COLUMN "behaviorConstructs" JSONB;

-- CreateTable
CREATE TABLE "functional_question_abstentions" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "functional_question_abstentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "functional_question_abstentions_questionId_idx" ON "functional_question_abstentions"("questionId");

-- AddForeignKey
ALTER TABLE "functional_question_abstentions" ADD CONSTRAINT "functional_question_abstentions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "functional_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security: Core accede con el rol propietario (ignora RLS); anon y authenticated quedan sin acceso.
ALTER TABLE "functional_question_abstentions" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  table_name text;
  tables text[] := ARRAY['functional_question_abstentions'];
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY tables LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
