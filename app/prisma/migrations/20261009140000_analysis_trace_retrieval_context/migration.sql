-- WI-CORE-026 (HU12, HU15; INTEROP-2.7 §6.16), corte A: retrieval_id y context_id del trace operativo.
-- Migración aditiva: crea dos tablas, añade una columna nullable a generated_test_proposals y no hace backfill.
-- Los AnalysisRun anteriores quedan sin filas: el trace los expondrá como NOT_APPLICABLE solo si están terminados.
--
-- Rollback manual (solo si no hay contextos que conservar; ejecutar en este orden):
--   ALTER TABLE "generated_test_proposals" DROP CONSTRAINT "generated_test_proposals_contextId_fkey";
--   ALTER TABLE "generated_test_proposals" DROP COLUMN "contextId";
--   DROP TABLE "analysis_contexts";
--   DROP TABLE "analysis_retrievals";

-- AlterTable
ALTER TABLE "generated_test_proposals" ADD COLUMN "contextId" TEXT;

-- CreateTable
CREATE TABLE "analysis_retrievals" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "analysisSymbolId" TEXT NOT NULL,
    "mode" "RetrievalMode" NOT NULL,
    "config" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_retrievals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_contexts" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "analysisSymbolId" TEXT NOT NULL,
    "retrievalId" TEXT NOT NULL,
    "selectedChunkIds" TEXT[],
    "discardedChunkIds" TEXT[],
    "selectedTokens" INTEGER NOT NULL,
    "tokenBudget" INTEGER NOT NULL,
    "functionalRuleIds" TEXT[],
    "functionalRulesRetrieved" INTEGER NOT NULL,
    "functionalRulesSelected" INTEGER NOT NULL,
    "functionalRulesOmitted" INTEGER NOT NULL,
    "omittedFunctionalRules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_contexts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analysis_contexts_counts_nonnegative_check" CHECK (
      "selectedTokens" >= 0 AND "tokenBudget" >= 0 AND "functionalRulesRetrieved" >= 0
      AND "functionalRulesSelected" >= 0 AND "functionalRulesOmitted" >= 0
    )
);

-- CreateIndex
CREATE INDEX "analysis_retrievals_analysisRunId_idx" ON "analysis_retrievals"("analysisRunId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_retrievals_analysisRunId_analysisSymbolId_key" ON "analysis_retrievals"("analysisRunId", "analysisSymbolId");

-- CreateIndex
CREATE INDEX "analysis_contexts_analysisRunId_idx" ON "analysis_contexts"("analysisRunId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_contexts_analysisRunId_analysisSymbolId_key" ON "analysis_contexts"("analysisRunId", "analysisSymbolId");

-- AddForeignKey
ALTER TABLE "analysis_retrievals" ADD CONSTRAINT "analysis_retrievals_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_retrievals" ADD CONSTRAINT "analysis_retrievals_analysisSymbolId_fkey" FOREIGN KEY ("analysisSymbolId") REFERENCES "analysis_symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_contexts" ADD CONSTRAINT "analysis_contexts_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_contexts" ADD CONSTRAINT "analysis_contexts_analysisSymbolId_fkey" FOREIGN KEY ("analysisSymbolId") REFERENCES "analysis_symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_contexts" ADD CONSTRAINT "analysis_contexts_retrievalId_fkey" FOREIGN KEY ("retrievalId") REFERENCES "analysis_retrievals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_test_proposals" ADD CONSTRAINT "generated_test_proposals_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "analysis_contexts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row level security: Core accede con el rol propietario (ignora RLS); anon y authenticated quedan sin acceso.
ALTER TABLE "analysis_retrievals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analysis_contexts" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  table_name text;
  tables text[] := ARRAY['analysis_retrievals', 'analysis_contexts'];
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
