# WI-CORE-036 — Revisión independiente · ciclo excepcional 3/3

Modelo: reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## status

CHANGES_REQUESTED

## findings

1. **[P1] La migración deja sin raíz a Projects existentes que ya tienen una versión vigente.** `Project.projectRoot` se agrega nullable, pero la migración solo backfillea `ProjectVersion.effectiveProjectRoot` a `.`. En una base existente, un Project con `currentVersionId` continúa devolviendo `projectRoot: null` hasta que otro Run termine correctamente, aunque la versión vigente y la semántica histórica de TypeScript/legacy sean `.`. INTEROP-2.8 reserva `null` para antes de resolver la raíz, y el criterio de aceptación 5 exige conservar `.` en TypeScript. Backfillear `projects.projectRoot='.'` para Projects con versión vigente (o derivar el valor equivalente de manera compatible) y cubrirlo con una regresión de migración/respuesta.

## blockers

- Corregir la migración para Projects existentes con `currentVersionId` antes de cerrar WI-CORE-036.
- `DEC-PHP-ROOT-001` sigue pendiente solo para el caso de varios manifiestos y no bloquea el candidato único ni el parking aprobado.

## filesAffected

- `app/prisma/schema.prisma`
- `app/prisma/migrations/20261011100000_project_roots/migration.sql`
- `app/src/project-versions/project-root.util.ts` y su spec
- `app/src/project-versions/project-versions.repository.ts` y su spec
- DTOs/servicios de `Project` y `ProjectVersion`
- `app/src/project-versions/indexing.constants.ts`
- `app/src/snapshot-intelligence/github-snapshot-materializer.service.ts` y su spec
- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts` y su spec

## evidence

- PULL Contract Sync `before-review`, ejecutado en modo read-only: `relevantPendingSyncIds: []`; eventos revisados resueltos: `CS-CONSOLE-20261010-001`, `CS-GH-20260925-001`–`005`, `CS-GH-20260926-001`, `CS-GH-20260927-001`, `CS-GH-20261010-001`; eventos históricos `NOT_RELEVANT`: `CS-20260920-001`, `CS-20260921-003`.
- `pnpm run lint` en `app/`: pasó.
- `pnpm test` en `app/`: 137 archivos pasaron, 6 saltados; 2,094 pruebas pasaron, 104 saltadas.
- `pnpm run build` en `app/`: pasó.
- `pnpm exec prisma validate --schema prisma/schema.prisma` en `app/`: pasó.
- `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs` y `node harness/validate-harness.mjs`: pasaron.
- `git diff --check`: pasó.
- Inspección del handler: el marker sticky coteja SHA y versión de política antes de acceder al binding/materializador; un Run que ya no está `QUEUED` retorna sin efectos; la detección de múltiples manifiestos ocurre antes de compare, parseo, persistencia/promoción y resultado de dominio. El retry conserva el Run `QUEUED` y programa hasta 24 horas.
- Inspección de `migration.sql`: `ProjectVersion.effectiveProjectRoot` recibe default/backfill `'.'`; no hay actualización equivalente de `projects.projectRoot` para Projects existentes con `currentVersionId`.

## recommendedNextStep

Agregar el backfill compatible de `Project.projectRoot` para Projects existentes con versión vigente, repetir los gates y presentar el diff corregido al Human Reviewer. Este es el ciclo excepcional final de reviewer IA; no solicitar otro reviewer IA. Mantener WI-CORE-037 separado.
