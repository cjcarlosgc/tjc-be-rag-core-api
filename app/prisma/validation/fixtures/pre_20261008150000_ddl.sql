-- WI-CORE-020 (DEC-FK-005): DDL previo fiel al estado tras 20261008140000 (solo para validacion local).
-- projects se reduce a id; el resto se extrajo de las migraciones reales (ver validate-functional-knowledge-scenarios.sh).
CREATE TABLE "projects" ("id" TEXT NOT NULL, CONSTRAINT "projects_pkey" PRIMARY KEY ("id"));
CREATE TYPE "ScenarioKind" AS ENUM ('EXPECTED_RESULT', 'BOUNDARY', 'EXCEPTION', 'STATE_TRANSITION', 'OBSERVABLE_SIDE_EFFECT', 'FUNCTIONAL_PRECONDITION');
CREATE TYPE "FunctionalScope" AS ENUM ('PROJECT', 'MODULE', 'CLASS', 'METHOD', 'SYMBOL');
CREATE TYPE "FunctionalKnowledgeSource" AS ENUM ('HUMAN_ANSWER', 'APPROVED_IMPORT');
CREATE TYPE "FunctionalKnowledgeStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
CREATE TABLE "functional_knowledge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" "FunctionalScope" NOT NULL,
    "targetRef" TEXT,
    "originalQuestion" TEXT NOT NULL,
    "originalAnswer" TEXT NOT NULL,
    "normalizedRule" TEXT NOT NULL,
    "source" "FunctionalKnowledgeSource" NOT NULL DEFAULT 'HUMAN_ANSWER',
    "status" "FunctionalKnowledgeStatus" NOT NULL DEFAULT 'ACTIVE',
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "functional_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "functional_knowledge_projectId_scope_targetRef_status_idx" ON "functional_knowledge"("projectId", "scope", "targetRef", "status");
ALTER TABLE "functional_knowledge" ADD CONSTRAINT "functional_knowledge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "ConfirmingRole" AS ENUM ('ADMIN', 'MAINTAINER');

ALTER TABLE "functional_knowledge" ADD COLUMN     "confirmedByUserId" TEXT,
ADD COLUMN     "confirmedRole" "ConfirmingRole",
ADD COLUMN     "originHeadSha" TEXT,
ADD COLUMN     "sourceRef" TEXT;
