# Tech stack

**Estado:** parcialmente aprobado

- Backend: NestJS + TypeScript.
- Persistencia: PostgreSQL + pgvector en Supabase para datos de dominio, chunks, embeddings vectoriales y la cola DB-backed de jobs.
- ORM: Prisma para relacional; TypedSQL/raw SQL para operaciones vectoriales.
- AST/análisis estructural: adapters por lenguaje; ts-morph se conserva para TypeScript y la alternativa PHP se selecciona al implementar HU41.
- Input objetivo: GitHub repository + commit SHA + PR CHANGESET. ZIP permanece como entrada legacy/development.
- Stacks: TypeScript (`.ts`/`.tsx`) con Jest/Vitest en compatibility track; PHP/Laravel con PHPUnit como active development track. JavaScript puro no se habilita por esta decisión.
- Distancia vectorial: cosine.
- Configuración: `@nestjs/config`, `.env`, `ConfigService`; secretos nunca hardcodeados. El proyecto Supabase aprobado tiene ref `hhapysqvomhvquylhwvt`, URL pública `https://hhapysqvomhvquylhwvt.supabase.co` y host PostgreSQL `db.hhapysqvomhvquylhwvt.supabase.co:5432`; contraseña y keys solo se suministran por entorno.
- Embeddings/LLM: proveedores por interfaz. OpenAI y `text-embedding-3-small` (dimensionalidad `1536`) son el proveedor/modelo definitivo de V1 para embeddings, conforme a `DEC-EMB-001` (APROBADO) en `spec/transversal/providers/spec.md`.
- Storage: bucket privado Supabase Storage `repository-zips` vía `@supabase/supabase-js`, consumido solo por RAG Core y encapsulado detrás de `ObjectStorageService`; la lógica de dominio no depende del SDK ni del proveedor concreto.
- Variables canónicas de Core: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` y configuración verificable de issuer/audience/signing keys para Supabase Auth. JWKS es la vía preferida con claves asimétricas; el modo legacy simétrico requiere validación server-side contra Auth. La publishable key puede existir en Developer Console exclusivamente para Auth; Frontend nunca recibe secret key, DB password, bucket keys o signed URLs, y Sandbox no recibe ninguna credencial Supabase.
- Integración Sandbox: `SANDBOX_URL` y `SANDBOX_SERVICE_TOKEN`; el secreto es opaco, precompartido solo entre ambos backends, obligatorio en Core cuando existe URL y nunca se expone al frontend ni al container.
- Package manager del servicio: pnpm. Los proyectos recibidos también deben contener `pnpm-lock.yaml` para ser ejecutables en Sandbox V1; se instalan con pnpm y lockfile congelado.
- Mecanismo durable de jobs: cola DB-backed sobre PostgreSQL de Supabase (tabla `jobs`, despacho con `SELECT ... FOR UPDATE SKIP LOCKED`). Sin broker externo en V1.
- Integración de repositorio: GitHub App dentro de Core con firma de webhooks, Checks y permisos mínimos; GitHub OAuth solo se usa por Supabase Auth para login.
- Sandbox profiles: `NODE_TYPESCRIPT` vigente y `PHP_LARAVEL_PHPUNIT` aprobado para implementar con PHP, Composer y PHPUnit reales.
