# Contrato canónico del sistema

**Versión del contrato:** SYSTEM-2.3
**Fecha de corte:** 2026-09-20
**Estado:** APROBADO salvo decisiones `PENDING` explícitas
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/system-contract.md`

Developer Console y Test Execution Sandbox conservan una copia espejo byte por byte. Una spec local puede detallar la implementación de su componente, pero no redefinir este contrato.

## Arquitectura objetivo

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
- RAG Core contiene inicialmente GitHub Integration, dominio, RAG, Functional Knowledge, generación, jobs, orquestación, métricas y publicación de resultados. No se crea un cuarto microservicio por defecto.
- Test Execution Sandbox ejecuta perfiles aislados y devuelve hechos. Permanece ciego a GitHub, OAuth, usuarios, RAG, reglas funcionales, estrategia experimental y conclusiones de negocio.
- PostgreSQL + pgvector, Supabase Storage, jobs DB-backed y containers efímeros permanecen vigentes. No se incorporan Redis, RabbitMQ o Kafka sin una decisión posterior.

## Identidad de persona e integración GitHub

Son fronteras independientes:

1. **Login:** solo GitHub OAuth mediante Supabase Auth produce un `PlatformUser` (`DEC-ORG-001`, HU62; el correo y la contraseña se retiran). Google OAuth queda fuera de alcance.
2. **Automatización de repositorio:** una GitHub App administra instalaciones, repositorios autorizados, webhooks, Checks y, cuando se habilite, ramas/PR.

GitHub OAuth permite únicamente descubrir los repositorios visibles para la persona autenticada; no autoriza automatización, snapshots, Checks ni publicación. `PlatformUser`, `GitHubInstallation`, `GitHubRepository` y `GitHubActor` son conceptos independientes. No se implementa linking propio por coincidencia de correo; se admite únicamente el linking seguro que Supabase Auth aplique a identidades con correo verificado y configuración explícita. El actor de GitHub es metadata y no autoridad automática dentro de un Project.

Los permisos de la GitHub App aplican mínimo privilegio:

- metadata, contents y pull requests: read;
- checks: write;
- contents y pull requests: write solo al habilitar publicación;
- sin Actions/workflows ni permisos administrativos innecesarios.

## Onboarding y repository binding

Un usuario ya autenticado conecta un repositorio desde `Project -> Integrations -> GitHub`. La Console usa el token OAuth GitHub del usuario, transportado solo para ese descubrimiento, para listar repositorios visibles. Al seleccionar uno, Core se autentica como GitHub App y consulta directamente la instalación que tiene acceso al repositorio. La ausencia de acceso es `NOT_AUTHORIZED`, un resultado de producto que ofrece la URL de configuración centralizada de la App; no se enumeran instalaciones ni se infiere acceso desde OAuth.

Después de que la App autorice el repositorio, Core lista las ramas con un installation access token y el usuario elige una rama existente. El binding durable pertenece al `Project`, no a quien lo configuró, y conserva Project, instalación resuelta por Core, repository id estable, nombre, `integrationBranch` explícita y estado enabled/disabled. No existe rama por defecto ni equivalencia entre nombres de ramas. Desconectar es una pausa reversible: deja el binding `DISABLED` (la fila y su `repositoryId` se conservan, por lo que el repositorio sigue reservado para ese Project), impide aceptar eventos nuevos y conserva Runs/evidencia según retención; el usuario lo reactiva sin volver a vincular. Un repositorio solo puede estar vinculado a un Project a la vez; intentar vincularlo a otro es un conflicto de producto (`REPOSITORY_ALREADY_BOUND`), no un error interno. Además de la desconexión manual, Core reacciona a los eventos de ciclo de vida de la GitHub App (`installation`/`installation_repositories`, HU31): desinstalar la App o retirar acceso a un repositorio puntual revoca el binding correspondiente; suspender/reanudar la instalación deshabilita/habilita sin perder el binding, salvo que ya esté `REVOKED`; reanudar solo rehabilita los bindings que la suspensión deshabilitó, nunca uno pausado por el usuario. Un binding `REVOKED` puede reactivarse explícitamente por el usuario solo si Core revalida que la App recuperó acceso al repositorio; sin acceso el estado no cambia.

Eliminar un `Project` es un borrado lógico irreversible desde la API (sin restauración): el Project y todo lo que cuelga de él dejan de ser visibles, se libera su binding para que el repositorio pueda vincularse a otro Project, y los Runs y jobs en curso se cancelan u obsoletan. Runs, versiones y Functional Knowledge se conservan como evidencia, sin exposición por la API. Un webhook de un repositorio sin binding se ignora.

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

Core conserva un historial append-only de transiciones de status por Run (estado previo, estado nuevo, motivo, timestamp; HU53) para que un usuario autorizado entienda cómo llegó a su estado actual sin inferirlo de los timestamps sueltos; complementa esos timestamps, no los reemplaza.

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
- Antes de persistir una regla nueva, Core detecta si contradice una regla `ACTIVE` vigente en scope compatible y expone el conflicto para decisión humana explícita (`SUPERSEDE` o mantener la vigente) antes de contaminar el conocimiento persistido (HU51); no se resuelve automáticamente.
- `No lo sé` puede registrarse como evidencia de pregunta, pero no crea una regla autoritativa `ACTIVE`.
- Si falta conocimiento relevante, el Run pasa a `ACTION_REQUIRED`, no `ERROR`; el job termina y no deja runners esperando.
- Si una regla vigente contradice un cambio, Core solicita decisión humana o clasifica con evidencia; no concluye automáticamente que el código está mal.
- La Console ofrece Focus Mode de página completa con Project/repo/PR/commit/target, pregunta, motivo, respuesta, ayuda visual técnica opcional y preguntas adaptativas; no muestra un total fijo.
- La navegación incluye una bandeja `Action Required`; el Check enlaza al Run concreto. Tras login, `returnTo` conserva el deep link original.
- Responde un usuario autorizado por el Project; el autor del PR no obtiene autoridad por ser autor.

## Baseline, generación y clasificación

Antes de atribuir una falla a pruebas generadas, se ejecuta el baseline relevante de tests existentes.

- baseline rojo -> `BASELINE_FAILED`;
- cambio sin impacto de tests -> `NO_TEST_RELEVANT_CHANGES`;
- tests existentes suficientes -> `NO_ADDITIONAL_TESTS_REQUIRED`;
- test generado técnicamente válido que evidencia discrepancia -> `BEHAVIORAL_MISMATCH`;
- namespace/import/API/mock/setup/sintaxis inválidos generados -> `TECHNICAL_GENERATION_FAILURE`;
- Docker/red/storage/worker/runtime de plataforma -> `INFRASTRUCTURE_FAILURE`;
- validación correcta -> `SUCCESS`.

No se generan duplicados para demostrar actividad. La autorreparación semántica y la modificación automática de código productivo permanecen prohibidas. El experimento conserva `RAG` vs `GENERALIST_AGENT`; si se incorpora Functional Knowledge, la metodología debe resolver cómo mantener comparabilidad antes de ejecutar evidencia experimental. La unidad experimental (HU48) es un símbolo `METHOD`/`FUNCTION` `DIRECTLY_CHANGED` de un `AnalysisRun` existente, no una selección manual de `TestTarget`.

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

## Compatibilidad y legado

- Las modalidades manuales `METHOD|CLASS|CLASS_REMAINING|PROJECT|PROJECT_REMAINING` y la carga de proyecto vía ZIP quedan **retiradas como ruta de producto**: el único disparador de análisis es PR-driven (`AnalysisRun`). No existe camino legacy paralelo ni endpoint de subida manual; ver `CHANGELOG.md` para el detalle del retiro.
- El experimento `RAG` vs `GENERALIST_AGENT` (HU19) se conserva, pero su creación deja de depender de la selección manual de targets sobre un proyecto cargado por ZIP. Reapuntar la unidad experimental a un `AnalysisRun` existente es trabajo pendiente de un corte posterior (P1/P4 según handoff de reorientación); mientras tanto no bloquea el desarrollo PR-driven (P0) en curso.
- La experiencia mock de HU26 basada en GitHub login -> listado de repos -> selector/importación queda **SUPERSEDED BY SDD 2.0 / T-001**. Puede conservarse temporalmente como código histórico, pero no define producto ni contrato.
- Mocks frontend deben implementar `INTEROP-2.3`, estar señalizados como demo y permanecer detrás de adapters separados de live. No son evidencia científica ni empresarial.

## Decisiones compartidas

### DEC-GH-001 — Integración PR-driven mediante GitHub App

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** GitHub App, binding Project<->Repository, eventos PR-driven, webhooks, Checks API, mínimo privilegio, human-in-the-loop y companion PR aprobado por humano. No se requiere workflow YAML. GitHub OAuth mediante Supabase Auth sirve para identidad y, con un provider token efímero, para descubrir repositorios visibles; la App sigue siendo la única autoridad de automatización.

### DEC-WEB-AUTH-001 — Identidad del navegador

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** Supabase Auth admite únicamente GitHub OAuth (el correo y la contraseña se retiraron por `DEC-ORG-001`, HU62). Core valida el access token y autoriza por Project. Login e instalación GitHub App son independientes; Google OAuth y linking propio por correo quedan fuera de alcance.

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

### DEC-MET-001 — Mutation testing

**Estado:** PENDING

**Blocks:** únicamente investigación e implementación de mutation testing; no bloquea T-001 ni el pipeline principal.

**Pregunta:** definir herramientas, stacks, costo y rol metodológico antes de volver Mutation Score una métrica; no es requisito obligatorio en SDD 2.0.

### DEC-INF-001 — Infraestructura remota del Sandbox

**Estado:** PENDING

**Blocks:** aprovisionamiento remoto; no bloquea desarrollo/prevalidación local ni T-001.

**Pregunta:** seleccionar proveedor y controles de VM remota sin resolver silenciosamente costo, aislamiento, red o retención.

### DEC-VAL-001 — Validación empresarial

**Estado:** PENDING

**Blocks:** ingestión/despliegue con código empresarial y producción de evidencia empresarial; no bloquea T-001.

**Pregunta:** aprobar autorización organizacional, retención, proveedores externos, protección de código y exportación de evidencia.

### DEC-ORG-001 — Organizaciones y compartición de Projects

**Estado:** APROBADO (2026-09-20, por el usuario)

**Blocks:** NONE. No cierra `DEC-VAL-001`. Modifica `DEC-WEB-AUTH-001`: el login pasa a ser solo GitHub (HU62). Lo no probado contra una organización real es criterio de aceptación de los cortes que lo usan y **condición para desplegar**, no para implementar (ver "Precondiciones de despliegue").

**Resolución:** GitHub es la fuente de verdad de la autorización y Core persiste solo lo necesario para poder revocar por evento.

- **Workspaces:** el home ofrece la cuenta personal (siempre) y cada organización donde la GitHub App está instalada y el usuario es miembro; Core la obtiene listando las instalaciones de la App y verificando la membresía con el token de la App, sin depender del token del usuario ni del scope `read:org`. Una organización aparece cuando alguien instala la App en ella. El "equipo" es la organización; los Teams de GitHub no son workspace y solo aportan permisos de forma indirecta. Un Project guarda su organización (`githubOrgId`, `login`; nulo = personal) porque al crearse aún no tiene repositorio.
- **Login:** solo GitHub (HU62). La identidad se resuelve por el `githubUserId` numérico que Core obtiene de la Admin API de Supabase con el `sub` del token; nunca de `user_metadata`, que el propio usuario puede editar.
- **Roles (jerarquía Admin ⊃ Maintainer ⊃ Reader):** Admin es solo el owner de la organización (en el workspace personal, quien lo creó) y es además Maintainer; solo Admin crea, renombra y elimina Projects (el borrado sigue siendo lógico). Maintainer es quien tiene permiso `maintain`, `write` o `admin` sobre el repositorio vinculado; opera el día a día (binding, preguntas funcionales, publicación, experimentos). Reader es quien tiene `triage` o `read`: solo consulta.
- **Visibilidad:** se ve un Project si se tiene al menos `read` sobre su repositorio vinculado, también en el workspace personal. Un Project sin repositorio solo lo ven los Admin (todos los owners de la organización; en personal, su creador). Un recurso no visible responde el mismo `404` que uno inexistente.
- **Binding:** un Project tiene un solo repositorio y no se revincula (para otro repositorio se elimina el Project y se crea otro). En una organización solo se ofrecen y aceptan repositorios de esa organización; en el workspace personal, solo los propios. Vincular exige permiso `maintain`/`write` (o `admin`) sobre el repositorio, porque la GitHub App publica con permisos de escritura. Vincular, pausar y reactivar lo hacen Admin y Maintainer; como el Project sin repositorio solo lo ven los Admin, el primer vínculo es de un Admin. Un renombre del repositorio actualiza el nombre; una transferencia a otra organización o su eliminación pasa el binding a `REVOKED` sin borrar evidencia.
- **Alta y revocación:** el acceso se crea automáticamente al entrar, verificando en vivo el rol o permiso del usuario con el installation token de la App; nadie invita. La revocación no usa caché ni depende del inicio de sesión: los webhooks de la App en el ingress existente (§6.9) actualizan o borran el registro de acceso, y un job periódico de reconciliación, cada hora, sobre la cola existente corrige webhooks perdidos. Si GitHub no responde, Core conserva los accesos ya registrados (nunca revoca por un error de red), reintenta después y no concede accesos nuevos hasta poder verificarlos.
- **Ciclo de vida de la organización:** si la organización desaparece, se desinstala la App o queda sin owners, sus Projects y su evidencia se conservan pero dejan de verse (binding `REVOKED`); reaparecen si la App se reinstala o la organización vuelve. No se reasignan a otro workspace.
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

### DEC-EXP-FK-001 — Paridad experimental del contexto funcional

**Estado:** PENDING

**Blocks:** ejecución experimental que incorpore Functional Knowledge; no bloquea implementación del producto ni T-001.

**Pregunta:** definir si ambos brazos reciben la misma información funcional para aislar la variable de adquisición/construcción de contexto.

## Regla de compatibilidad

`SYSTEM-2.3` es la arquitectura objetivo vigente. Hereda el retiro de ZIP upload y generación manual como ruta de producto y el repository discovery user-centric con automatización GitHub-App-centric de `SYSTEM-2.2`, y agrega el ciclo de vida del binding (pausa/reactivación, un repositorio por Project) y el borrado lógico de Project (HU56/HU57). No existen APIs manuales transitorias: toda operación coordinada usa `INTEROP-2.3` y el modelo PR/HEAD. Todo cambio posterior se consolida primero aquí y luego en los mirrors.
