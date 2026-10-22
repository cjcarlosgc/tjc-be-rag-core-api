# Inventario de cobertura C-01…C-10 para arch-v1.0 (WI-CORE-080)
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fuente de contratos: tesis `referencias/tesis.md`, «Anexo E. Catálogo de contratos arquitectónicos» (Tabla 52, líneas 2217-2226); Anexo G (Tablas 54-56). Rutas de pruebas desde `app/`. `*.pg.spec.ts` requieren Postgres y no corren en la suite local (104 omitidos). Mapa hecho por lectura (nombres de describe/it verificados con grep; no se ejecutó nada). Alcance de la tesis sobre CT: el Anexo E solo dice «Prueba: CT-0x»; no hay en la tesis una definición de pasos de CT-01…CT-10 (solo «Evidencia» por contrato). Lo que cada CT deba comprobar es, por tanto, una decisión pendiente (ver sección c).

## Inventario por contrato

| C | Fila Anexo E (id, responsabilidad, CT) | Pruebas existentes en Core | Qué no cubre | Prueba nueva necesaria | Dueño |
|---|---|---|---|---|---|
| C-01 | Git Integration → Run Orchestrator: «recibir eventos Git y fijar repositorio/PR/HEAD»; CT-01 | `src/github-webhooks/github-webhooks.controller.spec.ts` («Core internal GitHub webhook receiver»: 202 nuevo, 200 duplicado, bearer inválido, 503 sin credencial, error reintentable); `github-webhooks.service.spec.ts` (instalación, repository events); `src/analysis-runs/analysis-runs.service.spec.ts` («startRunFromWebhook», «startRun»: redelivery mismo HEAD, obsoleta HEAD previo) | Ningún test encadena payload saneado real de Integration → AnalysisRun con repo/PR/HEAD; «evento no elegible» y «permisos insuficientes» cubiertos por piezas sueltas, no como CT. Contrato `spec/contracts/github-integration-contract.md` sin schema/examples en `schemas/` | Contract test: payload normalizado de Integration (ejemplo canónico) → `startRunFromWebhook` preserva repo/PR/HEAD; automatizable | Core + otro repo: GitHub Integration (`app/src/github-webhooks/github-webhook-normalizer.spec.ts`, `github-webhook-core-client.spec.ts`, `github-webhook.service.spec.ts`) |
| C-02 | Run Orchestrator → Repository Intelligence/Analysis: «coordinar snapshot, CHANGESET, INDEX DELTA y targets»; CT-02 | `src/snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` («SnapshotAnalysisJobHandler», «snapshot persistence»); `analysis-runs.service.spec.ts` («recordSnapshot», «obsoleteRun»); `src/project-versions/project-versions.service.spec.ts`, `inventory/test-target-extractor.service.spec.ts`; `src/snapshot-intelligence/github-snapshot-materializer.service.spec.ts` | HEAD obsoleto a mitad del análisis y separación explícita CHANGESET vs INDEX DELTA cubiertas solo por casos del handler, sin un test nombrado por la frontera; Postgres real no ejercitado en esta frontera | Test del handler que fije: alcance (targets) distinto de instrucciones de indexación y Run obsoleto no actualiza; automatizable | Core |
| C-03 | Retriever → Context Builder: «recuperar y rankear candidatos»; CT-03 | `src/retrieval/retrieval.service.spec.ts` («RetrievalService», «modes (WI-CORE-022)» SE/SEM, `UNRESOLVABLE_TARGET`, PHP structural); `src/retrieval-comparisons/retrieval-comparison-ranking.spec.ts`; `src/project-versions/persistence/code-chunks.repository.spec.ts`; `retrieval-comparisons.repository.pg.spec.ts` (Postgres) | Conjunto vacío como estado explícito; `retrieval_id` + export/audit del ranking como evidencia CT; búsqueda pgvector real (solo `*.pg`, si existe) | Test que verifique `retrieval_id` + ranking auditable exportado y caso vacío; vector real requiere Postgres | Core |
| C-04 | Functional Knowledge Service → Context Builder/Orchestrator: «recuperar reglas ACTIVE aplicables y gestionar autoridad»; CT-04 | `src/retrieval/functional-rules.retriever.spec.ts` («FunctionalRulesRetriever»); `src/functional-knowledge/functional-knowledge.service.spec.ts` («submitAnswer», «listActionRequired», «procedencia de reglas»); `functional-context-evaluator.service.spec.ts` («aplicabilidad por scenarioKey»); `functional-knowledge.controller.spec.ts`; `functional-continuation-job.handler.spec.ts` | «403 de confirmación» y conflicto UNKNOWN como un único contrato; autoridad sobre FK con Postgres/RLS | Test CT-04: reglas no ACTIVE/sin autoridad nunca llegan a `functionalRules`; 403 al confirmar sin permiso; automatizable | Core (Console consume ACTION_REQUIRED en UI: `tjc-fe-rag-developer-console/app/src/action-required/api.test.ts`) |
| C-05 | Context Builder → Test Generator: «construir GenerationContext»; CT-05 | `src/retrieval/context-builder.service.spec.ts` («ContextBuilder», «functional rules», «dependencyContext»); `src/context-traces/context-traces.service.spec.ts` («ContextTracesService…», `context_id`); `context-traces.repository.spec.ts`; `context-traces.repository.pg.spec.ts` (Postgres); `src/generation/prompt-builder.service.spec.ts` | «Contexto insuficiente» y precedencia de ACTION_REQUIRED previo; límites de tamaño/deduplicación como contrato | Test: contexto deduplicado/limitado + `GenerationContextAudit` con `context_id`, y rechazo con ACTION_REQUIRED previo | Core |
| C-06 | Execution Coordinator → Sandbox: «enviar un job técnico de ejecución aislada»; CT-06 | `src/sandbox/sandbox-execution.contract.spec.ts` («contrato Core ↔ Sandbox»: «el POST /executions que construye Core cumple CreateSandboxExecutionRequest»); `sandbox-execution.service.spec.ts`; `sandbox-execution.resilience.spec.ts`; `src/contracts/contract-validator.spec.ts` (URL HTTPS, sha256, rutas); ejemplos `spec/contracts/schemas/examples/sandbox-*.json` | «Sin secretos Git/FK» en el payload no se afirma explícitamente; perfil no soportado | Test que afirme ausencia de secretos/semántica RAG en el request real; automatizable | Core + otro repo: Sandbox (`app/src/executions/executions.contract.spec.ts`, `executions.contract-real.spec.ts`, `core-client.contract.spec.ts`) |
| C-07 | Sandbox → Execution Coordinator: «devolver hechos técnicos normalizados»; CT-07 | `sandbox/map-sandbox-result.spec.ts` («mapSandboxResult», failureKind); `sandbox-evidence-facts.spec.ts`; `sandbox-execution.contract.spec.ts` (COMPLETED/FAILED del contrato); `sandbox-execution.resilience.spec.ts` | Timeout vs infraestructura vs fallo de test como matriz única; no-juicio-funcional como aserción | Matriz timeout/INFRASTRUCTURE/test failure sobre los ejemplos canónicos; automatizable | Core + otro repo: Sandbox (`app/test/full-pipeline.e2e-spec.ts`, `executions.e2e-spec.ts`, `core-client.contract.spec.ts` con cliente real de Core) |
| C-08 | Trace/Artifacts ← componentes: «persistir evidencias e identificadores de la cadena»; CT-08 (evidencia: «checklist de 9 enlaces») | `src/analysis-runs/analysis-run-trace.service.spec.ts` («AnalysisRunTraceService»: cadena completa, NOT_APPLICABLE, 409 `EVIDENCE_NOT_FINISHED`, publicación PRESENT/STALE); `analysis-runs.controller.trace.spec.ts`; `persistence/analysis-trace.repository.spec.ts`; `analysis-trace.repository.pg.spec.ts` (Postgres); `src/evidence/evidence-bundle.assembler.spec.ts`, `evidence.service.spec.ts`; `evidence.repository.pg.spec.ts` | Comprobación inversa (resultado→PR/HEAD) y detección de «enlace faltante/inconsistente» sobre un Run real; la checklist es sobre Runs reales, no unitaria | Test de recorrido directo e inverso con fixture de Run completo (9 enlaces); la checklist sobre un Run real es manual/evidencia | Core (Console muestra trace: `app/src/control-plane/operationalTrace.test.ts`) |
| C-09 | Model Provider Adapter (LLMProvider): «desacoplar inferencia del proveedor»; CT-09 (evidencia: «interfaz/adapter + ESC-MOD-01») | `src/providers/openai-llm.provider.spec.ts` («OpenAiLLMProvider»: generate, generateWithTools, clasificación de fallos, config efectiva); `strict-tool-schema.spec.ts`; interfaz `src/providers/llm-provider.interface.ts` y `providers.constants.ts` (`LLM_PROVIDER`) | Un test de contrato genérico contra `LLMProvider` (un segundo adapter/fake que lo cumpla); ESC-MOD-01 no ejecutado | Contract suite reusable para cualquier `LLMProvider` + ESC-MOD-01 (git diff, M1/M2/M3); CT automatizable, ESC-MOD es diff+pruebas | Core |
| C-10 | Persistence/Vector/Artifact adapters: «desacoplar almacenamiento…»; CT-10 | `src/object-storage/supabase-object-storage.adapter.spec.ts` (adapter detrás de `ObjectStorageService`); `src/providers/openai-embedding.provider.spec.ts`; `src/prisma/*-migration.spec.ts`, `rls-guard.spec.ts`; repos `*.repository.spec.ts`; `*.pg.spec.ts` (Postgres): `jobs.repository`, `analysis-trace.repository`, `evidence.repository`, `context-traces.repository`, `retrieval-comparisons.repository`, `evidence-persistence-migration` | Puertos explícitos: solo `ObjectStorageService` y `EmbeddingProvider`/`LLMProvider`; persistencia relacional y vectorial son Prisma/SQL directo, sin interfaz-puerto; los `*.pg` no corren localmente | Test de arquitectura (imports prohibidos de SDK/proveedor fuera de adapters) y corrida de los `*.pg` contra Postgres; mixto automatizable/CI con DB | Core |

