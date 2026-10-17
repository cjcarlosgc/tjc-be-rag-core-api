-- WI-CORE-026 (HU15; INTEROP-2.7 §6.16; DEC-TRACE-002), corte D': instante de publicación del Check en GitHub.
-- Indicador independiente de checkId: GitHub Integration puede responder 204 (sin id) durante la transición,
-- y el trace debe seguir reportando publication.status PRESENT para ese Check.
-- Migración aditiva: columna nullable, sin backfill (los Runs anteriores quedan con checkPublishedAt NULL).
--
-- Rollback manual (solo si no hay marcas de publicación que conservar):
--   ALTER TABLE "analysis_runs" DROP COLUMN "checkPublishedAt";

-- AlterTable
ALTER TABLE "analysis_runs" ADD COLUMN "checkPublishedAt" TIMESTAMP(3);
