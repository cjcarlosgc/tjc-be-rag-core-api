# Evidencia — HU01 (001-project-management)

**Sprint:** Sprint 1 · **Estado:** DONE

## Alcance implementado

- Scaffold inicial de la app NestJS en `app/` (pnpm, TypeScript, Vitest, oxlint).
- `PrismaModule`/`PrismaService` (Prisma 7, driver adapter `@prisma/adapter-pg`, config en `app/prisma.config.ts`).
- Schema Prisma con `Project` y `ProjectVersion` (mínimo, solo lo necesario para la relación `currentVersionId`; el resto de `ProjectVersion` es objeto de la feature 002).
- `docker-compose.yml` con Postgres 16 + pgvector para desarrollo local (puerto host `5433` para no chocar con un Postgres local existente).
- Migración inicial `prisma/migrations/20260831023343_init`.
- Módulo `projects`: DTO validado (`CreateProjectDto`), `ProjectsRepository`, `ProjectsService`, `ProjectsController`.
  - `POST /projects` → 201, crea el proyecto (`currentVersionId` nulo).
  - `GET /projects/:id` → 200, o 404 `PROJECT_NOT_FOUND` si no existe.
- Infraestructura transversal mínima: envelope de error estándar (`AllExceptionsFilter`), catálogo de `ErrorCode` (spec `errors`), middleware de `x-correlation-id`, `ConfigModule` con validación de entorno, `GET /health`.

## Decisión resuelta

- Package manager: **pnpm** (elegido por el usuario; PENDING en `spec/constitution/tech-stack.md` resuelto y registrado en `CHANGELOG.md`).

## Fuera de alcance (diferido a features posteriores)

- Indexación real de `ProjectVersion` (feature 002).
- Mecanismo durable de jobs y proveedor de Object Storage (siguen `PENDING` en `tech-stack.md`; no se necesitan para HU01).

## Verificación

Ejecutado en `app/`:

- `pnpm lint` → OK (oxlint, sin hallazgos).
- `pnpm test` → 3/3 pruebas unitarias OK (`ProjectsService`).
- `pnpm test:e2e` → 4/4 pruebas e2e OK (`test/projects.e2e-spec.ts`, contra `PrismaService` fake en memoria, pipeline HTTP completo: pipes, filtro global, middleware de correlación).
- `pnpm build` → OK.
- Verificación manual contra Postgres real (`docker compose up -d postgres` + `prisma migrate dev`): `POST /projects`, `GET /projects/:id` (200 y 404) y `GET /health` responden con el envelope y códigos esperados.

## Cómo levantar el entorno local

```bash
cd app
cp .env.example .env   # ya existe .env de desarrollo
pnpm install
pnpm db:up              # Postgres + pgvector en localhost:5433
pnpm prisma:migrate      # aplica migraciones
pnpm start:dev
```
