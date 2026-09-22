# T-003-org-workspaces — continuidad para otro agente (2026-09-21)

Documento operativo para que otro agente (p. ej. Codex) continúe sin el contexto de la conversación. **La fuente de verdad sigue siendo `spec/`** (lee `AGENTS.md` -> `spec/README.md` -> contratos -> `spec/features/014-organizations-access/`). Este archivo solo dice *dónde quedó el trabajo* y *qué sigue*. Si algo aquí contradice `spec/`, gana `spec/`.

## 1. Estado en una frase

El contrato SYSTEM-2.4 / INTEROP-2.4 (uso organizacional) está **aprobado y publicado a Console como definición** (`CS-20260921-001`), el **bundle A está implementado, revisado y publicado** (`CS-20260921-002`), y el **bundle B está implementado y con el ciclo de corrección 1 aplicado**; falta la **re-comprobación acotada final**, los **gates técnicos** y publicar el **`CONTRACT_SYNC` del bundle B**. Nada de T-003 está pusheado.

## 2. Git

- Rama de trabajo: `feature/T-003` (creada desde `feature/T-002`; `develop` aún no contiene el harness V2). **Todo T-003 es local: no hay push, PR ni merge.** No los hagas sin solicitud explícita del usuario.
- `feature/T-002` está pusheada (`origin/feature/T-002`, hasta `a9a9307`). Su PR hacia `develop` **sigue sin abrirse**: la máquina no tiene `gh` ni token; el usuario puede abrirlo en `https://github.com/cjcarlosgc/tjc-be-rag-core-api/compare/develop...feature/T-002?expand=1`. No hay conflictos con `develop` según simulación local.
- Commits clave de T-003 (orden): contrato `caa4336`.. (T-002) y para T-003 `c3a5328`…`6464970` (contrato aprobado), bundle A `6236255`, `8ad4fa5`, `955b65d`, `ecf141f` (RLS), `f1eed4d`; bundle B: corte 2 `c0844af`; corte 3 `81419ae`, `2c81f39`; corte 5 `8f6e6b8`, `5e537f3`, `f33a78d`, `39d6414`; corrección 1 `1118326`, `d5fa6d4`, `ce2fc04`. `git log --oneline` tiene el detalle. Cada commit lleva `Refs: HU...` y `Co-Authored-By`.

## 3. Qué está hecho

| Pieza | Estado |
|---|---|
| Contrato SYSTEM-2.4 / INTEROP-2.4 | APROBADO por el usuario; 2 ciclos de revisión contractual; `DEC-ORG-001` y `DEC-ORG-002` APROBADAS (decisiones derivadas (a)-(ac) vetables). |
| Bundle A (corte 1 identidad GitHub + corte 4a seguridad del binding) | Implementado; revisión independiente + contract-reviewer APROBADAS; sync `CS-20260921-002` publicado 2026-09-21 08:56:50 (-05). |
| Bundle B (cortes 2, 3 y 5: workspaces, roles/acceso, webhooks y reconciliación) | Implementado y con ciclo de corrección 1 aplicado (`1118326`). Revisiones previas: modelo de acceso APPROVED, contract-reviewer APPROVED, jobs/webhooks CHANGES_REQUESTED (resuelto). |
| HU55 (`GET /analysis-runs` global) | Aprobada por el usuario dentro de T-003 e implementada. |
| Migraciones | **Todas aplicadas a Supabase** (última `20260921160000_jobs_dedupe_key`). No queda ninguna pendiente. |
| Seguridad de datos | RLS habilitado en las 22 tablas de `public`; Data API de Supabase **desactivada por el usuario**; guardia de prueba `app/src/prisma/rls-guard.spec.ts` falla si una tabla nueva no habilita RLS. |
| Verificaciones (árbol `1118326`+) | `npm run lint` OK; `npm test` 1096 OK (+36 omitidos = suite pg opt-in); `npm run build` OK; `npm run test:e2e` 211 OK. |

## 4. Qué falta (en este orden)

1. **Re-comprobación acotada final** del bundle B (ciclo de corrección 1 de 1 disponible): un `reviewer` independiente revisa `git diff 503cd66..HEAD`. Se lanzó al revisor de jobs/webhooks; **su resultado puede no estar registrado**. Si `harness/state.json` no muestra su handoff posterior a `1118326`, relánzalo (sin modificar archivos). Si pide cambios otra vez, los ciclos se agotaron: `status` -> `DECISION_REQUIRED` y decide el usuario.
2. **Gates técnicos del leader** sobre el árbol final (desde `app/`): `npm run lint && npm test && npm run build && npm run test:e2e`. Luego en `state.json`: `independentReviewPassed`, `technicalChecksPassed` = `PASSED` (solo con evidencia). El e2e tiene un flake esporádico sin causa raíz (2 de ~11 ejecuciones; `socket hang up` en la prueba de firma alterada de `member`, mitigado con `retry: 2`): si reaparece, investígalo antes de ignorarlo.
3. **Publicar `CS-20260921-003` (implementación del bundle B) a Console**: texto en `harness/reports/T-003-sync-bundle-b-borrador.yaml`. Comando: `node harness/contract-sync.mjs publish --id CS-20260921-003 --targets console --breaking false --changed "<changed>" --required-action "<requiredAction>" --source-revision <commit final>` (el CLI admite un solo valor por lista: une los ítems; pasa los textos por archivo con `"$(cat archivo)"` para evitar problemas de comillas). Registra el ID en `coordination.publishedSyncIds`, apunta la hora del archivo (`stat`) y pasa `contractSyncPublished` a `PASSED`. Los marcadores de INTEROP ya dicen "Implementado".
4. Cerrar el work item: `check` de CONTRACT_SYNC en `before-done`, `status` -> `DONE` solo con todos los gates en verde; archivar el estado en `harness/reports/T-003-org-workspaces.md` antes de abrir otro work item (`state.json` admite un solo `activeWorkItem`).

