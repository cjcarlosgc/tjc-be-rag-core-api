# WI-CORE-003 — Evidencia de implementación

**Fecha:** 2026-09-26
**Estado:** evidencia de código y checks locales registrada. El WI permanece `W-IN_PROGRESS`; no es una aprobación ni un cierre.

## Alcance comprobado en fuente

- HU11 / ST-CORE-015: Core envía el campo obligatorio `executionProfile` a Sandbox y mapea `JEST` y `VITEST` a `NODE_TYPESCRIPT`; las pruebas de `SandboxExecutionService` comprueban ambos bodies. No se cambia el runtime Sandbox.
- Core delega sus operaciones del pipeline (repo/PR, compare/tree/files, Checks y publicación) a GitHub Integration. Core conserva reglas de negocio, dominio, almacenamiento, jobs, RAG y efectos idempotentes.
- Console llama directamente a Integration solo para App info, discovery, verificación y ramas. Core sigue ofreciendo temporalmente las rutas previas de discovery/verificación/ramas hasta el corte de retiro aprobado por separado.
- Integration autoriza cada operación de usuario consultando Core con JWT Supabase y hechos GitHub allowlisted. Core decide sin callback de vuelta a Integration; devuelve decisión o evidencia de binding firmada, de vida breve y ligada al alcance. El token OAuth de proveedor no llega a Core.
- Core recibe webhooks normalizados en `/internal/v1/github/webhook-events`; el bearer GH→Core se compara antes de parsear. El límite de 25 MB solo cubre esa ruta; JSON general conserva 100 KB. Core valida el evento, hace dedupe durable y conserva AnalysisRun/jobs y efectos idempotentes.
- Core conserva Object Storage y snapshot ZIP interno que consume Docker/Sandbox. Para publicación autorizada, lee cada propuesta almacenada y transmite temporalmente el contenido Base64 a Integration; Core verifica el máximo GitHub de 100 MB por blob. En GH, el parser de 136 MB se limita a `proposal-blobs`; finalización y parser general mantienen 100 KB.
- No se modificó Sandbox ni se realizó deploy/cutover/configuración externa. Las credenciales GitHub, app privada y verificación HMAC pertenecen a Integration; Core conserva solo URL y credenciales de servicio necesarias.

## Contrato y Harness

`GH-INTEROP-1.1` está espejado byte por byte entre Core, Console y GitHub Integration. Los Contract Sync `CS-GH-20260925-001`–`005` conservan su resolución histórica. `CS-GH-20260926-001` fue importado, revisado y resuelto en Core con evidencia; su resolución no equivale a la revisión personal ni al cierre del WI.

## Verificación reproducible

- Corte `ST-CORE-015`: `pnpm --dir app exec vitest run src/sandbox/sandbox-execution.service.spec.ts` — 1 archivo, 8/8 pruebas; cubre `VITEST` y `JEST` enviados con `NODE_TYPESCRIPT`.
- Verificación completa repetida para este corte: `pnpm --dir app test` — 97 archivos aprobados, 1 omitido; 1.101 pruebas aprobadas y 36 omitidas; `pnpm --dir app lint` y `pnpm --dir app build` pasaron.
- `node --test harness/work-item-story-scope.test.mjs` — 2/2; `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs`, `node harness/validate-completions.mjs` y `node scripts/sdd-check.mjs` pasaron. Contract Sync `implementation-delivery` y `before-review` informan cero eventos relevantes pendientes.
- Core: `pnpm test`, `pnpm lint`, `pnpm build` y `pnpm test:e2e` pasaron; e2e: 7 archivos, 222/222 pruebas, con paralelismo de archivos desactivado como exige la configuración de Core.
- En la verificación posterior a la revisión: `pnpm test` pasó con 1.100 pruebas y 36 skips; `pnpm lint` y `pnpm build` pasaron. `request-body-parsers.spec.ts` pasó 3/3, incluyendo reemplazo de `X-Correlation-ID` inválido por UUID en errores 401/413 y coherencia entre header y body.
- Harness Core: `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs` y `node harness/validate-completions.mjs` pasaron.
- La prueba del límite rechaza un webhook de 150 KB sin bearer antes del parseo, acepta el tamaño al autenticarse y mantiene el rechazo 413 en una ruta general.
- La prueba de publicación mayor a 100 MB falla antes de Base64/upload/finalización, sin marcar propuestas publicadas.

## Pendiente

La revisión técnica delegada de la frontera multi-repositorio encontró el caso P3 del ID de correlación; el fix y su prueba fueron confirmados en una revisión focalizada posterior. También se corrigió la frase P2 del espejo INTEROP que atribuía a Core el filtrado de discovery. Esto registra revisión técnica y fixes, no sustituye tu visto bueno: `independentReviewPassed` y los gates de cierre pendientes siguen `G-NOT_RUN`. `CS-GH-20260926-001` está `C-RESOLVED` con evidencia local. No pasar a `W-DONE`, no hacer push ni declarar deploy/cutover.
