# Arquitectura objetivo de cuatro componentes

**Contratos compartidos:** SYSTEM-2.5 / INTEROP-2.6 / GH-INTEROP-1.1
**Estado:** aprobado con decisiones `PENDING` explícitas

## Topología

```text
GitHub ──webhook──> GitHub Integration ──evento normalizado──> RAG Core ──> Sandbox
                         ▲                                  ▲
                         │ operaciones GitHub UI            │ dominio/RAG/Projects
                         └──────── Developer Console ───────┘
                                      │
                                 Supabase Auth
```

- GitHub Integration API (`tjc-be-github-integration-api`) posee toda interacción con GitHub: App, SDK, REST/Git Data, webhooks, discovery, repositorios, ramas, Checks y companion PR. Conserva el SDK y código extraído de Core. `GH-INTEROP-1.1` define tanto operaciones privadas de pipeline como rutas autenticadas Console→Integration; la migración está en código fuente y sigue sin deploy/cutover.
- Console usa GitHub Integration directamente solo para App info, discovery, verificación GitHub y ramas; para workspaces/Projects, persistencia de bindings, RAG y análisis sigue usando Core. Supabase Auth conserva la identidad humana.
- Core persiste dominio/conocimiento, construye contexto, genera, orquesta y clasifica; mantiene un cliente privado para delegar operaciones GitHub y valida/procesa los webhooks normalizados recibidos desde GitHub Integration.
- Sandbox materializa snapshots/artifacts, ejecuta el profile solicitado y devuelve evidencia neutral.

## Flujo principal

```text
PR event -> binding -> AnalysisRun(PR, HEAD) -> PR_ANALYSIS job
-> snapshot/index -> CHANGESET -> changed/impacted symbols
-> existing baseline -> technical + functional retrieval
-> ACTION_REQUIRED o generation -> Sandbox -> classification
-> Check -> human review -> optional companion PR
```

`ACTION_REQUIRED` termina el job y usa continuation sobre el mismo Run si el HEAD permanece. Un HEAD nuevo crea otro Run y obsoleta el anterior. Checks y publicaciones verifican freshness.

## Fronteras de Core

- Frontera GitHub Integration: Core mantiene Project, autorización de dominio, AnalysisRun y decisiones del pipeline; delega operaciones GitHub mediante `GH-INTEROP-1.1`, recibe los webhooks normalizados y autoriza sincrónicamente las operaciones directas de Console. Core no contiene SDK ni credenciales de GitHub App.
- Analysis domain: PR/HEAD lifecycle, Run vs Attempt, states y auditoría.
- Snapshot/changeset: bootstrap/incremental, CHANGESET vs INDEX DELTA, changed/impacted symbols.
- Knowledge: retrieval semántico/estructural, Functional Knowledge versionado, existing test context y Context Builder.
- Generation/validation: providers, proposals, baseline, Sandbox orchestration y classification.
- Human-in-the-loop: questions, answers, continuation, review, freshness y publication.
- Experiment: RAG vs GENERALIST_AGENT con trazas comparables y `DEC-EXP-FK-001` antes de incorporar contexto funcional a evidencia.

Los nombres son responsabilidades, no clases obligatorias. Cada módulo evita dependencias circulares, usa inyección por puertos para servicios externos y conserva repositorios como frontera de persistencia.

## Persistencia y asincronía

PostgreSQL + pgvector conserva dominio, índice, Functional Knowledge y jobs DB-backed. Supabase Storage conserva snapshots/artefactos detrás de `ObjectStorageService`. Webhooks retornan rápido después de verificación, persistencia/idempotencia y enqueue; workers ejecutan etapas recuperables.

## Stacks y ejecución

Core usa adapters de lenguaje y framework de tests. `NODE_TYPESCRIPT` preserva ts-morph/Jest/Vitest; `PHP_LARAVEL_PHPUNIT` agrega PHP/Laravel/PHPUnit sin condicionales dispersos. Sandbox selecciona el profile y no recibe secretos GitHub/Supabase, reglas funcionales ni decisiones de negocio.

## Compatibilidad

Los componentes de ingestión, indexación, generación y validación se conservan solo como capacidades reutilizables dentro del flujo PR-driven. No hay ruta de carga manual ZIP ni descarga agrupada de artefactos; el snapshot ZIP interno que Docker/Sandbox recupera permanece. La experiencia mock GitHub de login/importación está retirada. INTEROP-2.6 rige Core↔Console↔Sandbox; GH-INTEROP-1.1 rige Console→Integration y las operaciones privadas entre Core e Integration.
