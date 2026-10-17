-- WI-CORE-023 (HU17, DEC-EXP-004): configuración efectiva del experimento persistida por corrida.
-- Migración aditiva: columna nullable, sin backfill. Las corridas previas quedan con NULL.

-- AlterTable
ALTER TABLE "experiment_runs" ADD COLUMN "modelConfig" JSONB;
