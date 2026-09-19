-- CreateEnum
CREATE TYPE "RepositoryBindingStatus" AS ENUM ('ENABLED', 'DISABLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('QUEUED', 'PROCESSING', 'ACTION_REQUIRED', 'SUCCESS', 'BEHAVIORAL_MISMATCH', 'TECHNICAL_GENERATION_FAILURE', 'INFRASTRUCTURE_FAILURE', 'BASELINE_FAILED', 'NO_ADDITIONAL_TESTS_REQUIRED', 'NO_TEST_RELEVANT_CHANGES', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "AnalysisIndexMode" AS ENUM ('BOOTSTRAP', 'INCREMENTAL');

-- CreateTable
CREATE TABLE "repository_bindings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "integrationBranch" TEXT NOT NULL DEFAULT 'develop',
    "status" "RepositoryBindingStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "prTitle" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "headRef" TEXT NOT NULL,
    "baseSha" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "prState" "PullRequestState" NOT NULL DEFAULT 'OPEN',
    "actorLogin" TEXT,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'QUEUED',
    "current" BOOLEAN NOT NULL DEFAULT true,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "indexMode" "AnalysisIndexMode" NOT NULL DEFAULT 'BOOTSTRAP',
    "changesetBaseSha" TEXT NOT NULL,
    "changesetHeadSha" TEXT NOT NULL,
    "indexDeltaBaseSha" TEXT,
    "functionalBehaviorValidated" BOOLEAN NOT NULL DEFAULT false,
    "actionRequiredCount" INTEGER NOT NULL DEFAULT 0,
    "generatedTestsCount" INTEGER NOT NULL DEFAULT 0,
    "resultSummary" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repository_bindings_projectId_key" ON "repository_bindings"("projectId");

-- CreateIndex
CREATE INDEX "analysis_runs_projectId_idx" ON "analysis_runs"("projectId");

-- CreateIndex
CREATE INDEX "analysis_runs_repositoryId_prNumber_current_idx" ON "analysis_runs"("repositoryId", "prNumber", "current");

-- AddForeignKey
ALTER TABLE "repository_bindings" ADD CONSTRAINT "repository_bindings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

