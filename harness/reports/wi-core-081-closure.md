# WI-CORE-081 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: corregido el filtro de vitest del job informativo «Specs con PostgreSQL (pgvector)» de la CI (`.github/workflows/ci.yml`): `.pg.spec.ts` (subcadena) en lugar del glob `src/**/*.pg.spec.ts`. Commit `3963b87`. Autorización del usuario: «trata cualquier corrección por tu flujo (WI y reviewer), sin merge ni push sin mi autorización»; **el push de este commit espera su autorización expresa**.

- **Causa raíz:** los argumentos posicionales de vitest son filtros de subcadena; el glob no coincidía con ningún archivo (`No test files found`). Confirmado con vitest 4.1.11: `vitest list --filesOnly .pg.spec.ts` lista exactamente los 6 archivos `*.pg.spec.ts`; el filtro anterior, ninguno; `find` no encuentra otros archivos con `pg.spec` en el nombre.
- **Revisión independiente (`reviewer`):** APPROVED, ciclo 1 de 2 (`wi-core-081-independent-review.md`): diff de una línea, YAML válido, job sigue informativo, los 6 nombres `*_TEST_DATABASE_URL` del job coinciden con los que leen las specs, las guardas `isLocal` se cumplen y la extensión `vector` la crea la migración 20260831025153 aplicada por `migrate deploy`. `contract-reviewer`: no aplica; sin Contract Sync.
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.

## Pendiente tras el push (no verificado)

Las 6 specs correrán contra pgvector por primera vez en GitHub; el reviewer no las ejecutó (no había BD local descartable y no se usó `app/.env`). Observación baja: las URLs del job llevan `?schema=public` (sintaxis Prisma) y las specs la pasan a `pg` como connectionString; `pg` ignora parámetros desconocidos, se vigila en el primer run real. Si el job falla por causas reales, se abre un WI propio.
