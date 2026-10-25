# Mapa de evidencia CT-01…CT-10 de Core para `arch-v1.0` (WI-CORE-099)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Qué es: por cada una de las 52 aserciones de `arch-v1.0-aserciones-ct-propuesta.md`, su estado, la prueba que la cubre y el comando para registrar la evidencia (D-1: un registro por CT con SHA, comando y resultado). Las pruebas nuevas de este WI viven en `app/src/ct/` y sus `it` se titulan `CT-NN-Ax: …`. Las rutas son desde `app/`. Estados: **CUBIERTA** (automática, `pnpm test`); **CUBIERTA-PG** (necesita PostgreSQL con pgvector; corre en el job de CI «Specs con PostgreSQL» y en local contra una base descartable); **DECLARADA** (aserción reformulada o limitación aprobada por el usuario, ver la decisión); **MANUAL** (checklist con Evidence ID sobre Runs reales, D-11); **EXTERNA** (la mitad que falta vive en otro repositorio); **POSTERIOR** (se ejecuta sobre una rama posterior al tag).

## Comandos de evidencia

- Suite completa de Core (sin pg), desde `app/`: `corepack pnpm@12.14.0 test` (PATH con Node 22). Resultado verificado el 2026-10-25 sobre el árbol del WI-CORE-099: 183 ficheros pasan y 9 omitidos; 3089 tests pasan y 111 omitidos; 0 fallos.
- Una CT concreta: `corepack pnpm@12.14.0 exec vitest run src/ct/ct-NN-<tema>.spec.ts` (+ los specs existentes de la fila).
- Pruebas pg (todas): base descartable `pgvector/pgvector:pg16`, `corepack pnpm@12.14.0 exec prisma migrate deploy` y luego, con las variables `DATABASE_URL`, `CT_TEST_DATABASE_URL`, `ANALYSIS_TRACE_TEST_DATABASE_URL`, `CONTEXT_TRACES_TEST_DATABASE_URL`, `EVIDENCE_PERSISTENCE_TEST_DATABASE_URL`, `EVIDENCE_TEST_DATABASE_URL`, `JOBS_TEST_DATABASE_URL` y `RETRIEVAL_COMPARISONS_TEST_DATABASE_URL` apuntando a esa base: `corepack pnpm@12.14.0 exec vitest run --reporter=default .pg.spec.ts`. Resultado verificado el 2026-10-25 contra Postgres local: 8 ficheros, 111 tests pasan (4 ejecuciones consecutivas); en CI es el job `postgres` de `.github/workflows/ci.yml`.

## Mapa