Notas: (1) No encontré en Core tests e2e (`app/test`) que crucen C-01…C-08; los e2e existentes son de acceso, proyectos, workspaces, realtime y error-envelope (este último sí relevante para el envelope común de todos los contratos). (2) Console no es dueña de ningún C-01…C-10; solo consume C-08/C-04 por UI.

## Resumen

| C | Estado | Dueño |
|---|---|---|
| C-01 | Parcial | Core + GitHub Integration |
| C-02 | Parcial | Core |
| C-03 | Parcial | Core |
| C-04 | Parcial | Core |
| C-05 | Parcial | Core |
| C-06 | Cubierto (con contrato real) | Core + Sandbox |
| C-07 | Cubierto (con contrato real) | Core + Sandbox |
| C-08 | Parcial | Core |
| C-09 | Parcial (sin segundo adapter) | Core |
| C-10 | Parcial (puertos solo en storage/LLM/embeddings; `*.pg` no corren localmente) | Core |

Estado es juicio de este mapa por lectura, no resultado de CT.

Brechas de mayor valor para el tag:
1. C-08/9 enlaces: recorrido directo e inverso sobre un Run completo (hoy solo trace unitario y `*.pg`).
2. C-09 + ESC-MOD-01: suite de contrato de `LLMProvider` y medición M1/M2/M3 (requiere definir la rama/commit alternativo).
3. C-01: contract test Integration→Core con payload canónico (hoy sin schema/ejemplo en `spec/contracts/schemas/`).
4. C-10: correr los 6 `*.pg.spec.ts` contra Postgres y aclarar qué cuenta como «puerto».
5. C-03/C-05: evidencia auditable (`retrieval_id`, `context_id`) como aserción de contrato.

