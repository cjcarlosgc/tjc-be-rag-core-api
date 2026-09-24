-- HU27/HU28: persistencia de trazas de contexto por intento experimental.
-- Los datos viejos de experiment_repetitions se conservan: si un job llegó a
-- insertar más de una fila para la misma repetición, se numeran como intentos.

CREATE TYPE "ExperimentRepetitionState" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "ContextTraceKind" AS ENUM ('RAG', 'AGENT');
CREATE TYPE "ContextTraceState" AS ENUM ('CAPTURING', 'COMPLETE', 'FAILED');

ALTER TABLE "experiment_repetitions"
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "state" "ExperimentRepetitionState" NOT NULL DEFAULT 'COMPLETED';

WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "experimentId", "strategy", "repetition"
      ORDER BY "createdAt" ASC, "id" ASC
    )::INTEGER AS attempt_number
  FROM "experiment_repetitions"
)
UPDATE "experiment_repetitions" AS repetition
SET "attempt" = numbered.attempt_number
FROM numbered
WHERE repetition."id" = numbered."id";

ALTER TABLE "experiment_repetitions"
  ALTER COLUMN "state" SET DEFAULT 'RUNNING',
  ADD CONSTRAINT "experiment_repetitions_attempt_positive_check" CHECK ("attempt" > 0),
  ADD CONSTRAINT "experiment_repetitions_repetition_range_check" CHECK ("repetition" BETWEEN 1 AND 3);

CREATE UNIQUE INDEX "experiment_repetitions_experimentId_strategy_repetition_attempt_key"
  ON "experiment_repetitions"("experimentId", "strategy", "repetition", "attempt");
CREATE UNIQUE INDEX "experiment_repetitions_id_experimentId_strategy_repetition_attempt_key"
  ON "experiment_repetitions"("id", "experimentId", "strategy", "repetition", "attempt");
CREATE UNIQUE INDEX "project_versions_id_projectId_key"
  ON "project_versions"("id", "projectId");
CREATE UNIQUE INDEX "test_targets_id_projectVersionId_key"
  ON "test_targets"("id", "projectVersionId");
CREATE UNIQUE INDEX "experiment_runs_id_projectId_projectVersionId_targetId_key"
  ON "experiment_runs"("id", "projectId", "projectVersionId", "targetId");

CREATE TABLE "context_traces" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectVersionId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "experimentRepetitionId" TEXT NOT NULL,
  "kind" "ContextTraceKind" NOT NULL,
  "strategy" "ExperimentStrategy" NOT NULL,
  "repetition" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL,
  "current" BOOLEAN NOT NULL DEFAULT true,
  "state" "ContextTraceState" NOT NULL DEFAULT 'CAPTURING',
  "detail" JSONB,
  "toolCalls" INTEGER NOT NULL DEFAULT 0,
  "filesInspected" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "context_traces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "context_traces_repetition_range_check" CHECK ("repetition" BETWEEN 1 AND 3),
  CONSTRAINT "context_traces_attempt_positive_check" CHECK ("attempt" > 0),
  CONSTRAINT "context_traces_kind_strategy_check" CHECK (
    ("kind" = 'RAG' AND "strategy" = 'RAG') OR ("kind" = 'AGENT' AND "strategy" = 'GENERALIST_AGENT')
  ),
  CONSTRAINT "context_traces_tool_calls_nonnegative_check" CHECK ("toolCalls" >= 0),
  CONSTRAINT "context_traces_files_inspected_nonnegative_check" CHECK ("filesInspected" >= 0),
  CONSTRAINT "context_traces_projectVersionId_projectId_fkey" FOREIGN KEY ("projectVersionId", "projectId")
    REFERENCES "project_versions"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "context_traces_targetId_projectVersionId_fkey" FOREIGN KEY ("targetId", "projectVersionId")
    REFERENCES "test_targets"("id", "projectVersionId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "context_traces_experimentId_projectId_projectVersionId_targetId_fkey" FOREIGN KEY ("experimentId", "projectId", "projectVersionId", "targetId")
    REFERENCES "experiment_runs"("id", "projectId", "projectVersionId", "targetId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "context_traces_experimentRepetitionId_experimentId_strategy_repetition_attempt_fkey" FOREIGN KEY ("experimentRepetitionId", "experimentId", "strategy", "repetition", "attempt")
    REFERENCES "experiment_repetitions"("id", "experimentId", "strategy", "repetition", "attempt") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "context_traces_experimentRepetitionId_attempt_key"
  ON "context_traces"("experimentRepetitionId", "attempt");
CREATE UNIQUE INDEX "context_traces_experimentId_strategy_repetition_attempt_key"
  ON "context_traces"("experimentId", "strategy", "repetition", "attempt");
CREATE INDEX "context_traces_experimentId_current_strategy_repetition_idx"
  ON "context_traces"("experimentId", "current", "strategy", "repetition");
CREATE INDEX "context_traces_projectVersionId_idx" ON "context_traces"("projectVersionId");
CREATE INDEX "context_traces_targetId_idx" ON "context_traces"("targetId");
CREATE UNIQUE INDEX "context_traces_current_logical_repetition_key"
  ON "context_traces"("experimentId", "strategy", "repetition") WHERE "current" = true;

CREATE TABLE "discovered_files" (
  "id" TEXT NOT NULL,
  "contextTraceId" TEXT NOT NULL,
  "step" INTEGER NOT NULL,
  "filePath" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "discovered_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "discovered_files_step_positive_check" CHECK ("step" > 0),
  CONSTRAINT "discovered_files_relative_path_check" CHECK (
    "filePath" <> '' AND left("filePath", 1) <> '/' AND "filePath" !~ '(^|/)\.(/|$)' AND "filePath" !~ '(^|/)\.\.(/|$)' AND position(E'\\' IN "filePath") = 0
  ),
  CONSTRAINT "discovered_files_contextTraceId_fkey" FOREIGN KEY ("contextTraceId")
    REFERENCES "context_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "discovered_files_contextTraceId_step_filePath_key"
  ON "discovered_files"("contextTraceId", "step", "filePath");
CREATE INDEX "discovered_files_contextTraceId_step_id_idx"
  ON "discovered_files"("contextTraceId", "step", "id");

-- All domain evidence remains reachable only through the Core database role.
ALTER TABLE "context_traces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discovered_files" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  table_name text;
  tables text[] := ARRAY['context_traces', 'discovered_files'];
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY tables LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
