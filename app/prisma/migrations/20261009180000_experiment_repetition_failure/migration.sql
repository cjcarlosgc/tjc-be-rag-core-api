-- WI-CORE-007 (HU12, HU17; INTEROP-2.7 §6.16), hecho de fallo del Sandbox por repetición.
-- Persiste {stage, category, code, message} con `message` saneado solo cuando el Sandbox devuelve un hecho de
-- fallo; NULL en el resto. Columna interna: no se expone en DTO ni en INTEROP. La tabla ya tiene RLS
-- (20260921130000_enable_rls_all_tables), así que la columna no requiere política propia.
-- Migración aditiva: columna nullable, sin backfill (las filas previas quedan NULL).
--
-- Rollback manual (solo si no hay hechos de fallo que conservar):
--   ALTER TABLE "experiment_repetitions" DROP COLUMN "failure";

-- AlterTable
ALTER TABLE "experiment_repetitions" ADD COLUMN "failure" JSONB;
