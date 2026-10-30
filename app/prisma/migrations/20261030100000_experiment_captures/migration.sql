-- WI-CORE-109 (HU18, INTEROP-2.25 §6.17): captura armada del próximo AnalysisRun elegible para experimentación.
-- Migración estrictamente aditiva: un enum y una tabla nuevos, una columna nullable en analysis_runs con su FK
-- y su índice único, un índice único parcial (como máximo una captura ARMED por Project) y RLS.
-- Sin backfill: los Runs anteriores quedan con experimentCaptureId NULL y no hay capturas que migrar.
--
-- Rollback manual (solo si no hay capturas ni reservas que conservar; ejecutar en este orden):
--   ALTER TABLE "analysis_runs" DROP CONSTRAINT "analysis_runs_experimentCaptureId_fkey";
--   DROP INDEX "analysis_runs_experimentCaptureId_key";
--   ALTER TABLE "analysis_runs" DROP COLUMN "experimentCaptureId";
--   DROP TABLE "experiment_captures";
--   DROP TYPE "ExperimentCaptureStatus";

-- CreateEnum
CREATE TYPE "ExperimentCaptureStatus" AS ENUM ('ARMED', 'RESERVED', 'DISARMED');

-- CreateTable
CREATE TABLE "experiment_captures" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ExperimentCaptureStatus" NOT NULL DEFAULT 'ARMED',
    "armedByUserId" TEXT NOT NULL,
    "armedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedAnalysisRunId" TEXT,
    "reservedAt" TIMESTAMP(3),
    "disarmedByUserId" TEXT,
    "disarmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_captures_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "analysis_runs" ADD COLUMN "experimentCaptureId" TEXT;

-- CreateIndex
CREATE INDEX "experiment_captures_projectId_createdAt_idx" ON "experiment_captures"("projectId", "createdAt");

-- CreateIndex (único parcial; Prisma no lo modela, ver schema.prisma: como máximo una captura ARMED por Project)
CREATE UNIQUE INDEX "experiment_captures_one_armed_per_project_key"
  ON "experiment_captures" ("projectId")
  WHERE "status" = 'ARMED';

-- CreateIndex
CREATE UNIQUE INDEX "analysis_runs_experimentCaptureId_key" ON "analysis_runs"("experimentCaptureId");

-- AddForeignKey
ALTER TABLE "experiment_captures" ADD CONSTRAINT "experiment_captures_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_experimentCaptureId_fkey" FOREIGN KEY ("experimentCaptureId") REFERENCES "experiment_captures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security: Core accede con el rol propietario (ignora RLS); anon y authenticated quedan sin acceso.
ALTER TABLE "experiment_captures" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  table_name text;
  tables text[] := ARRAY['experiment_captures'];
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY tables LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
