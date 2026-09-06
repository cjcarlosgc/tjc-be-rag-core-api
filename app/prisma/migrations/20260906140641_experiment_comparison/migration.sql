-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExperimentStrategy" AS ENUM ('RAG', 'GENERALIST_AGENT');

-- CreateTable
CREATE TABLE "experiment_runs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectVersionId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'PENDING',
    "completedRepetitions" INTEGER NOT NULL DEFAULT 0,
    "totalRepetitions" INTEGER NOT NULL DEFAULT 6,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_repetitions" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "repetition" INTEGER NOT NULL,
    "strategy" "ExperimentStrategy" NOT NULL,
    "compiled" BOOLEAN,
    "executed" BOOLEAN,
    "passed" BOOLEAN,
    "valid" BOOLEAN,
    "failureType" "FailureType",
    "generationDurationMs" INTEGER,
    "executionDurationMs" INTEGER,
    "totalDurationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "retrievedChunks" INTEGER,
    "selectedChunks" INTEGER,
    "contextTokens" INTEGER,
    "toolCalls" INTEGER,
    "filesInspected" INTEGER,
    "trajectory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_repetitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "experiment_runs_projectId_idx" ON "experiment_runs"("projectId");

-- CreateIndex
CREATE INDEX "experiment_repetitions_experimentId_idx" ON "experiment_repetitions"("experimentId");

-- AddForeignKey
ALTER TABLE "experiment_runs" ADD CONSTRAINT "experiment_runs_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "test_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_repetitions" ADD CONSTRAINT "experiment_repetitions_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiment_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

