-- WI-CORE-060 (corte A): columnas internas para reconstruir un trial experimental. Migración estrictamente aditiva:
-- solo ALTER TABLE ... ADD COLUMN de columnas nullables en experiment_runs, experiment_repetitions y
-- experiment_repetition_artifacts. Sin DEFAULT (no reescribe filas), sin backfill: las filas previas quedan NULL.
-- Ninguna columna se expone en DTO público ni en INTEROP (§6.16 sin cambios).
--
-- Rollback manual (solo si no hay datos que conservar; ejecutar en este orden):
--   ALTER TABLE "experiment_repetition_artifacts" DROP COLUMN "sandboxCompletedAt", DROP COLUMN "sandboxStartedAt", DROP COLUMN "sandboxEvidenceTruncated", DROP COLUMN "sandboxEvidenceSha256", DROP COLUMN "sandboxEvidence";
--   ALTER TABLE "experiment_repetitions" DROP COLUMN "promptSha256", DROP COLUMN "finishedAt", DROP COLUMN "startedAt";
--   ALTER TABLE "experiment_runs" DROP COLUMN "commitSha", DROP COLUMN "analysisRunId";

-- AlterTable
ALTER TABLE "experiment_runs" ADD COLUMN     "analysisRunId" TEXT,
ADD COLUMN     "commitSha" TEXT;

-- AlterTable
ALTER TABLE "experiment_repetitions" ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "promptSha256" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "experiment_repetition_artifacts" ADD COLUMN     "sandboxCompletedAt" TIMESTAMP(3),
ADD COLUMN     "sandboxEvidence" JSONB,
ADD COLUMN     "sandboxEvidenceSha256" TEXT,
ADD COLUMN     "sandboxEvidenceTruncated" BOOLEAN,
ADD COLUMN     "sandboxStartedAt" TIMESTAMP(3);
