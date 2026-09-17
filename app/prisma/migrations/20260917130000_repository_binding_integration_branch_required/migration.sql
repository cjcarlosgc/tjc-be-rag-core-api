-- HU30 (SYSTEM-2.2/INTEROP-2.2): integrationBranch ya no tiene default.
-- El usuario elige una rama real entre las autorizadas por la GitHub App;
-- no existe equivalencia "develop" implícita.
ALTER TABLE "repository_bindings" ALTER COLUMN "integrationBranch" DROP DEFAULT;
