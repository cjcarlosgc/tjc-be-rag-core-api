-- 014 (HU63, corte 2): workspace del Project. Sin backfill (la base no tiene datos
-- que migrar): un Project existente queda en el workspace personal (ambas nulas).
-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "githubOrgId" TEXT,
ADD COLUMN     "githubOrgLogin" TEXT;

-- CreateIndex
CREATE INDEX "projects_githubOrgId_idx" ON "projects"("githubOrgId");

-- Check de coherencia (Prisma no declara check constraints): el workspace es o bien
-- personal (ambas nulas) o bien una organización (ambas presentes); una sola es inválida.
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_org_coherence_check"
  CHECK (("githubOrgId" IS NULL) = ("githubOrgLogin" IS NULL));
