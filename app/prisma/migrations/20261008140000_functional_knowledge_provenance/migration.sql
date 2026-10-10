-- WI-CORE-019 (INTEROP-2.7, HU07/HU08): procedencia de las reglas funcionales.
--
-- Migración aditiva: crea el enum `ConfirmingRole` y añade columnas nullable a
-- `functional_knowledge`. Sin backfill: las reglas históricas quedan con NULL, y
-- `originHeadSha` no vence ninguna regla. No crea tablas nuevas, así que no requiere RLS adicional.

-- CreateEnum
CREATE TYPE "ConfirmingRole" AS ENUM ('ADMIN', 'MAINTAINER');

-- AlterTable
ALTER TABLE "functional_knowledge" ADD COLUMN     "confirmedByUserId" TEXT,
ADD COLUMN     "confirmedRole" "ConfirmingRole",
ADD COLUMN     "originHeadSha" TEXT,
ADD COLUMN     "sourceRef" TEXT;
