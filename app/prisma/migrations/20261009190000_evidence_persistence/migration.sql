-- WI-CORE-027 (HU12, HU15, HU17; INTEROP-2.7 §6.16), corte B: persistencia de la evidencia de ejecución y de generación
-- (DEC-EVID-003). Migración aditiva: solo columnas nuevas y nullables, sin backfill (las filas previas quedan NULL y
-- la evidencia las expone como null, nunca como 0). No crea tablas nuevas, así que no requiere RLS nuevo: las tablas
-- afectadas ya tienen su política (analysis_run_executions desde 20261009150000; generated_test_proposals y
-- experiment_repetitions por sus migraciones previas).
-- Las columnas son internas: no se exponen en DTO ni en INTEROP hasta el corte C de WI-CORE-027.
--
-- Rollback manual (solo si no hay evidencia que conservar; ejecutar en este orden):
--   ALTER TABLE "experiment_repetitions" DROP COLUMN "artifactHash";
--   ALTER TABLE "experiment_repetitions" DROP COLUMN "sandboxFacts";
--   ALTER TABLE "experiment_repetitions" DROP COLUMN "sandboxCorrelationId";
--   ALTER TABLE "experiment_repetitions" DROP COLUMN "sandboxRequestId";
--   ALTER TABLE "experiment_repetitions" DROP COLUMN "sandboxExecutionId";
--   ALTER TABLE "generated_test_proposals" DROP COLUMN "generation";
--   ALTER TABLE "analysis_run_executions" DROP CONSTRAINT "analysis_run_executions_durationMs_nonnegative_check";
--   ALTER TABLE "analysis_run_executions" DROP COLUMN "failure";
--   ALTER TABLE "analysis_run_executions" DROP COLUMN "facts";
--   ALTER TABLE "analysis_run_executions" DROP COLUMN "durationMs";
--   ALTER TABLE "analysis_run_executions" DROP COLUMN "correlationId";
--   ALTER TABLE "analysis_run_executions" DROP COLUMN "requestId";

-- AlterTable
ALTER TABLE "analysis_run_executions" ADD COLUMN "requestId" TEXT,
ADD COLUMN "correlationId" TEXT,
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "facts" JSONB,
ADD COLUMN "failure" JSONB;

-- AlterTable
ALTER TABLE "generated_test_proposals" ADD COLUMN "generation" JSONB;

-- AlterTable
ALTER TABLE "experiment_repetitions" ADD COLUMN "sandboxExecutionId" TEXT,
ADD COLUMN "sandboxRequestId" TEXT,
ADD COLUMN "sandboxCorrelationId" TEXT,
ADD COLUMN "sandboxFacts" JSONB,
ADD COLUMN "artifactHash" TEXT;

-- Check: una duración observada nunca es negativa; NULL (no observada) queda permitido.
ALTER TABLE "analysis_run_executions" ADD CONSTRAINT "analysis_run_executions_durationMs_nonnegative_check" CHECK ("durationMs" >= 0);

-- Check: un hash de artefacto, si existe, es un SHA-256 en hexadecimal minúsculo.
ALTER TABLE "experiment_repetitions" ADD CONSTRAINT "experiment_repetitions_artifactHash_sha256_check" CHECK ("artifactHash" IS NULL OR "artifactHash" ~ '^[0-9a-f]{64}$');
