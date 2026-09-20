# Arquitectura SDD 2.0

**Contratos compartidos:** SYSTEM-2.3 / INTEROP-2.3
**Estado:** aprobado con decisiones `PENDING` explícitas

## Topología

```text
GitHub -> GitHub App -> RAG Core -> Test Execution Sandbox
                           ^
                           |
                    Developer Console
                           |
                     Supabase Auth
```

- Console consume Core para dominio y usa Supabase Auth solo para identidad de persona.
- Core integra GitHub, persiste dominio/conocimiento, construye contexto, genera, orquesta y clasifica.
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

- GitHub Integration: instalación/revocación, binding, webhooks, normalización, idempotencia, Checks y branches/PR.
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

Los componentes de ingestión, indexación, generación, validación y artefactos se conservan solo como capacidades reutilizables dentro del flujo PR-driven; no mantienen rutas, DTOs, mocks ni adapters de producto independientes. La experiencia mock GitHub de login/importación está retirada. INTEROP-2.2 es la única autoridad para nuevos adapters y fixtures.
