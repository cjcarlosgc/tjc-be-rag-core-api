-- CreateEnum
CREATE TYPE "TestTargetType" AS ENUM ('CLASS', 'METHOD', 'FUNCTION');

-- CreateEnum
CREATE TYPE "TestFramework" AS ENUM ('JEST', 'VITEST');

-- DropIndex
DROP INDEX "code_chunks_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "project_versions" ADD COLUMN     "detectedFramework" "TestFramework",
ADD COLUMN     "targetsTotal" INTEGER,
ADD COLUMN     "targetsWithTest" INTEGER;

-- CreateTable
CREATE TABLE "test_targets" (
    "id" TEXT NOT NULL,
    "projectVersionId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "symbolName" TEXT NOT NULL,
    "methodName" TEXT,
    "targetType" "TestTargetType" NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "hasTest" BOOLEAN NOT NULL DEFAULT false,
    "testFilePaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_targets_projectVersionId_idx" ON "test_targets"("projectVersionId");

-- AddForeignKey
ALTER TABLE "test_targets" ADD CONSTRAINT "test_targets_projectVersionId_fkey" FOREIGN KEY ("projectVersionId") REFERENCES "project_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