## Lo que la tesis exige y no es un test

Solo cita: checklist de trazabilidad de 9 enlaces con comprobación directa/inversa por AnalysisRun (Tabla 54, IOE1.1, 100%); ESC-MOD-01 con M1=0, M2=0, M3=100% (Tabla 55, IOE1.3; «git diff + pruebas»); HITO-OE1 (Tabla 56: tag anotado `arch-v1.0`, registro de SHA de Console, Integration y Sandbox, ADR-01–10, acta); «Paquete OE1: CT-01–CT-10, ESC-MOD-01, checklist de trazabilidad, ADR completos y acta HITO-OE1» (línea 1478). Resultados y Evidence IDs de esas tablas siguen en PENDIENTE y los llena una ejecución real.

## Incoherencias o puntos a decidir (sin resolver aquí)

- La tesis no define qué comprueba cada CT-01…CT-10 (solo el campo «Evidencia»); el Anexo E dice que endpoints/esquemas se verifican contra la implementación antes de HITO-OE1. Decisión pendiente: qué aserciones constituyen cada CT.
- C-01 nombra «webhook/evento autenticado» y «GitHub App» como dependencia; en el código el webhook de GitHub lo recibe Integration y Core recibe un evento interno con bearer de servicio. Probable coherente, pero conviene que el CT-01 lo diga.
- C-10 habla de «adaptadores/puertos» para persistencia y vectorial; el código usa Prisma/SQL directo (solo storage, LLM y embeddings tienen interfaz). Decidir si se ajusta el documento o se introducen puertos.
- ESC-MOD-01 (Tabla 55) acota la frontera a `app/src/providers`, `providers.module` y config/env; el módulo `src/experiments` consume la config LLM (`experiments.model-config.spec.ts`): verificar que no cuente como M1 al medir.
- `spec/contracts/schemas/` solo cubre common, error-envelope, realtime y sandbox-execution; no hay schema para C-01..C-05/C-08.

## Nota

Sin corridas oficiales ni números de IOE; el mapa se hizo por lectura.
