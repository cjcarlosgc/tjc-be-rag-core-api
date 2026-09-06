-- CreateEnum
CREATE TYPE "GenerationMode" AS ENUM ('TARGET', 'CLASS_ALL', 'CLASS_MISSING', 'PROJECT_MISSING', 'PROJECT_ALL');

-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('PENDING', 'RESOLVING_TARGETS', 'PROCESSING_TARGETS', 'BATCH_VALIDATING', 'FINALIZING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "TargetRunStatus" AS ENUM ('VALID', 'INVALID', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FailureType" AS ENUM ('NONE', 'COMPILATION', 'TEST_ASSERTION', 'TEST_RUNTIME', 'DEPENDENCY', 'CONFIGURATION', 'INFRASTRUCTURE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('CREATED', 'MODIFIED');

-- CreateTable
CREATE TABLE "test_generation_runs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectVersionId" TEXT NOT NULL,
    "mode" "GenerationMode" NOT NULL,
    "targetId" TEXT,
    "status" "TestRunStatus" NOT NULL DEFAULT 'PENDING',
    "totalTargets" INTEGER,
    "processedTargets" INTEGER NOT NULL DEFAULT 0,
    "validTargets" INTEGER NOT NULL DEFAULT 0,
    "invalidTargets" INTEGER NOT NULL DEFAULT 0,
    "failedTargets" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_run_results" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "symbolName" TEXT NOT NULL,
    "methodName" TEXT,
    "targetType" "TestTargetType" NOT NULL,
    "status" "TargetRunStatus" NOT NULL,
    "compiled" BOOLEAN,
    "executed" BOOLEAN,
    "passed" BOOLEAN,
    "valid" BOOLEAN,
    "failureType" "FailureType",
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_run_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "artifactType" "ArtifactType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_generation_runs_projectId_idx" ON "test_generation_runs"("projectId");

-- CreateIndex
CREATE INDEX "target_run_results_testRunId_idx" ON "target_run_results"("testRunId");

-- CreateIndex
CREATE INDEX "artifacts_testRunId_idx" ON "artifacts"("testRunId");

-- AddForeignKey
ALTER TABLE "target_run_results" ADD CONSTRAINT "target_run_results_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "test_generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_run_results" ADD CONSTRAINT "target_run_results_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "test_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "test_generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

