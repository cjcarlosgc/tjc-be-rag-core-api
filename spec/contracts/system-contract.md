# Contrato canónico del sistema

**Versión del contrato:** SYSTEM-2.4
**Fecha de corte:** 2026-09-20
**Estado:** APROBADO salvo decisiones `PENDING` explícitas
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/system-contract.md`

Core y Console preparan la frontera de un cuarto componente durante `planningBaseline: 2026-09-24-core-console-transition`. Sandbox conserva por ahora la copia operativa SYSTEM-2.4 sin editarla. Una spec local no redefine rutas o DTOs; el nuevo contrato de servicio se aprobará y versionará antes de extraer código.

## Arquitectura operativa vigente y transición aprobada

RAG Test Studio adopta un flujo PR-driven. La unidad operativa principal es un `CHANGESET` asociado al HEAD de un Pull Request, no una selección manual `METHOD|CLASS|PROJECT` iniciada obligatoriamente desde la Console.

```text
developer and/or coding agent
  -> feature branch
  -> Pull Request hacia integrationBranch
  -> GitHub App
  -> RAG Core
  -> AnalysisRun + Job
  -> contexto semántico + estructural + funcional + tests existentes
  -> Sandbox
  -> clasificación objetiva
  -> GitHub Check + Console
  -> revisión humana opcional de tests
  -> companion PR
