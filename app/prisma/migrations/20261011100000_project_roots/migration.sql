ALTER TABLE "projects"
ADD COLUMN "projectRoot" TEXT;

UPDATE "projects"
SET "projectRoot" = '.'
WHERE "currentVersionId" IS NOT NULL;

ALTER TABLE "project_versions"
ADD COLUMN "effectiveProjectRoot" TEXT NOT NULL DEFAULT '.';
