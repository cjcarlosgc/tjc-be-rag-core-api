# Arquitectura objetivo de cuatro componentes

**Contratos compartidos:** SYSTEM-2.4 / INTEROP-2.4
**Estado:** aprobado con decisiones `PENDING` explícitas

## Topología

```text
GitHub <-> GitHub Integration API <-> RAG Core API <-> Test Execution Sandbox
                                      ^
                                      |
                              Developer Console
                                      |
                                Supabase Auth
```

- GitHub Integration API (`tjc-be-github-integration-api`) posee toda interacción con GitHub: App, webhooks, installation tokens, discovery, repositorios, ramas, snapshots por commit, Checks y companion PR. Conserva SDK y código extraído de Core. Su contrato con Core se especifica antes del traslado.
- Console consume Core para dominio y usa Supabase Auth para identidad de persona; no automatiza GitHub directamente.
- Core persiste dominio/conocimiento, construye contexto, genera, orquesta y clasifica. Durante la migración todavía contiene código GitHub; ese estado no define la frontera final.
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

- Frontera GitHub Integration: Core mantiene Project, autorización de dominio, AnalysisRun y decisiones del pipeline; delega operaciones GitHub mediante contrato versionado sin portar SDK ni credenciales de App al final de la extracción.
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

Los componentes de ingestión, indexación, generación y validación se conservan solo como capacidades reutilizables dentro del flujo PR-driven. No hay ruta de carga manual ZIP ni descarga agrupada de artefactos; el snapshot ZIP interno que Docker/Sandbox recupera permanece. La experiencia mock GitHub de login/importación está retirada. INTEROP-2.4 es la autoridad de transporte vigente hasta que se apruebe el contrato del cuarto componente.
