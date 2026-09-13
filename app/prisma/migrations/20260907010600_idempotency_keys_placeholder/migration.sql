-- Reparación de historial: "idempotency_keys" nunca fue creada por una
-- migración (existía en la base de dev antes de que se trackeara con
-- Prisma Migrate); la migración siguiente (20260907010601_idempotency_records)
-- asume su existencia con `DROP TABLE "idempotency_keys"`. Esta migración
-- placeholder solo reconstruye lo mínimo necesario para que el DROP TABLE
-- posterior sea válido al reproducir el historial completo desde una base
-- vacía. En Supabase (donde la tabla real ya fue creada y luego dropeada
-- fuera del tracking de migraciones) esta migración se marca como aplicada
-- sin ejecutar su SQL, vía `prisma migrate resolve --applied`.
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL
);
