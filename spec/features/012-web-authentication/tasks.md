# 012-web-authentication — Tareas

**Progreso (sesión 2026-09-12, sin commits):** implementación funcional completa en `app/`, sin cerrar por falta de e2e de `test-generation` y evidencia de revisión. Ver "Retomar" al final antes de continuar en una sesión nueva.

- [x] Configurar verificación de Supabase Auth y guard global con excepciones públicas mínimas. `app/src/common/auth/` (`AuthGuard`, `SupabaseJwtVerifier` con JWKS real vía `jose`; confirmado en vivo que el proyecto Supabase usa claves ES256 asimétricas). Solo `GET /health` es público (`@Public()`).
- [x] Migrar `Project.ownerUserId` e índices; definir asignación explícita de datos live preexistentes. Migración `20260912050000_web_auth_owner_scoping` ya aplicada contra la Supabase real (`ownerUserId` nullable, filas existentes quedan sin propietario y por tanto inaccesibles fuera del bypass; también agrega las relaciones `TestGenerationRun.project`/`ExperimentRun.project` que faltaban en el esquema).
- [x] Aplicar scoping por propietario a proyectos y todos sus recursos descendientes. Repositorios de `projects`, `project-versions`, `test-generation-runs`, `experiment-runs`, `test-targets`, `artifacts` ganaron una variante `findByIdForOwner`/`findById(id, ownerUserId)` que filtra en la consulta (no carga-y-compara); los `findById` sin scoping se conservan solo para uso interno de job handlers (sin identidad de usuario en su contexto).
- [x] Proteger descargas y handshake/suscripciones WebSocket. `ArtifactService`/`ArtifactsController` piden `ownerUserId`; `RealtimeGateway` verifica propiedad de `projectVersionId`/`testRunId` antes de `client.join(...)`.
- [x] Implementar `AUTH_REQUIRED` e `INVALID_ACCESS_TOKEN` sin filtrar tokens/claims. Agregados a `error-code.enum.ts`; el guard nunca loguea el header ni el payload.
- [x] Implementar bypass únicamente local/mock y fallo de arranque si se habilita en producción. `AUTH_BYPASS_ENABLED`/`AUTH_BYPASS_USER_ID` en `env.validation.ts`, con chequeo cruzado `NODE_ENV=production` que lanza al arrancar.

## Calidad

- [ ] Agregar matriz de pruebas unitarias, integración y e2e de autorización. Unitarias: **hechas** (`auth.guard.spec.ts`, `supabase-jwt-verifier.spec.ts`, casos nuevos en `env.validation.spec.ts`, y actualización de los specs de `projects`/`project-versions`/`test-generation`/`experiments`/`artifact` service + `realtime.gateway.spec.ts`). e2e: **hechas** `projects.e2e-spec.ts`, `project-versions.e2e-spec.ts`, `experiments.e2e-spec.ts` (con matriz cross-owner 404 y caso 401 sin header); **falta** `test-generation.e2e-spec.ts` (el más grande, ~36 llamadas a `request(...)`, mismo patrón que los otros tres: usar `test/support/auth-test-support.ts` — `overrideAuthTokenVerifier` en el `beforeAll` + reemplazar `request(app.getHttpServer())` por `authedRequest(app)` + agregar caso 401 sin header y matriz cross-owner en retry/results/history).
- [ ] Verificar ausencia de secretos/tokens en logs y respuestas. Revisado por diseño (guard no loguea `Authorization`/payload); falta una pasada explícita de verificación antes de cierre.
- [ ] Ejecutar lint/test/build/SDD check. `lint`, `test` (unit, 264/264) y `build` ya están en verde. `test:e2e` falta correr completo una vez se actualice `test-generation.e2e-spec.ts` (los 3 archivos ya migrados pasan en verde de forma aislada).
- [ ] Registrar evidencia de revisión. Pendiente: no hay commit todavía (regla del repo: no commitear sin pedido explícito del usuario) ni reporte en `harness/reports/`.

## Retomar en una sesión nueva

1. Leer este archivo, `spec/features/012-web-authentication/spec.md`/`plan.md`, y `harness/state.json` (`activeWorkItem.id = "HU29-web-authentication"`, estado `IN_PROGRESS`, `approved: true`).
2. `git status`/`git diff` en `tjc-be-rag-core-api` muestra todo el trabajo sin commitear todavía (nada se ha commiteado ni empujado).
3. Terminar `app/test/test-generation.e2e-spec.ts` como se describe arriba, luego correr `pnpm run test:e2e` completo en `app/`.
4. Antes de correr e2e contra la Supabase real, verificar que no haya otros procesos locales (`nest start --watch`, `node dist/main`, etc.) conectados al mismo `DATABASE_URL`: compiten por la tabla `jobs` y producen fallos falsos de tipo "Object not found" al descargar el snapshot (no relacionado con esta feature).
5. Con `test:e2e` en verde, marcar las tareas de "Calidad" restantes, y pedir al usuario confirmación antes de commit/push (ver `spec/constitution/delivery-workflow.md`).
6. Después de HU29, la prioridad discutida con el usuario era continuar con `011-context-traces` (HU27/HU28), construido ya sobre el scoping por propietario de esta feature.