## 5. Precondiciones de despliegue (NO bloquean implementar; sí desplegar)

Están en `DEC-ORG-001` ("Precondiciones de despliegue") y en `014/spec.md`. Resumen operativo:

- **Orden obligatorio:** Console con login solo GitHub publicada PRIMERO -> bundle A de Core -> bundle B de Core. `GITHUB_IDENTITY_REQUIRED` aplica a toda la sesión: si Core se despliega antes, los usuarios de correo quedan con 401.
- El proveedor de correo/contraseña de Supabase Auth se deshabilita **solo después** de que Console ya no lo ofrezca; el *manual linking* de identidades debe seguir deshabilitado.
- La GitHub App (`rag-tesis-github-app`, App ID 5014750, propiedad de la organización `rag-tesis-org`, **pública** por decisión del usuario) no debería ser instalada por terceros hasta desplegar el bundle A (riesgo aceptado por el usuario).
- **Validar contra GitHub real** (con la App instalada y `Members: read` aceptado, que ya lo está en `rag-tesis-org`): rol de owner (`memberships` -> `admin`, probado), miembro (`member`, probado con `cjcarlosgc2`), permiso heredado del permiso base (`read` en repo privado, probado), miembro `write` directo (probado), y **pendientes**: membresía `pending` por usuario, permiso heredado por **Team**, colaborador **externo** con `write` (debe dar 404 en `memberships`), **lista de owners sin `Members: read`** (¿error o 200 vacío? Core ya trata el 200 vacío como no verificable), `GET /repositories/{id}` (renombre/transferencia/eliminación), entrega real de webhooks `member`/`membership`/`organization`/`team`/`repository`, Socket.IO real (expulsión y `SubscribeAck`), reconciliación con más de una instancia. La organización de prueba hoy solo tiene un repo público (`tjc-fe-ts-repo-test`); para pruebas de repo privado hay que crear otro.

## 6. Datos de prueba y entorno (sin secretos)

- Organización de prueba: `rag-tesis-org` (App instalada, todos los repos). Owner: `cjcarlosgc`. Miembro: `cjcarlosgc2` (`write` directo en `tjc-fe-ts-repo-test`, `read` heredado en privados). Hay 1 invitación pendiente por correo, de origen desconocido.
- Supabase: la base se limpió el 2026-09-20 (0 Projects); Storage vacío. Core se conecta como `postgres` (no superusuario, `BYPASSRLS`, dueño de las tablas): RLS no lo bloquea.
- Variables: Render ya tiene actualizadas `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_BASE64` y `GITHUB_APP_WEBHOOK_SECRET`. **La clave privada y el webhook secret de la App se pegaron en el chat de la sesión anterior**: recomienda al usuario **rotarlas** (regenerar la clave privada y el secreto) y actualizar Render y `app/.env`.
- Console (`/Users/jean/Tesis/workspaces/tjc-fe-rag-developer-console`) es otro repo con su propio agente: **no lo edites**; se coordina solo por `CONTRACT_SYNC` (`import --from <outbox de Core>`). El espejo del Sandbox sigue en 2.2 y no se ve afectado.
- Los scripts de sondeo de GitHub/Supabase usados en la sesión eran temporales (scratchpad) y no están en el repo. Para repetirlos: JWT de la App (RS256, `iss` = App ID) -> `GET /app`, `/app/installations`, `POST /app/installations/{id}/access_tokens` (única petición no-GET permitida) -> `GET /orgs/{org}/memberships/{login}`, `/orgs/{org}/members?role=admin`, `/repos/{o}/{r}/collaborators/{login}/permission`, `/installation/repositories`. Solo lectura; no imprimas tokens.

## 7. Reglas de trabajo vigentes (resumen)

- Sigue el harness: el `leader` orquesta y consolida estado; la implementación no trivial la hace un `implementer`, y **revisan agentes distintos** (`reviewer` y, con impacto contractual, `contract-reviewer`); máximo 2 ciclos de corrección. Ver `harness/WORKFLOW.md` y `harness/roles/`.
- Commits por corte con `Refs: HU...`. **No hagas push, PR, merge, cambios de infraestructura externa ni apliques migraciones a Supabase sin solicitud explícita del usuario en cada ocasión.** No corrijas nada en Console/Sandbox: entrega la indicación compacta.
- Los tests usan **fakes** (`GithubAccessPort`, `SupabaseIdentityPort`, `InMemoryPrisma`); ninguno llama a GitHub ni Supabase reales. La suite pg de la cola (`app/src/jobs/jobs.repository.pg.spec.ts`) solo corre con `JOBS_TEST_DATABASE_URL` apuntando a un PostgreSQL **local** descartable (probar en UTC y en `America/Bogota`).
- Toda tabla nueva debe habilitar RLS en su migración (la prueba de guardia lo exige).
- Los agentes en background pueden cortarse por límite de uso: revisa `git status`/`git log` antes de repetir trabajo y reanuda desde el inventario.

## 8. Puntos abiertos menores (deuda documentada, no bloquean)

En `spec/features/014-organizations-access/plan.md` ("límites conocidos") y `CHANGELOG.md`: candidatos de alta por listado (51 por `createdAt desc`), `GET /workspaces` verifica solo las primeras 50 instalaciones, la reconciliación (b) mide el presupuesto por Project completo, sin heartbeat de locks de jobs, un listado que llena exactamente el tope de páginas se trata como no verificable, eventos de acceso sin `WebhookDelivery` (idempotentes por efecto).
