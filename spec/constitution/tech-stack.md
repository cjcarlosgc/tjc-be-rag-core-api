# Tech stack

**Estado:** parcialmente aprobado

- Backend: NestJS + TypeScript.
- Persistencia: PostgreSQL + pgvector en Supabase para datos de dominio, chunks, embeddings vectoriales y la cola DB-backed de jobs.
- ORM: Prisma para relacional; TypedSQL/raw SQL para operaciones vectoriales.
- AST: ts-morph.
- Input V1: ZIP.
- Lenguaje objetivo e input implementable V1: exclusivamente TypeScript (`.ts`/`.tsx`). La redacción académica puede ubicar el trabajo en el ecosistema JavaScript/TypeScript, pero JavaScript puro (`.js`, `.jsx`, `.mjs`, `.cjs`) no está soportado en V1.
- Test frameworks objetivo: Jest y Vitest.
- Distancia vectorial: cosine.
- Configuración: `@nestjs/config`, `.env`, `ConfigService`; secretos nunca hardcodeados. El proyecto Supabase aprobado tiene ref `hhapysqvomhvquylhwvt`, URL pública `https://hhapysqvomhvquylhwvt.supabase.co` y host PostgreSQL `db.hhapysqvomhvquylhwvt.supabase.co:5432`; contraseña y keys solo se suministran por entorno.
- Embeddings/LLM: proveedores por interfaz. OpenAI y `text-embedding-3-small` (dimensionalidad `1536`) son el proveedor/modelo definitivo de V1 para embeddings, conforme a `DEC-EMB-001` (APROBADO) en `spec/transversal/providers/spec.md`.
- Storage: bucket privado Supabase Storage `repository-zips` vía `@supabase/supabase-js`, consumido solo por RAG Core y encapsulado detrás de `ObjectStorageService`; la lógica de dominio no depende del SDK ni del proveedor concreto.
- Variables canónicas: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `SUPABASE_STORAGE_BUCKET`; `SUPABASE_PUBLISHABLE_KEY` queda opcional y sin uso actual. Frontend y Sandbox no reciben estas credenciales.
- Package manager: pnpm.
- Mecanismo durable de jobs: cola DB-backed sobre PostgreSQL de Supabase (tabla `jobs`, despacho con `SELECT ... FOR UPDATE SKIP LOCKED`). Sin broker externo en V1.
