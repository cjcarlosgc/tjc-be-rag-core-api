-- 014 (HU59/HU60, corte 3): registro de acceso derivado de GitHub, solo para Projects de
-- organización. Sin backfill (la base no tiene datos que migrar). `verifiedAt` es la
-- última confirmación viva, no una caducidad.
-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('ADMIN', 'MAINTAINER', 'READER');

-- CreateTable
CREATE TABLE "project_access" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_access_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateIndex
CREATE INDEX "project_access_userId_idx" ON "project_access"("userId");

-- AddForeignKey
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cierre de la Data API de Supabase (regla de `20260921130000_enable_rls_all_tables`):
-- toda tabla nueva habilita RLS sin políticas y revoca los privilegios de `anon` y
-- `authenticated` (solo si esos roles existen, para no romper una base local). Esta
-- tabla define quién ve qué Project: no debe ser legible ni escribible por PostgREST.
ALTER TABLE "project_access" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "project_access" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "project_access" FROM authenticated;
  END IF;
END
$$;
