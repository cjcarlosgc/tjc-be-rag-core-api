-- WI-CORE-026 (HU15; INTEROP-2.7 §6.16; GH-INTEROP 1.3), corte D: id del Check de GitHub publicado para el AnalysisRun.
-- Core no tiene una tabla Check: el Check es uno por Run, así que la columna vive en analysis_runs.
-- Migración aditiva: columna nullable, sin backfill (los Runs anteriores quedan con checkId NULL).
--
-- Rollback manual (solo si no hay ids de Check que conservar):
--   ALTER TABLE "analysis_runs" DROP COLUMN "checkId";

-- AlterTable
ALTER TABLE "analysis_runs" ADD COLUMN "checkId" TEXT;
