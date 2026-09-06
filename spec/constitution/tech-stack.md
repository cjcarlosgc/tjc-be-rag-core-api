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
- Configuración: `@nestjs/config`, `.env`, `ConfigService`; secretos nunca hardcodeados.
- Embeddings/LLM: proveedores por interfaz. OpenAI y `text-embedding-3-small` son el proveedor/modelo provisional vigente para embeddings; la selección definitiva está gobernada por `DEC-EMB-001` en `spec/transversal/providers/spec.md`.
- Storage: Supabase Storage vía `@supabase/supabase-js`, encapsulado detrás de la abstracción interna `ObjectStorageService`; la lógica de dominio no depende del SDK ni del proveedor concreto.
- Package manager: pnpm.
- Mecanismo durable de jobs: cola DB-backed sobre PostgreSQL de Supabase (tabla `jobs`, despacho con `SELECT ... FOR UPDATE SKIP LOCKED`). Sin broker externo en V1.
