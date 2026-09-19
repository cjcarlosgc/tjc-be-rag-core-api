-- CreateEnum
CREATE TYPE "TestPublicationStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'STALE', 'FAILED', 'CLOSED');

-- CreateTable
CREATE TABLE "test_publications" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "proposalIds" TEXT[],
    "sourceHeadSha" TEXT NOT NULL,
    "status" "TestPublicationStatus" NOT NULL DEFAULT 'PENDING',
    "branchName" TEXT,
    "companionPullRequestNumber" INTEGER,
    "companionPullRequestUrl" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_publications_analysisRunId_idx" ON "test_publications"("analysisRunId");

-- AddForeignKey
ALTER TABLE "test_publications" ADD CONSTRAINT "test_publications_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
