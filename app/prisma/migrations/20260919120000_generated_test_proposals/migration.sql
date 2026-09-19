-- CreateEnum
CREATE TYPE "GeneratedTestProposalStatus" AS ENUM ('AVAILABLE', 'HELD', 'STALE', 'PUBLISHED');

-- CreateTable
CREATE TABLE "generated_test_proposals" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "symbolLanguage" "AnalysisSymbolLanguage" NOT NULL,
    "symbolKind" "AnalysisSymbolKind" NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "status" "GeneratedTestProposalStatus" NOT NULL,
    "failureSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_test_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_test_proposals_analysisRunId_idx" ON "generated_test_proposals"("analysisRunId");

-- AddForeignKey
ALTER TABLE "generated_test_proposals" ADD CONSTRAINT "generated_test_proposals_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
