-- CreateEnum
CREATE TYPE "AnalysisSymbolLanguage" AS ENUM ('TYPESCRIPT', 'PHP');

-- CreateEnum
CREATE TYPE "AnalysisSymbolKind" AS ENUM ('CLASS', 'METHOD', 'FUNCTION', 'INTERFACE', 'TYPE', 'TRAIT', 'ENUM');

-- CreateEnum
CREATE TYPE "SymbolChangeKind" AS ENUM ('DIRECTLY_CHANGED', 'POTENTIALLY_IMPACTED');

-- AlterTable
ALTER TABLE "analysis_runs" ADD COLUMN     "projectVersionId" TEXT;

-- AlterTable
ALTER TABLE "project_versions" ADD COLUMN     "commitSha" TEXT;

-- CreateTable
CREATE TABLE "analysis_symbols" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "language" "AnalysisSymbolLanguage" NOT NULL,
    "kind" "AnalysisSymbolKind" NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "changeKind" "SymbolChangeKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_symbols_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_symbols_analysisRunId_idx" ON "analysis_symbols"("analysisRunId");

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_projectVersionId_fkey" FOREIGN KEY ("projectVersionId") REFERENCES "project_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_symbols" ADD CONSTRAINT "analysis_symbols_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

