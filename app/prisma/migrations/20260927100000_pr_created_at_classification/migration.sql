-- WI-CORE-011 (HU12, HU14): conserva la fecha de creación del PR y el resultado
-- de elegibilidad respecto del binding. NULL mantiene ocultos los Runs hasta
-- que la metadata histórica pueda verificarse.
ALTER TABLE "analysis_runs"
  ADD COLUMN "pullRequestCreatedAt" TIMESTAMP(3),
  ADD COLUMN "repositoryBindingEligible" BOOLEAN;

CREATE INDEX "analysis_runs_pr_metadata_eligibility_idx"
  ON "analysis_runs"("repositoryId", "prNumber", "repositoryBindingEligible");
