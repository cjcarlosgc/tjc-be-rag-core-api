# Tech stack

**Estado:** parcialmente aprobado

- Backend: NestJS + TypeScript.
- Persistencia: PostgreSQL + pgvector.
- ORM: Prisma para relacional; TypedSQL/raw SQL para operaciones vectoriales.
- AST: ts-morph.
- Input V1: ZIP.
- Lenguaje objetivo V1: TypeScript.
- Test frameworks objetivo: Jest y Vitest.
- Distancia vectorial: cosine.
- Configuración: `@nestjs/config`, `.env`, `ConfigService`; secretos nunca hardcodeados.
- Embeddings/LLM: proveedores por interfaz, OpenAI inicial.
- Storage: Object Storage por interfaz. **PENDING:** proveedor concreto.
- **PENDING:** package manager y mecanismo durable de jobs.
