-- WI-CORE-025 (HU17, OE5 pareado): marca interna de timeout del Sandbox por repetición.
-- Migración aditiva: columna nullable, sin backfill. Las filas previas quedan NULL (no TIMED_OUT conocido).


-- AlterTable
ALTER TABLE "experiment_repetitions" ADD COLUMN     "sandboxTimedOut" BOOLEAN;
