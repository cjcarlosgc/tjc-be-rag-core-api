# Contrato canónico del sistema

**Versión del contrato:** SYSTEM-2.0
**Fecha de corte:** 2026-09-13
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

1. **Login:** correo/contraseña o GitHub OAuth mediante Supabase Auth producen un `PlatformUser`. Google OAuth queda fuera de alcance.
2. **Automatización de repositorio:** una GitHub App administra instalaciones, repositorios autorizados, webhooks, Checks y, cuando se habilite, ramas/PR.

GitHub OAuth no autoriza la importación o automatización de repositorios. `PlatformUser`, `GitHubInstallation`, `GitHubRepository` y `GitHubActor` son conceptos independientes. No se implementa linking propio por coincidencia de correo; se admite únicamente el linking seguro que Supabase Auth aplique a identidades con correo verificado y configuración explícita. El actor de GitHub es metadata y no autoridad automática dentro de un Project.

Los permisos de la GitHub App aplican mínimo privilegio:

- metadata, contents y pull requests: read;
- checks: write;
- contents y pull requests: write solo al habilitar publicación;
- sin Actions/workflows ni permisos administrativos innecesarios.

## Onboarding y repository binding

Un usuario ya autenticado conecta un repositorio desde `Project -> Integrations -> GitHub`. La Console inicia la instalación/configuración, conserva una correlación segura con el Project, y Core valida el callback antes de crear el binding durable.

El binding conserva como mínimo Project, instalación, repository id estable, nombre, `integrationBranch` y estado enabled/disabled. `integrationBranch` usa `develop` por defecto y es configurable. Desconectar deshabilita/revoca el binding, impide aceptar eventos nuevos para ese Project y conserva Runs/evidencia según retención.

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

No se generan duplicados para demostrar actividad. La autorreparación semántica y la modificación automática de código productivo permanecen prohibidas. El experimento conserva `RAG` vs `GENERALIST_AGENT`; si se incorpora Functional Knowledge, la metodología debe resolver cómo mantener comparabilidad antes de ejecutar evidencia experimental.

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

- Las modalidades manuales `METHOD|CLASS|CLASS_REMAINING|PROJECT|PROJECT_REMAINING` pueden permanecer como camino legacy, pero ninguna arquitectura nueva depende de ellas.
- ZIP ingestion permanece como ruta legacy/development para tests, experimentos y compatibilidad TypeScript; GitHub repository + commit SHA es la ruta objetivo.
- La experiencia mock de HU26 basada en GitHub login -> listado de repos -> selector/importación queda **SUPERSEDED BY SDD 2.0 / T-001**. Puede conservarse temporalmente como código histórico, pero no define producto ni contrato.
- Mocks frontend deben implementar `INTEROP-2.0`, estar señalizados como demo y permanecer detrás de adapters separados de live. No son evidencia científica ni empresarial.

## Decisiones compartidas

### DEC-GH-001 — Integración PR-driven mediante GitHub App

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** GitHub App, binding Project<->Repository, eventos PR-driven, webhooks, Checks API, mínimo privilegio, human-in-the-loop y companion PR aprobado por humano. No se requiere workflow YAML y GitHub OAuth queda limitado a login mediante Supabase Auth.

### DEC-WEB-AUTH-001 — Identidad del navegador

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** Supabase Auth admite únicamente correo/contraseña y GitHub OAuth. Core valida el access token y autoriza por Project. Login e instalación GitHub App son independientes; Google OAuth y linking propio por correo quedan fuera de alcance.

### DEC-INT-001 — Contrato Core<->Sandbox

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** `INTEROP-2.0` conserva HTTP asíncrono, Bearer de servicio, idempotencia y referencias efímeras; agrega execution profiles y evidencia neutral para Node/TypeScript y PHP/Laravel/PHPUnit.

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

### DEC-EXP-FK-001 — Paridad experimental del contexto funcional

**Estado:** PENDING

**Blocks:** ejecución experimental que incorpore Functional Knowledge; no bloquea implementación del producto ni T-001.

**Pregunta:** definir si ambos brazos reciben la misma información funcional para aislar la variable de adquisición/construcción de contexto.

## Regla de compatibilidad

`SYSTEM-2.0` sustituye `SYSTEM-1.6` como arquitectura objetivo. Las APIs manuales existentes pueden mantenerse transitoriamente, pero toda nueva operación coordinada usa `INTEROP-2.0` y el modelo PR/HEAD. Todo cambio posterior se consolida primero aquí y luego en los mirrors.
