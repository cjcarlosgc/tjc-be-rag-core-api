CREATE TYPE "ProjectLanguage" AS ENUM ('TYPESCRIPT', 'PHP');

ALTER TABLE "project_versions"
ADD COLUMN "language" "ProjectLanguage" NOT NULL DEFAULT 'TYPESCRIPT';

ALTER TYPE "TestFramework" ADD VALUE 'PHPUNIT';