```

- Developer Console es el control plane, workspace human-in-the-loop y superficie de revisión/trazabilidad. No es un launcher obligatorio.
- RAG Core todavía contiene GitHub Integration junto con dominio, RAG, Functional Knowledge, generación, jobs, orquestación, métricas y publicación. Se aprobó trasladar **toda** interacción GitHub, SDK incluido, a `tjc-be-github-integration-api`, repositorio hermano. Este traslado no es todavía un contrato HTTP desplegado: `WI-CORE-003` definirá llamadas, autenticación, idempotencia y ownership antes de mover código. Core conservará dominio, decisiones de análisis y orquestación; Console seguirá consumiendo Core para dominio.
- Test Execution Sandbox ejecuta perfiles aislados y devuelve hechos. Permanece ciego a GitHub, OAuth, usuarios, RAG, reglas funcionales, estrategia experimental y conclusiones de negocio.
- PostgreSQL + pgvector, Supabase Storage, jobs DB-backed y containers efímeros permanecen vigentes. No se incorporan Redis, RabbitMQ o Kafka sin una decisión posterior.

## Identidad de persona e integración GitHub

Son fronteras independientes:

1. **Login:** solo GitHub OAuth mediante Supabase Auth produce un `PlatformUser` (`DEC-ORG-001`, HU01/HU02; el correo y la contraseña se retiran). Google OAuth queda fuera de alcance.
2. **Automatización de repositorio:** una GitHub App administra instalaciones, repositorios autorizados, webhooks, Checks y, cuando se habilite, ramas/PR.

GitHub OAuth permite únicamente descubrir los repositorios visibles para la persona autenticada; no autoriza automatización, snapshots, Checks ni publicación. `PlatformUser`, `GitHubInstallation`, `GitHubRepository` y `GitHubActor` son conceptos independientes. No se implementa linking propio por coincidencia de correo; se admite únicamente el linking seguro que Supabase Auth aplique a identidades con correo verificado y configuración explícita. El actor de GitHub es metadata y no autoridad automática dentro de un Project.

Los permisos de la GitHub App aplican mínimo privilegio:

- metadata, contents y pull requests: read;
- checks: write;
- contents y pull requests: write solo al habilitar publicación;
- sin Actions/workflows ni permisos administrativos innecesarios.

## Onboarding y repository binding

Un usuario ya autenticado conecta un repositorio desde `Project -> Integrations -> GitHub`. La Console usa el token OAuth GitHub del usuario, transportado solo para ese descubrimiento, para listar repositorios visibles. Al seleccionar uno, Core se autentica como GitHub App y consulta directamente la instalación que tiene acceso al repositorio. La ausencia de acceso es `NOT_AUTHORIZED`, un resultado de producto que ofrece la URL de configuración centralizada de la App; no se enumeran instalaciones ni se infiere acceso desde OAuth.

El repositorio debe pertenecer al workspace del Project y el usuario debe tener permiso `maintain`/`write`/`admin` sobre él (`DEC-ORG-001`, HU02; ver "Workspaces, roles y acceso"). Después de que la App autorice el repositorio, Core lista las ramas con un installation access token y el usuario elige una rama existente. El binding durable pertenece al `Project`, no a quien lo configuró, y conserva Project, instalación resuelta por Core, repository id estable, nombre, `integrationBranch` explícita y estado enabled/disabled. No existe rama por defecto ni equivalencia entre nombres de ramas. Desconectar es una pausa reversible: deja el binding `DISABLED` (la fila y su `repositoryId` se conservan, por lo que el repositorio sigue reservado para ese Project), impide aceptar eventos nuevos y conserva Runs/evidencia según retención; el usuario lo reactiva sin volver a vincular. Un repositorio solo puede estar vinculado a un Project a la vez; intentar vincularlo a otro es un conflicto de producto (`REPOSITORY_ALREADY_BOUND`), no un error interno. Además de la desconexión manual, Core reacciona a los eventos de ciclo de vida de la GitHub App (`installation`/`installation_repositories`, HU14): desinstalar la App o retirar acceso a un repositorio puntual revoca el binding correspondiente; suspender/reanudar la instalación deshabilita/habilita sin perder el binding, salvo que ya esté `REVOKED`; reanudar solo rehabilita los bindings que la suspensión deshabilitó, nunca uno pausado por el usuario. Un binding `REVOKED` puede reactivarse explícitamente por el usuario solo si Core revalida que la App recuperó acceso al repositorio; sin acceso el estado no cambia.

Eliminar un `Project` (solo Admin) es un borrado lógico irreversible desde la API (sin restauración): el Project y todo lo que cuelga de él dejan de ser visibles, se libera su binding para que el repositorio pueda vincularse a otro Project, y los Runs y jobs en curso se cancelan u obsoletan. Runs, versiones y Functional Knowledge se conservan como evidencia, sin exposición por la API. Un webhook de un repositorio sin binding se ignora.

## Workspaces, roles y acceso

Consolida `DEC-ORG-001` (HU01/HU02); el detalle normativo de rutas, DTOs, errores y eventos vive en `INTEROP-2.4` §6.13 y §6.9.

- Un `Project` pertenece a un workspace: la cuenta personal de su creador o una organización de GitHub donde la GitHub App está instalada y el usuario es miembro. Un Project personal solo lo ve su creador, que es siempre su Admin y no tiene registro de acceso; solo se comparte mediante organizaciones. GitHub es la fuente de verdad de la autorización; Core solo persiste el vínculo `userId -> githubUserId`, la organización del Project y, para Projects de organización, un registro de acceso `(projectId, userId, rol, verifiedAt)`.
- Roles por Project, con jerarquía Admin ⊃ Maintainer ⊃ Reader (en una organización, Maintainer y Reader exigen además ser miembro activo de ella): Reader solo consulta; Maintainer opera el día a día (binding, preguntas funcionales, publicaciones, experimentos); Admin, además, crea, renombra y elimina Projects. La matriz rol -> operación de toda la superficie HTTP es `INTEROP-2.4` §6.13.
- El acceso se crea al entrar, verificando en vivo con el installation token de la App; se revoca por los eventos de webhook de la App y por una reconciliación horaria, nunca por caché ni por reinicio de sesión. Si GitHub no responde, Core conserva los accesos ya registrados y no concede accesos nuevos.
- Ninguna identidad implica autorización de la otra: ver un Project no autoriza automatización sobre el repositorio, que sigue autorizada solo por la GitHub App. Un recurso no visible responde el mismo `404` que uno inexistente; uno visible con rol insuficiente responde `403`.

## Trigger PR-driven y lifecycle

Solo se analiza automáticamente un PR cuyo `base` coincide positivamente con `Project.integrationBranch`. No existe trigger global por `push` ni workflow YAML obligatorio.

Crean o reinician análisis:

- `pull_request:opened` si no es draft;
- `pull_request:reopened` si está ready;
- `pull_request:ready_for_review`;
- `pull_request:synchronize`.

También se procesan `closed`, `edited` y `converted_to_draft` para mantener lifecycle:

- draft no inicia análisis completo; ready crea el primer Run;
- cambio de base fuera de `integrationBranch` desactiva el PR; entrada hacia la rama configurada crea Run para el HEAD vigente si está ready;
- force-push equivale a `synchronize`;
- nuevo HEAD marca el Run anterior `OBSOLETE` y crea otro;
- cierre sin merge cancela/obsoleta trabajo no terminal sin borrar historial;
- merge cierra el lifecycle y resultados tardíos no pueden publicarse como vigentes.

Fork PR se distingue de same-repository PR. Su publicación queda fuera del primer incremento hasta resolver permisos de escritura específicos.

## AnalysisRun, Job y Check

Un `AnalysisRun` valida un HEAD concreto de un PR concreto. Su identidad conceptual incluye Project, Repository, PR number, base SHA, head SHA, delivery/event y timestamps. Para un mismo Project/Repository/PR/HEAD existe una única identidad lógica vigente.

Un Run no es un Job/Attempt. Reintentos técnicos y continuaciones pertenecen al mismo Run mientras el HEAD no cambie. `ACTION_REQUIRED` termina el job actual; una respuesta válida crea un continuation job sobre el mismo Run si el HEAD sigue vigente. Eventos duplicados se deduplican mediante delivery id más repository/PR/head/event/action.

Core conserva un historial append-only de transiciones de status por Run (estado previo, estado nuevo, motivo, timestamp; HU12) para que un usuario autorizado entienda cómo llegó a su estado actual sin inferirlo de los timestamps sueltos; complementa esos timestamps, no los reemplaza.

Todo Check pertenece al SHA del Run. Un resultado viejo nunca sobrescribe el Check del HEAD vigente. Core publica conclusión objetiva (`success|failure|action_required|neutral`); la configuración del repositorio decide si el Check es required.

## CHANGESET, INDEX DELTA y símbolos

- `PR CHANGESET = PR base SHA <-> current HEAD SHA`: qué se valida.
- `INDEX DELTA = previous indexed HEAD <-> current HEAD`: qué se reindexa.

El primer análisis realiza bootstrap del snapshot suficiente. Los siguientes actualizan artefactos cambiados/invalidados sin reindexar todo innecesariamente. Los Runs concurrentes quedan aislados por repository/PR/HEAD.

El análisis produce símbolos `DIRECTLY_CHANGED` y `POTENTIALLY_IMPACTED`. TypeScript reconoce class, method, function, interface, type y enum; PHP reconoce class, method, function, interface, trait y enum. PR grandes se filtran, priorizan y pueden dividirse en batches sin fijar thresholds en este corte.

## Contexto RAG y Functional Knowledge

El Context Builder construye trazablemente:

```text
TARGET
+ SEMANTIC CODE CONTEXT
+ STRUCTURAL CODE CONTEXT
+ FUNCTIONAL CONTEXT
+ EXISTING TEST CONTEXT
```

`FunctionalKnowledge` es conocimiento funcional persistente y específico del Project. Core conserva pregunta/respuesta originales, regla normalizada, scope (`PROJECT|MODULE|CLASS|METHOD|SYMBOL`), referencia, fuente, estado (`ACTIVE|SUPERSEDED`), validez/versión, timestamp y embedding cuando corresponda.

- Una regla no se sobrescribe silenciosamente: la anterior pasa a `SUPERSEDED` y la nueva a `ACTIVE`.
- Antes de persistir una regla nueva, Core detecta si contradice una regla `ACTIVE` vigente en scope compatible y expone el conflicto para decisión humana explícita (`SUPERSEDE` o mantener la vigente) antes de contaminar el conocimiento persistido (HU09); no se resuelve automáticamente.
- `No lo sé` puede registrarse como evidencia de pregunta, pero no crea una regla autoritativa `ACTIVE`.
- Si falta conocimiento relevante, el Run pasa a `ACTION_REQUIRED`, no `ERROR`; el job termina y no deja runners esperando.
- Si una regla vigente contradice un cambio, Core solicita decisión humana o clasifica con evidencia; no concluye automáticamente que el código está mal.
- La Console ofrece Focus Mode de página completa con Project/repo/PR/commit/target, pregunta, motivo, respuesta, ayuda visual técnica opcional y preguntas adaptativas; no muestra un total fijo.
- La navegación incluye una bandeja `Action Required`; el Check enlaza al Run concreto. Tras login, `returnTo` conserva el deep link original.
- Responde un usuario con rol Maintainer o Admin sobre el Project; el autor del PR no obtiene autoridad por ser autor.

## Baseline, generación y clasificación

Antes de atribuir una falla a pruebas generadas, se ejecuta el baseline relevante de tests existentes.

- baseline rojo -> `BASELINE_FAILED`;
- cambio sin impacto de tests -> `NO_TEST_RELEVANT_CHANGES`;
- tests existentes suficientes -> `NO_ADDITIONAL_TESTS_REQUIRED`;
- test generado técnicamente válido que evidencia discrepancia -> `BEHAVIORAL_MISMATCH`;
- namespace/import/API/mock/setup/sintaxis inválidos generados -> `TECHNICAL_GENERATION_FAILURE`;
- Docker/red/storage/worker/runtime de plataforma -> `INFRASTRUCTURE_FAILURE`;
- validación correcta -> `SUCCESS`.

No se generan duplicados para demostrar actividad. La autorreparación semántica y la modificación automática de código productivo permanecen prohibidas. El experimento conserva `RAG` vs `GENERALIST_AGENT`; si se incorpora Functional Knowledge, la metodología debe resolver cómo mantener comparabilidad antes de ejecutar evidencia experimental. La unidad experimental (HU17) es un símbolo `METHOD`/`FUNCTION` `DIRECTLY_CHANGED` de un `AnalysisRun` existente, no una selección manual de `TestTarget`.

## Publicación human-in-the-loop

Tras `SUCCESS`, un usuario autorizado revisa tests, target, reglas funcionales, contexto y evidencia. Antes de publicar, Core verifica que el HEAD actual coincida con el HEAD validado; de lo contrario la propuesta queda `STALE`.

La publicación crea una rama equivalente a `rag-tests/pr-<number>-<short-sha>` desde el HEAD validado y un companion PR hacia la feature branch, nunca directamente hacia `develop`. Solo contiene tests/artefactos permitidos, no se auto-mergea y no se crea mientras exista `BEHAVIORAL_MISMATCH`. Si se cierra/rechaza, no se reabre automáticamente. Al mergearse modifica la feature branch y el PR original genera `synchronize`; como su base no es `integrationBranch`, el companion PR no recursa en el pipeline principal.

## Estrategia de stacks

- TypeScript + Jest/Vitest: compatibilidad mantenida; solo bugs, compatibilidad y refactors necesarios para adapters.
- PHP + Laravel + PHPUnit: foco activo de nuevo desarrollo.

Core evoluciona mediante adapters de lenguaje y framework de tests, sin dispersar condicionales por stack. PHP cubre filtering, parsing, símbolos, relaciones, chunking, targets, contexto, generación y descubrimiento de tests. Composer usa `composer.json` y `composer.lock` cuando existe.

Sandbox conserva `NODE_TYPESCRIPT` y agrega realmente `PHP_LARAVEL_PHPUNIT` con PHP, Composer, dependencias Laravel, PHPUnit y container aislado. No se fija una única versión de PHP/Laravel hasta revisar repositorios reales. El Sandbox recibe un execution profile explícito y devuelve evidencia normalizada, sin interpretar comportamiento.

## Estados conceptuales

El dominio debe representar sin duplicados innecesarios:

```text
QUEUED
PROCESSING
ACTION_REQUIRED
SUCCESS
BEHAVIORAL_MISMATCH
TECHNICAL_GENERATION_FAILURE
INFRASTRUCTURE_FAILURE
BASELINE_FAILED
NO_ADDITIONAL_TESTS_REQUIRED
NO_TEST_RELEVANT_CHANGES
OBSOLETE
```

## Demo y alcance

- El análisis productivo nace de un `AnalysisRun` asociado a PR/HEAD. El snapshot ZIP que recupera Docker/Sandbox es un detalle interno, no una entrada manual de proyecto.
- La comparación `RAG` vs `GENERALIST_AGENT` de HU17 usa un `AnalysisRun` y un símbolo elegible compartidos; su adaptación live sigue pendiente de aceptación.
- Los mocks frontend implementan `INTEROP-2.4`, están señalizados como demo y permanecen detrás de adapters separados de live. No son evidencia científica ni empresarial.

## Decisiones compartidas

### DEC-GH-001 — Integración PR-driven mediante GitHub App

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** GitHub App, binding Project<->Repository, eventos PR-driven, webhooks, Checks API, mínimo privilegio, human-in-the-loop y companion PR aprobado por humano. No se requiere workflow YAML. GitHub OAuth mediante Supabase Auth sirve para identidad y, con un provider token efímero, para descubrir repositorios visibles; la App sigue siendo la única autoridad de automatización.

### DEC-WEB-AUTH-001 — Identidad del navegador

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** Supabase Auth admite únicamente GitHub OAuth (el correo y la contraseña se retiraron por `DEC-ORG-001`, HU01/HU02). Core valida el access token y autoriza por Project. Login e instalación GitHub App son independientes; Google OAuth y linking propio por correo quedan fuera de alcance.

### DEC-INT-001 — Contrato Core<->Sandbox

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** `INTEROP-2.2` conserva HTTP asíncrono, Bearer de servicio, idempotencia y referencias efímeras; agrega execution profiles y evidencia neutral para Node/TypeScript y PHP/Laravel/PHPUnit.

### DEC-AUTH-001 — Autenticación Core<->Sandbox

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** secreto opaco precompartido `SANDBOX_SERVICE_TOKEN`; no es JWT, no llega a la Console ni al container.

### DEC-IDEMP-001 — Idempotencia

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** keys durables y jobs DB-backed existentes se adaptan al lifecycle PR/HEAD. GitHub deliveries y continuaciones tienen identidades estables.

### DEC-INF-001 — Infraestructura remota del Sandbox

**Estado:** PENDING

**Blocks:** aprovisionamiento remoto; no bloquea desarrollo ni prevalidación local.

**Pregunta:** seleccionar proveedor y controles de VM remota sin resolver silenciosamente costo, aislamiento, red o retención.

### DEC-VAL-001 — Validación empresarial

**Estado:** PENDING

**Blocks:** ingestión/despliegue con código empresarial y producción de evidencia empresarial; no bloquea trabajo con código de demostración autorizado.

**Pregunta:** aprobar autorización organizacional, retención, proveedores externos, protección de código y exportación de evidencia.

### DEC-ORG-001 — Organizaciones y compartición de Projects

**Estado:** APROBADO (2026-09-20, por el usuario)

**Blocks:** NONE. No cierra `DEC-VAL-001`. Modifica `DEC-WEB-AUTH-001`: el login pasa a ser solo GitHub (HU01/HU02). Lo no probado contra una organización real es criterio de aceptación de los cortes que lo usan y **condición para desplegar**, no para implementar (ver "Precondiciones de despliegue").

**Resolución:** GitHub es la fuente de verdad de la autorización y Core persiste solo lo necesario para poder revocar por evento.

- **Workspaces:** el home ofrece la cuenta personal (siempre) y cada organización donde la GitHub App está instalada y el usuario es miembro; Core la obtiene listando las instalaciones de la App y verificando la membresía con el token de la App, sin depender del token del usuario ni del scope `read:org`. Una organización aparece cuando alguien instala la App en ella. El "equipo" es la organización; los Teams de GitHub no son workspace y solo aportan permisos de forma indirecta. Un Project guarda su organización (`githubOrgId`, `login`; nulo = personal) porque al crearse aún no tiene repositorio.
- **Login:** solo GitHub (HU01/HU02). La identidad se resuelve por el `githubUserId` numérico que Core obtiene de la Admin API de Supabase con el `sub` del token; nunca de `user_metadata`, que el propio usuario puede editar.
- **Roles (jerarquía Admin ⊃ Maintainer ⊃ Reader):** Admin es solo el owner de la organización (en el workspace personal, quien lo creó) y es además Maintainer; solo Admin crea, renombra y elimina Projects (el borrado sigue siendo lógico). Maintainer es quien tiene permiso `maintain`, `write` o `admin` sobre el repositorio vinculado; opera el día a día (binding, preguntas funcionales, publicación, experimentos). Reader es quien tiene `triage` o `read`: solo consulta.
- **Visibilidad:** en una organización se ve un Project si se tiene al menos `read` sobre su repositorio vinculado. Un Project sin repositorio solo lo ven los Admin (todos los owners de la organización). Un Project personal solo lo ve su creador. Un recurso no visible responde el mismo `404` que uno inexistente. *Enmienda 2026-09-20 (`DEC-ORG-002`): la versión aprobada decía "también en el workspace personal"; los Projects personales no se comparten con colaboradores, solo se comparte mediante organizaciones, y el registro de acceso existe únicamente para Projects de organización.*
- **Binding:** un Project tiene un solo repositorio y no se revincula (para otro repositorio se elimina el Project y se crea otro). En una organización solo se ofrecen y aceptan repositorios de esa organización; en el workspace personal, solo los propios. Vincular exige permiso `maintain`/`write` (o `admin`) sobre el repositorio, porque la GitHub App publica con permisos de escritura. Vincular, pausar y reactivar lo hacen Admin y Maintainer; como el Project sin repositorio solo lo ven los Admin, el primer vínculo es de un Admin. Un renombre del repositorio actualiza el nombre; una transferencia a otra organización o su eliminación pasa el binding a `REVOKED` sin borrar evidencia.
- **Alta y revocación:** el acceso se crea automáticamente al entrar, verificando en vivo el rol o permiso del usuario con el installation token de la App; nadie invita. La revocación no usa caché ni depende del inicio de sesión: los webhooks de la App en el ingress existente (§6.9) actualizan o borran el registro de acceso, y un job periódico de reconciliación, cada hora, sobre la cola existente corrige webhooks perdidos. Si GitHub no responde, Core conserva los accesos ya registrados (nunca revoca por un error de red), reintenta después y no concede accesos nuevos hasta poder verificarlos.
- **Ciclo de vida de la organización:** si la organización desaparece o se desinstala la App (una organización de GitHub no puede quedarse sin owners: una lista de owners vacía se trata como no verificable y no oculta nada), sus Projects y su evidencia se conservan pero dejan de verse (binding `REVOKED`); reaparecen si la App se reinstala o la organización vuelve. No se reasignan a otro workspace.
- **Persistencia mínima:** el vínculo `userId -> githubUserId`, las columnas de organización en `Project` y un registro de acceso `(projectId, userId, rol, verifiedAt)`. No hay tablas `Organization` ni `Membership`.
- Se conserva el invariante de que ninguna identidad implica autorización de la otra: ver un Project no autoriza la automatización sobre el repositorio, que sigue autorizada solo por la GitHub App.

**Decisiones de producto cerradas (2026-09-20):** origen de la lista de workspaces (organizaciones con la App instalada), reconciliación cada hora, comportamiento ante una caída de GitHub (conservar lo existente, negar lo nuevo) y ciclo de vida de una organización que desaparece (Projects ocultos y conservados). Límite aceptado: solo se comparte con quien tiene acceso al repositorio en GitHub.

**Verificaciones técnicas contra GitHub (spike 2026-09-20):**
- **Permiso de un colaborador (PROBADO):** el installation token lee `GET /repos/{owner}/{repo}/collaborators/{username}/permission` con solo `Metadata: read`, permiso que la App ya tiene. Se usa `role_name` (admin, maintain, write, triage, read o rol personalizado); el campo `permission` colapsa maintain a write y triage a read. Un rol personalizado se mapea por su permiso base. No se probó un colaborador que no sea owner ni el permiso heredado por Team o permiso base de la organización.
- **Rol en la organización (DOCUMENTADO, no probado):** `GET /orgs/{org}/memberships/{username}` (`role` admin = owner; solo cuenta `state=active`) y `GET /orgs/{org}/members` exigen el permiso de organización `Members: read`, que la App no tiene hoy. No se probó contra una organización real porque la única instalación de la App es de una cuenta personal.
- **Permisos y eventos nuevos de la App:** `Members: read` (lo acepta un owner en cada organización) y suscripción a `member`, `membership`, `organization`, `team` y `repository`. `installation` e `installation_repositories` llegan siempre; `Metadata: read` ya cubre `repository`. Hoy la App solo se suscribe a `pull_request`.
- **Cobertura de eventos (DOCUMENTADO):** cubiertos los cambios de colaborador directo (`member`), alta y baja de miembro de la organización (`organization`), membresía y permisos de Team sobre un repositorio (`membership`, `team`, con la salvedad de que un cambio de permiso del Team no está garantizado) y renombre, transferencia, eliminación o privatización del repositorio (`repository`). **Sin evento fiable:** cambio de rol en la organización, cambio del permiso base de la organización y accesos heredados que cambian sin evento directo. Para esos casos la reconciliación horaria es el único mecanismo, con una ventana de hasta una hora.
- **Identidad (PROBADO):** la Admin API de Supabase `GET /auth/v1/admin/users/{sub}` devuelve `identities[]`; el listado `GET /admin/users` devuelve `identities: null`, así que se debe consultar por id. El `githubUserId` numérico es `identities[].id` (igual a `identity_data.provider_id` y `identity_data.sub`), nunca `user_metadata`.
- **Prerrequisito de despliegue (decidido 2026-09-20):** la App es hoy privada (`GET /apps/{slug}` sin autenticación responde `404`) y solo puede instalarse en la cuenta de su dueño, sin ninguna instalación de organización; eso impide también el workspace personal de cualquier otro usuario. Se decide hacerla **pública ("Any account") sin listing en Marketplace**, cambio externo en la configuración de la App que realiza el usuario. Además cada organización debe aceptar `Members: read`. Una lista de cuentas permitidas en Core queda como mejora futura fuera de esta decisión.
- Los códigos de error nuevos se nombran al consolidar el contrato en INTEROP.

**Precondiciones de despliegue** (ninguna bloquea implementar ni probar con fakes):
1. La GitHub App es pública ("Any account"), sin listing en Marketplace, y tiene `Members: read` y los eventos `member`, `membership`, `organization`, `team` y `repository` suscritos; cada organización acepta el permiso.
2. Se validan contra una organización real, con la App instalada, las lecturas aún no probadas: rol de owner (`memberships`), permiso heredado por Team o permiso base, y membresía `pending`.
3. El proveedor de correo y contraseña de Supabase Auth se deshabilita cuando la Console solo ofrezca GitHub.

*Precisión de despliegue (`DEC-ORG-002`, 2026-09-20/21):* (a) orden: primero la Console solo GitHub, luego el bundle A de Core (identidad y corrección de seguridad del binding, que exige identidad GitHub en toda la sesión) y solo después el bundle B (workspaces, roles, acceso y webhooks, junto); la App no debe ser instalada por terceros (idealmente privada) hasta desplegar el bundle A; (b) la condición 2 incluye validar que un colaborador externo (no miembro) con permiso sobre el repositorio no accede al Project.

### DEC-ORG-002 — Casos borde de acceso derivados de DEC-ORG-001

**Estado:** APROBADO (2026-09-20, por el usuario)

**Blocks:** NONE. No cierra `DEC-VAL-001`. El punto 1 precisa la definición de Maintainer y Reader de `DEC-ORG-001` y el punto 2 enmienda su visibilidad en el workspace personal.

**Resolución:**

1. **Membresía activa siempre en una organización** (precisado por el usuario, 2026-09-21): en un Project de organización se exige SIEMPRE ser miembro activo de la organización además del permiso sobre el repositorio vinculado (`read`/`triage` para Reader; `maintain`/`write`/`admin` para Maintainer), sea el repositorio privado, internal o público. Un colaborador externo (no miembro) no accede al Project aunque tenga `write`. El `read` implícito de un repositorio público no cuenta como acceso. En el workspace personal no aplica (punto 2).
2. **Projects personales:** no se comparten con colaboradores; solo se comparte mediante organizaciones. Un Project personal lo ve únicamente su creador, que es siempre su Admin. No existe "compartido conmigo", ni acceso de colaboradores por enlace, ni registro de acceso para Projects personales: `project_access` existe solo para Projects de organización. `GET /projects` nunca devuelve Projects personales de otra persona. Corrige la viñeta "Visibilidad" de `DEC-ORG-001`.
3. **Binding `REVOKED`:** sin acceso de la App al repositorio no hay permiso verificable, por lo que solo los Admin ven el Project (para reactivar el binding con `POST .../enable` o eliminarlo); Maintainer y Reader lo recuperan cuando el binding se reactiva. Si la organización desaparece, se desinstala la App o queda sin owners, el Project queda oculto para todos y se conserva (`DEC-ORG-001`, "Ciclo de vida de la organización").
4. **Superficie de repositorios a nivel de usuario:** `POST /integrations/github/repositories/verify-app-access` y `GET /integrations/github/repositories/{owner}/{repo}/branches` exigen permiso `maintain`, `write` o `admin` sobre el repositorio consultado. Con permiso menor: `403 REPOSITORY_PERMISSION_INSUFFICIENT`; sin visibilidad: `404 GITHUB_REPOSITORY_NOT_FOUND` en `branches` y `NOT_AUTHORIZED` en `verify-app-access`. Es una corrección de seguridad del contrato anterior, que respondía sobre cualquier repositorio al que la App tuviera acceso.
5. **La corrección de seguridad va primero** (precisado por el usuario, 2026-09-21): el punto 4 y la validación de propietario y permiso del binding se implementan y publican justo después de la identidad GitHub, antes de workspaces, roles y webhooks (`spec/features/014-organizations-access/`, corte 4a). Precondición de despliegue añadida: la GitHub App no debe ser instalada por terceros (idealmente privada) hasta que esa corrección esté desplegada (bundle A).

**Decisiones derivadas** (tomadas por el analista al consolidar `INTEROP-2.4` y por el leader al corregir la revisión de contrato; no vienen de `DEC-ORG-001` y el usuario puede vetarlas):

- (a) Nombres públicos: `GET /workspaces`, `PATCH /projects/{projectId}` y el parámetro `workspaceId` (el id numérico de GitHub de la cuenta u organización, como texto; omitido = personal).
- (b) Rol de workspace `ADMIN`|`MEMBER` (`ADMIN` = cuenta personal u owner activo de la organización).
- (c) HTTP de los códigos nuevos: `GITHUB_IDENTITY_REQUIRED` 401, `IDENTITY_UNAVAILABLE` 503, `WORKSPACE_NOT_FOUND` 404, `WORKSPACE_ADMIN_REQUIRED` 403, `PROJECT_ROLE_INSUFFICIENT` 403 (`details: { requiredRole, currentRole }`), `REPOSITORY_OUTSIDE_WORKSPACE` 400, `REPOSITORY_PERMISSION_INSUFFICIENT` 403 y `GITHUB_VERIFICATION_UNAVAILABLE` 503.
- (d) En `POST .../integrations/github`, "sin ningún permiso del usuario sobre el repositorio" colapsa en el paso `404 GITHUB_REPOSITORY_NOT_FOUND` y va antes de `REPOSITORY_OUTSIDE_WORKSPACE`; `branches` sin visibilidad responde el mismo `404`. Se acepta la diferencia residual entre `403 GITHUB_APP_ACCESS_REQUIRED` (App no instalada) y `404` (instalada, sin permiso del usuario).
- (e) Las validaciones de propietario y de permiso van antes de `REPOSITORY_ALREADY_BOUND`, para que nadie sondee qué repositorios ajenos están vinculados.
- (f) Con GitHub caído: `GET /workspaces` devuelve el workspace personal más las organizaciones con acceso ya registrado; los listados omiten lo no verificable; un acceso directo a un Project de organización no verificable responde `503` (revela solo la existencia de un UUID). Los Projects personales no dependen de GitHub para verse.
- (g) `installation.suspend` no borra registros de acceso: una instalación suspendida se trata como GitHub no disponible.
- (h) Los eventos de acceso se procesan aunque el binding no esté `ENABLED`.
- (i) El payload de un webhook solo selecciona qué reverificar; el rol siempre sale de una verificación viva con el installation token.
- (j) No existe ruta que dispare una validación manual, así que "validación" del rol Maintainer queda como nota de la matriz de `INTEROP-2.4` §6.13.
- (k) Un permiso o una pertenencia no verificable en `verify-app-access`, `branches` y `GET /integrations/github/repositories?workspaceId` responde `503 GITHUB_VERIFICATION_UNAVAILABLE`, nunca `NOT_AUTHORIZED` ni `404`.
- (l) `GET /analysis-runs` y `GET /action-required` sin `projectId` cubren los Projects personales del usuario más los de organización con registro de acceso ya existente. `GET /action-required?projectId=X` con un Project no visible responde `404 PROJECT_NOT_FOUND` (cambio observable: antes una página vacía).
- (m) Un alta de acceso no puede sobrescribir una revocación posterior al inicio de su verificación; las verificaciones contra GitHub tienen tope de concurrencia y presupuesto por petición y no memoizan denegaciones (sin caché, a petición del usuario). Se acepta por escrito el riesgo residual: un límite de tasa de GitHub degrada las altas nuevas a `503` u omitidas, nunca revoca lo existente.
- (n) La reconciliación horaria también revalida propietario y nombre del repositorio vinculado (transferido o eliminado: binding `REVOKED`; renombrado: actualiza el nombre).
- (o) Default-deny obligatorio: una ruta autenticada sin rol mínimo ni excepción explícita falla el guard y una prueba que enumera el router.
- (p) WebSocket: mapa socket -> Project; se expulsa también por borrado lógico y por pérdida de visibilidad (binding `REVOKED` para no Admin); una suscripción cuya verificación no está disponible se rechaza con un motivo reintentable (`INTEROP-2.4` §6.6).
- (q) El manual linking de identidades de Supabase permanece deshabilitado; `AUTH_BYPASS` de desarrollo aporta una identidad GitHub sintética y nunca se activa en producción.
- (r) Un Reader no debe llamar `verify-app-access` (`403`); consulta el estado del binding con `GET .../integrations/github`.
- (s) Jobs de acceso: `jobs` no tiene columna de alcance, así que se añade `dedupeKey` (texto, nullable) y un índice único parcial que cubre SOLO filas `PENDING` con `dedupeKey` no nulo (no `RUNNING`), para `ACCESS_RECONCILIATION` y `ACCESS_REVERIFY`. La siguiente ocurrencia de la reconciliación se autoencola al inicio sin chocar con la fila `RUNNING`, y un evento que llega durante un `ACCESS_REVERIFY` en ejecución encola uno nuevo que corre después (el reclamo no toma un `PENDING` cuya `dedupeKey` coincide con una fila `RUNNING` no obsoleta). La siembra al arrancar solo omite si existe un `PENDING` o un `RUNNING` no obsoleto.
- (t) El advisory lock transaccional por `(projectId, userId)` es el único mecanismo contra la carrera alta/revocación; reverificaciones y revocaciones toman el mismo lock. Retiene una conexión durante las llamadas a GitHub, acotado por el presupuesto de verificaciones.
- (u) El predicado de acceso de un Project de organización es "registro de acceso suficiente Y (binding no `REVOKED` o rol `ADMIN`)", evaluado en cada petición, con prueba.
- (v) `POST .../enable` sobre un binding `REVOKED` aplica la misma validación de propietario y de `repositoryId` que `POST .../integrations/github` (`404 GITHUB_REPOSITORY_NOT_FOUND`, `400 REPOSITORY_OUTSIDE_WORKSPACE`); no se permite reactivar sin comparar el `repositoryId` persistido.
- (w) Alcance de la reconciliación: la revalidación del repositorio (propietario, nombre) cubre todo Project vivo con binding, personales incluidos; la recalculación de registros cubre los Projects con registros de acceso. Al pasar un binding a `REVOKED` se borran los registros Maintainer y Reader.
- (x) `SubscribeAck` con tres resultados fijos y comportamiento del handshake WebSocket ante `GITHUB_IDENTITY_REQUIRED`, `IDENTITY_UNAVAILABLE` e `INVALID_ACCESS_TOKEN` (`INTEROP-2.4` §6.6); es aditivo y la Console, que emite `subscribe` sin callback, lo ignora.
- (y) La Console envía `workspaceId` a `POST /projects` y `GET /projects` y consume `workspace`/`role` solo después del sync de implementación del bundle B; el bundle A solo acepta `workspaceId` (personal) en el discovery. El bundle A espera a la Console solo-GitHub publicada.
- (z) Una App desinstalada de la organización se distingue de un resultado no verificable: la organización deja de ofrecerse y sus Projects responden `404` (no `503`). Un `branches` con la App no instalada en el repositorio responde `403 GITHUB_APP_ACCESS_REQUIRED` antes que los `404`/`403` de permiso; `verify-app-access`, `NOT_AUTHORIZED`.
- (aa) Una lista de owners de organización VACÍA con HTTP 200 se trata como no verificable, no como "sin owners": una organización de GitHub no puede tener cero owners y una lista vacía es casi siempre un artefacto de visibilidad (p. ej. solo miembros públicos). Se conserva todo y se reintenta; solo se oculta con confirmación de GitHub (organización inexistente, App desinstalada, `organization.deleted` o `installation.deleted`). Decidida por el leader al corregir la revisión del bundle B (2026-09-21).
- (ab) Un listado de GitHub usado para NEGAR (instalaciones de la App, owners) que alcanza el tope de páginas se trata como no verificable, no como completo (2026-09-21).
- (ac) Un fallo determinista al reverificar un acceso sigue el camino normal de reintentos hasta `FAILED`; solo lo no verificable se reprograma con espera creciente sin consumir intentos (2026-09-21).

### DEC-EXP-FK-001 — Paridad experimental del contexto funcional

**Estado:** PENDING

**Blocks:** ejecución experimental que incorpore Functional Knowledge; no bloquea el producto operativo ni experimentos sin esa fuente.

**Pregunta:** definir si ambos brazos reciben la misma información funcional para aislar la variable de adquisición/construcción de contexto.

## Regla de compatibilidad

`SYSTEM-2.4` sigue definiendo el contrato operativo PR/HEAD de tres componentes mientras se prepara GitHub Integration. La transición de cuatro componentes no se presenta como desplegada: sus DTOs y transporte se definirán en un corte contractual propio. La carga manual ZIP y los modos manuales no son rutas de producto; el ZIP interno de snapshot para Docker/Sandbox continúa. El estado de implementación o despliegue de cada capacidad se demuestra con evidencia por componente, no se infiere del número de contrato.
