-- WI-CORE-053 (HU12/HU17; corte A): evidencia interna por repetición experimental (contenido de prueba y hechos
-- normalizados del Sandbox). Migración estrictamente aditiva: una tabla nueva, su índice único y su FK, más RLS.
-- No altera tablas existentes ni modifica filas. Sin backfill: las repeticiones anteriores no tienen artefacto.
--
-- Rollback manual (solo si no hay evidencia que conservar; ejecutar en este orden):
--   DROP TABLE "experiment_repetition_artifacts";

-- CreateTable
CREATE TABLE "experiment_repetition_artifacts" (
    "id" TEXT NOT NULL,
    "repetitionId" TEXT NOT NULL,
    "testContent" TEXT,
    "testContentSha256" TEXT,
    "testContentTruncated" BOOLEAN NOT NULL DEFAULT false,
    "runnerReport" JSONB,
    "runnerReportSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_repetition_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experiment_repetition_artifacts_repetitionId_key" ON "experiment_repetition_artifacts"("repetitionId");

-- AddForeignKey
ALTER TABLE "experiment_repetition_artifacts" ADD CONSTRAINT "experiment_repetition_artifacts_repetitionId_fkey" FOREIGN KEY ("repetitionId") REFERENCES "experiment_repetitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security: Core accede con el rol propietario (ignora RLS); anon y authenticated quedan sin acceso.
ALTER TABLE "experiment_repetition_artifacts" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  table_name text;
  tables text[] := ARRAY['experiment_repetition_artifacts'];
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
