-- WI-CORE-022 (HU05, HU17; INTEROP-2.7 §6.15): comparación de retrieval SE vs SEM.
-- Migración aditiva: crea enums y dos tablas nuevas; no altera tablas existentes ni hace backfill.
--
-- Rollback manual (solo si no hay comparaciones que conservar; ejecutar en este orden):
--   DROP TABLE "retrieval_comparison_results";
--   DROP TABLE "retrieval_comparisons";
--   DROP TYPE "RetrievalMode";
--   DROP TYPE "RetrievalComparisonStatus";

-- CreateEnum
CREATE TYPE "RetrievalComparisonStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RetrievalMode" AS ENUM ('SE', 'SEM');

-- CreateTable
CREATE TABLE "retrieval_comparisons" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectVersionId" TEXT NOT NULL,
    "symbol" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "status" "RetrievalComparisonStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "groundTruth" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retrieval_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieval_comparison_results" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "mode" "RetrievalMode" NOT NULL,
    "config" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_comparison_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retrieval_comparisons_analysisRunId_createdAt_idx" ON "retrieval_comparisons"("analysisRunId", "createdAt");

-- CreateIndex
CREATE INDEX "retrieval_comparisons_projectId_idx" ON "retrieval_comparisons"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "retrieval_comparison_results_comparisonId_mode_key" ON "retrieval_comparison_results"("comparisonId", "mode");

-- AddForeignKey
ALTER TABLE "retrieval_comparisons" ADD CONSTRAINT "retrieval_comparisons_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_comparisons" ADD CONSTRAINT "retrieval_comparisons_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_comparisons" ADD CONSTRAINT "retrieval_comparisons_projectVersionId_fkey" FOREIGN KEY ("projectVersionId") REFERENCES "project_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_comparison_results" ADD CONSTRAINT "retrieval_comparison_results_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "retrieval_comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row level security: Core accede con el rol propietario (ignora RLS); anon y authenticated quedan sin acceso.
ALTER TABLE "retrieval_comparisons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retrieval_comparison_results" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  table_name text;
  tables text[] := ARRAY['retrieval_comparisons', 'retrieval_comparison_results'];
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
