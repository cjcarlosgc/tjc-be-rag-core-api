-- CreateTable
CREATE TABLE "user_github_identities" (
    "userId" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "githubLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_github_identities_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_github_identities_githubUserId_key" ON "user_github_identities"("githubUserId");


-- Raíz de confianza de la identidad (014, HU62): esta tabla NO debe ser legible ni
-- escribible desde la Data API de Supabase (PostgREST). Solo Core la usa, con la
-- conexión directa a PostgreSQL (rol propietario, que ignora RLS). Se habilita RLS
-- sin políticas (deniega todo a roles sujetos a RLS) y se revocan los privilegios de
-- los roles de la Data API; el REVOKE solo corre si esos roles existen, para no
-- romper una base local sin roles de Supabase.
ALTER TABLE "user_github_identities" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "user_github_identities" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "user_github_identities" FROM authenticated;
  END IF;
END
$$;
