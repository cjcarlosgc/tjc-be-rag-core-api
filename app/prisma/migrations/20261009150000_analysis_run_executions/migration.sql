-- WI-CORE-026 (HU12, HU15; INTEROP-2.7 §6.16), corte B: ejecuciones del Sandbox por propuesta y intento.
-- Migración aditiva: una tabla nueva, una columna nullable en generated_test_proposals y dos índices únicos.
-- Sin backfill: las propuestas anteriores quedan con analysisSymbolId NULL y sin filas de ejecución.
--
-- Rollback manual (solo si no hay ejecuciones que conservar; ejecutar en este orden):
--   DROP TABLE "analysis_run_executions";
--   DROP INDEX "generated_test_proposals_analysisRunId_analysisSymbolId_key";
--   ALTER TABLE "generated_test_proposals" DROP CONSTRAINT "generated_test_proposals_analysisSymbolId_fkey";
--   ALTER TABLE "generated_test_proposals" DROP COLUMN "analysisSymbolId";

-- AlterTable
ALTER TABLE "generated_test_proposals" ADD COLUMN "analysisSymbolId" TEXT;

-- CreateTable
CREATE TABLE "analysis_run_executions" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "executionProfile" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_run_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analysis_run_executions_attempt_positive_check" CHECK ("attempt" > 0)
);

-- CreateIndex
CREATE INDEX "analysis_run_executions_analysisRunId_idx" ON "analysis_run_executions"("analysisRunId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_run_executions_proposalId_attempt_key" ON "analysis_run_executions"("proposalId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "generated_test_proposals_analysisRunId_analysisSymbolId_key" ON "generated_test_proposals"("analysisRunId", "analysisSymbolId");

-- AddForeignKey
ALTER TABLE "analysis_run_executions" ADD CONSTRAINT "analysis_run_executions_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_run_executions" ADD CONSTRAINT "analysis_run_executions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "generated_test_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_test_proposals" ADD CONSTRAINT "generated_test_proposals_analysisSymbolId_fkey" FOREIGN KEY ("analysisSymbolId") REFERENCES "analysis_symbols"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row level security: Core accede con el rol propietario (ignora RLS); anon y authenticated quedan sin acceso.
ALTER TABLE "analysis_run_executions" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  table_name text;
  tables text[] := ARRAY['analysis_run_executions'];
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
