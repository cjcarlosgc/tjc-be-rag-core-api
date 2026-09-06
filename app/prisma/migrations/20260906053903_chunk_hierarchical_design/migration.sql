-- AlterTable
ALTER TABLE "code_chunks" ADD COLUMN     "parentSymbolName" TEXT,
ADD COLUMN     "importsUsed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "partIndex" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "partsTotal" INTEGER NOT NULL DEFAULT 1;
