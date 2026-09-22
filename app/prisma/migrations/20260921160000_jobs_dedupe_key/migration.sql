-- 014 (HU61, corte 5a): deduplicación de los jobs de acceso (`ACCESS_RECONCILIATION`,
-- `ACCESS_REVERIFY`). `jobs` no tiene columna de alcance, así que se añade una clave de
-- deduplicación opcional (nula en los demás tipos de job) y un índice único PARCIAL que
-- cubre SOLO las filas `PENDING` con `dedupeKey` no nula (no `RUNNING`):
--   * la siguiente ocurrencia de la reconciliación se encola al INICIO de su ejecución sin
--     chocar con su propia fila `RUNNING`;
--   * un evento que llega durante un `ACCESS_REVERIFY` en ejecución encola uno nuevo que
--     corre después (el reclamo no toma un `PENDING` cuya clave coincide con un `RUNNING`
--     no obsoleto: ver `JobsRepository.claimNext`).
-- Sin backfill (la base no tiene jobs de acceso). Prisma no puede declarar un índice único
-- parcial en `schema.prisma`; esta migración SQL es la única fuente.
-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex (único parcial: solo PENDING)
CREATE UNIQUE INDEX "jobs_dedupeKey_pending_key" ON "jobs"("dedupeKey")
  WHERE "status" = 'PENDING' AND "dedupeKey" IS NOT NULL;

-- CreateIndex (consulta de un RUNNING con la misma clave en el reclamo y en la siembra)
CREATE INDEX "jobs_dedupeKey_running_idx" ON "jobs"("dedupeKey")
  WHERE "status" = 'RUNNING' AND "dedupeKey" IS NOT NULL;
