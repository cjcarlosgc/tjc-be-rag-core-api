-- AlterTable
ALTER TABLE "projects" ADD COLUMN "ownerUserId" TEXT;

-- CreateIndex
CREATE INDEX "projects_ownerUserId_idx" ON "projects"("ownerUserId");

-- AddForeignKey
ALTER TABLE "test_generation_runs" ADD CONSTRAINT "test_generation_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_runs" ADD CONSTRAINT "experiment_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