| Aserción | Estado | Prueba(s) | Nota |
|---|---|---|---|
| CT-01-A1 | CUBIERTA | `src/ct/ct-01-webhook-intake.spec.ts` (`CT-01-A1`: opened y synchronize con los ejemplos canónicos); `src/github-webhooks/dto/normalized-webhook-event.contract.spec.ts` | Entra por controlador, guard, pipe y servicios reales con repositorio en memoria. |
| CT-01-A2 | CUBIERTA | `src/github-webhooks/github-webhooks.controller.spec.ts` | 401 y 503. |
| CT-01-A3 | CUBIERTA | `src/github-webhooks/github-webhooks.controller.spec.ts`; `src/analysis-runs/analysis-runs.service.spec.ts` | 202 nuevo, 200 duplicado. |
| CT-01-A4 | CUBIERTA | `src/ct/ct-01-webhook-intake.spec.ts` (`CT-01-A4`: ping, sin binding, DISABLED/REVOKED, instalación distinta, borrador, suspend, deleted, removed); `src/github-webhooks/github-webhooks.service.spec.ts` | |
| CT-01-A5 | EXTERNA | Core: `normalized-webhook-event.contract.spec.ts` (esquema y 15 ejemplos, WI-CORE-079) | La mitad de Integration (su emisor valida contra los mismos ejemplos) es del repo de Integration vía cross. |
| CT-02-A1 | CUBIERTA | `src/snapshot-intelligence/snapshot-analysis-job.handler.spec.ts`; `src/analysis-runs/analysis-runs.service.spec.ts` | |
| CT-02-A2 | DECLARADA | `snapshot-analysis-job.handler.spec.ts` (BOOTSTRAP, INCREMENTAL) | D-19: aserción redactada a la semántica implementada; la forma estricta se declara NO CUMPLE (limitación; Project nuevo por caso). |
| CT-02-A3 | CUBIERTA | `src/ct/ct-02-orchestration.spec.ts` (`CT-02-A3`); `analysis-runs.service.spec.ts` | Un Run obsoleto no materializa, no indexa, no crea targets. |
| CT-02-A4 | CUBIERTA | `src/ct/ct-02-orchestration.spec.ts` (`CT-02-A4`) | El estado explícito es la propuesta HELD y el Run `TECHNICAL_GENERATION_FAILURE`. |
| CT-03-A1 | CUBIERTA | `src/retrieval/retrieval.service.spec.ts` | |
| CT-03-A2 | CUBIERTA | `src/retrieval/retrieval.service.spec.ts` | |
| CT-03-A3 | CUBIERTA | `src/ct/ct-03-retrieval.spec.ts` (`CT-03-A3`) | SE y SEM. |
| CT-03-A4 | CUBIERTA | `src/ct/ct-03-retrieval.spec.ts` (`CT-03-A4`) | Orden determinista dado el orden del repositorio; el desempate de distancias iguales no está garantizado. |
| CT-03-A5 | CUBIERTA-PG | `src/ct/ct-03-retrieval.pg.spec.ts` (`CT-03-A5`); `src/analysis-runs/persistence/analysis-trace.repository.pg.spec.ts` | |
| CT-03-A6 | CUBIERTA-PG | `src/ct/ct-03-retrieval.pg.spec.ts` (`CT-03-A6`) | pgvector real; nunca devuelve chunks de otra versión. |
| CT-04-A1 | CUBIERTA | `src/retrieval/functional-rules.retriever.spec.ts` | |
| CT-04-A2 | DECLARADA | `src/ct/ct-04-functional-knowledge.spec.ts` (`CT-04-A2`); `functional-knowledge.repository.spec.ts` | D-18: no ACTIVE nunca llega al contexto; no se filtra por procedencia (en los Projects oficiales no existen reglas sin procedencia). |
| CT-04-A3 | CUBIERTA | `src/functional-knowledge/functional-knowledge.service.spec.ts` (submitAnswer); `src/project-access/project-access.service.spec.ts` | |
| CT-04-A4 | CUBIERTA | `src/ct/ct-04-functional-knowledge.spec.ts` (`CT-04-A4`); `functional-context-evaluator.service.spec.ts`; `functional-continuation-job.handler.spec.ts` | |
| CT-04-A5 | CUBIERTA-PG | `src/ct/ct-04-access.pg.spec.ts` (`CT-04-A5`) | Predicado `accessibleProject` contra SQL real (lectura de reglas y resolución del Project); no hay RLS; la confirmación sin rol suficiente está en CT-04-A3 (sin pg). |
| CT-05-A1 | CUBIERTA | `src/retrieval/context-builder.service.spec.ts` | |
| CT-05-A2 | CUBIERTA | `src/retrieval/context-builder.service.spec.ts` | |
| CT-05-A3 | CUBIERTA | `src/ct/ct-05-context.spec.ts` (`CT-05-A3`) | SE y SEM. |
| CT-05-A4 | CUBIERTA | `src/retrieval/context-builder.service.spec.ts` (ContextBuilder functional rules) | |
| CT-05-A5 | CUBIERTA | `src/generation/context-sufficiency.spec.ts`; `src/generation/test-generation-pipeline.spec.ts`; `validation/analysis-run-validation-job.handler.spec.ts`; `experiments/experiment-job.handler.spec.ts` (WI-CORE-098) | D-16: variante V1 (HELD en Validation; experimento FAILED sin repeticiones en Experiments); V2 (ACTION_REQUIRED con pregunta) es limitación. |
| CT-05-A6 | CUBIERTA-PG | `analysis-trace.repository.pg.spec.ts`; `src/context-traces/context-traces.repository.spec.ts` | |
| CT-06-A1 | CUBIERTA | `src/sandbox/sandbox-execution.contract.spec.ts` | |
| CT-06-A2 | CUBIERTA | `src/sandbox/sandbox-execution.service.spec.ts` | |
| CT-06-A3 | CUBIERTA | `src/ct/ct-06-sandbox-request.spec.ts` (`CT-06-A3`) | Se interpreta como «el cuerpo del request»; el service token viaja en `Authorization` por diseño (DEC-AUTH-001) y el test fija el conjunto cerrado de cabeceras. |
| CT-06-A4 | CUBIERTA | `src/ct/ct-06-sandbox-request.spec.ts` (`CT-06-A4`); `sandbox-execution.service.spec.ts`; `validation/analysis-run-validation-job.handler.spec.ts` | El contrato usa `executionId` (camelCase). |
| CT-06-A5 | CUBIERTA | `src/ct/ct-06-sandbox-request.spec.ts` (`CT-06-A5`); `src/sandbox/sandbox-execution.resilience.spec.ts` | El perfil no soportado y el job inválido se prueban también en el repo del Sandbox (T9, T5). |
| CT-07-A1 | CUBIERTA | `sandbox-execution.contract.spec.ts`; `src/sandbox/sandbox-evidence-facts.spec.ts` | |
| CT-07-A2 | CUBIERTA | `src/sandbox/map-sandbox-result.spec.ts` | |
| CT-07-A3 | CUBIERTA | `src/sandbox/map-sandbox-result.spec.ts` | |
| CT-07-A4 | CUBIERTA | `src/ct/ct-07-sandbox-result.spec.ts` (`CT-07-A4`) | Mitad de Core: Core ignora cualquier campo de veredicto funcional o RAG de la salida del Sandbox. Que el Sandbox no los emita es propiedad de su repo (`executions.contract.spec.ts`), no probada aquí. |
| CT-07-A5 | EXTERNA | Repo del Sandbox: `core-client.contract.spec.ts` | Correrla con ambos repos presentes y registrar los SHA (Tabla 56). |
| CT-08-A1 | CUBIERTA | `src/analysis-runs/analysis-run-trace.service.spec.ts`; `analysis-trace.repository.pg.spec.ts` | |
| CT-08-A2 | MANUAL | checklist de la Tabla 54 con Evidence ID | D-11: manual; la consulta inversa automática es mejora posterior (G-08). |
| CT-08-A3 | CUBIERTA | `analysis-run-trace.service.spec.ts` | |
| CT-08-A4 | MANUAL | checklist de la Tabla 54 con Evidence ID | D-11 (G-08). |
| CT-08-A5 | CUBIERTA | `analysis-run-trace.service.spec.ts` | |
| CT-08-A6 | MANUAL | 3 checklists sobre los AnalysisRuns oficiales: el Run del caso `c1` de cada piloto (si no termina por causa objetiva, el de `c2`) | D-9/D-11, tras los Runs oficiales y sobre el tag nuevo. |
| CT-09-A1 | CUBIERTA | `src/providers/openai-llm.provider.spec.ts` | |
| CT-09-A2 | CUBIERTA | `src/providers/openai-llm.provider.spec.ts` | |
| CT-09-A3 | CUBIERTA | `src/providers/llm-provider.contract.spec.ts` (WI-CORE-089) | OpenAI y adaptador falso. |
| CT-09-A4 | CUBIERTA | `src/providers/provider-boundary.architecture.spec.ts` (WI-CORE-089) | |
| CT-09-A5 | POSTERIOR | `feature/esc-mod-01` sobre el tag nuevo: M1, M2, M3 | Se re-mide tras recrear el tag; adaptador real de Anthropic. |
| CT-10-A1 | CUBIERTA | `src/ct/ct-10-persistence.spec.ts` (`CT-10-A1`); `src/object-storage/supabase-object-storage.adapter.spec.ts` | Los errores del adapter son `Error` con mensaje que nombra la clave, sin secretos. |
| CT-10-A2 | CUBIERTA | `src/ct/ct-10-persistence.spec.ts` (`CT-10-A2`); `src/providers/openai-embedding.provider.spec.ts` | |
| CT-10-A3 | CUBIERTA-PG | los 6 `*.pg.spec.ts` existentes + los 2 nuevos de `src/ct/` | Registrar la corrida de CI del job `postgres` (SHA, comando y resultado) además de la local. |
| CT-10-A4 | DECLARADA | `src/ct/ct-10-persistence.spec.ts` (`CT-10-A4`); `all-exceptions.filter*.spec.ts` | D-20: error de persistencia = `500 INTERNAL_ERROR` sin fuga; conflictos tipados por repositorio; sin `ErrorCode` nuevo. |
| CT-10-A5 | DECLARADA | `src/ct/ct-10-architecture.spec.ts` (`CT-10-A5`) | D-21: lista permitida explícita (`common/idempotency/idempotency.service.ts`, adapter de persistencia, D-6). Límite: detecta el identificador `PrismaService` (un `PrismaClient` directo no) y el escaneo de `PrismaService` excluye `test/` y specs. |

## Conteo

| Estado | Aserciones |
|---|---|
| CUBIERTA | 37 |
| CUBIERTA-PG | 5 |
| DECLARADA | 4 |
| MANUAL | 3 |
| EXTERNA | 2 |
| POSTERIOR | 1 |
| **Total** | **52** |
