-- Cierre de la exposición por la Data API de Supabase (PostgREST), HU62.
--
-- Las tablas del schema `public` eran legibles con la clave pública (`anon`): ninguna
-- migración anterior habilitaba RLS ni revocaba privilegios (solo `user_github_identities`).
-- Core usa una conexión directa a PostgreSQL con el rol propietario, que ignora RLS, así
-- que no se ve afectado. Aquí se habilita RLS SIN políticas en todas las tablas (deniega
-- todo a los roles sujetos a RLS), se revocan los privilegios de `anon` y `authenticated`
-- y se evita que las tablas futuras se concedan por defecto.
--
-- Regla: toda tabla nueva debe habilitar RLS en su propia migración con
-- `ALTER TABLE "<tabla>" ENABLE ROW LEVEL SECURITY;` (la prueba
-- `src/prisma/rls-guard.spec.ts` falla si falta). Los REVOKE solo corren si los roles
-- existen, para no romper una base local sin roles de Supabase; todo es idempotente.

-- EnableRowLevelSecurity
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repository_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analysis_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analysis_symbols" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generated_test_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "functional_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "functional_knowledge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "code_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_generation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "target_run_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "experiment_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "experiment_repetitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_github_identities" ENABLE ROW LEVEL SECURITY;

-- Tabla de control de Prisma (no está en schema.prisma). Solo si existe.
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;

-- Revoke privilegios de la Data API (solo si el rol existe)
DO $$
DECLARE
  role_name text;
  table_name text;
  tables text[] := ARRAY[
    'projects',
    'repository_bindings',
    'analysis_runs',
    'analysis_symbols',
    'generated_test_proposals',
    'test_publications',
    'functional_questions',
    'functional_knowledge',
    'webhook_deliveries',
    'project_versions',
    'code_chunks',
    'test_targets',
    'test_generation_runs',
    'target_run_results',
    'artifacts',
    'experiment_runs',
    'experiment_repetitions',
    'jobs',
    'idempotency_records',
    'user_github_identities',
    '_prisma_migrations'
  ];
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY tables LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
          EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
        END IF;
      END LOOP;
      -- Las tablas futuras del rol que migra no se conceden por defecto.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
