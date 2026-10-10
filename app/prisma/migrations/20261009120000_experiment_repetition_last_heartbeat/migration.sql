-- WI-CORE-025 (HU17, OE5 pareado): latido por repetición para detectar intentos interrumpidos.
-- Migración aditiva: columna nullable, sin backfill. Las filas previas quedan NULL y se evalúan por createdAt.


-- AlterTable
ALTER TABLE "experiment_repetitions" ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3);
