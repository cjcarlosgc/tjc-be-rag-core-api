-- CreateEnum
CREATE TYPE "FunctionalScope" AS ENUM ('PROJECT', 'MODULE', 'CLASS', 'METHOD', 'SYMBOL');

-- CreateEnum
CREATE TYPE "FunctionalQuestionStatus" AS ENUM ('PENDING', 'ANSWERED', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "FunctionalAnswerChoice" AS ENUM ('YES', 'NO', 'DEPENDS', 'UNKNOWN', 'FREE_TEXT');

-- CreateEnum
CREATE TYPE "FunctionalKnowledgeSource" AS ENUM ('HUMAN_ANSWER', 'APPROVED_IMPORT');

-- CreateEnum
CREATE TYPE "FunctionalKnowledgeStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "functional_questions" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "symbolLanguage" "AnalysisSymbolLanguage" NOT NULL,
    "symbolKind" "AnalysisSymbolKind" NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "FunctionalQuestionStatus" NOT NULL DEFAULT 'PENDING',
    "answerChoice" "FunctionalAnswerChoice",
    "answerText" TEXT,
    "knowledgeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "functional_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateIndex
CREATE INDEX "functional_questions_analysisRunId_idx" ON "functional_questions"("analysisRunId");

-- CreateIndex
CREATE INDEX "functional_questions_projectId_status_idx" ON "functional_questions"("projectId", "status");

-- CreateIndex
CREATE INDEX "functional_knowledge_projectId_scope_targetRef_status_idx" ON "functional_knowledge"("projectId", "scope", "targetRef", "status");

-- AddForeignKey
ALTER TABLE "functional_questions" ADD CONSTRAINT "functional_questions_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_questions" ADD CONSTRAINT "functional_questions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_knowledge" ADD CONSTRAINT "functional_knowledge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
