-- WI-CORE-025 (HU17, OE5 pareado): campos aditivos de corrida y de repetición.
-- Migración aditiva: columnas nullable (technicallyEvaluable con default true), sin backfill.
-- Las corridas previas quedan con NULL / true. modelConfig no se toca (WI-CORE-023).


-- AlterTable
ALTER TABLE "experiment_runs" ADD COLUMN     "budget" JSONB,
ADD COLUMN     "executionProfile" TEXT,
ADD COLUMN     "randomizationSeed" TEXT,
ADD COLUMN     "runnerHint" TEXT;

-- AlterTable
ALTER TABLE "experiment_repetitions" ADD COLUMN     "pairId" TEXT,
ADD COLUMN     "pairPosition" INTEGER,
ADD COLUMN     "technicallyEvaluable" BOOLEAN NOT NULL DEFAULT true;

