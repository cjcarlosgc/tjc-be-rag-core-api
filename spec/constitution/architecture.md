# Arquitectura

**Estado:** aprobado con decisiones PENDING explícitas

## Topología de la solución

La arquitectura base se materializa en tres proyectos, dos backend y uno frontend:

`tjc-fe-rag-developer-console -> tjc-be-rag-core-api -> tjc-be-test-execution-sandbox`.

- Developer Console: cliente web de referencia; no llama directamente al Sandbox.
- RAG Core API: indexación, retrieval, construcción de contexto, generación, experimentación, orquestación y persistencia de métricas.
- Test Execution Sandbox: ejecución aislada de Jest/Vitest y devolución de hechos objetivos; no conoce si una ejecución provino de RAG o del agente generalista.

## Flujo de indexación

`ZIP -> Project/ProjectVersion -> source.zip en Object Storage -> extracción segura -> discovery/filter -> ts-morph/análisis de configuración -> inventario de tests -> chunks -> embeddings -> PostgreSQL/pgvector -> metadata -> COMPLETED|FAILED`.

## Fronteras de servicios de RAG Core

Los nombres siguientes expresan responsabilidades verificables, no la obligación de crear un módulo NestJS por cada elemento:

- Ingesta/versionado: `ProjectVersionsService`, `ZipValidationService`, `ObjectStorageService`, `JobsService`, `IndexingJobHandler` y `ZipExtractionService`.
- Análisis/indexación: `FileDiscoveryService`, `TypeScriptParserService`, `TestTargetExtractorService`, `ExistingTestResolverService`, `EmbeddingProvider`, `CodeChunksRepository` y `TestTargetsRepository`.
- Retrieval/contexto: `RetrievalService` recupera candidatos; `ContextBuilder` construye el contexto final. Su contrato definitivo está sujeto a `DEC-CHUNK-001` y `DEC-EMB-001`.
- Generación: `GapAnalyzer`, `PromptBuilder`, `LLMProvider` y las `GenerationStrategy` del producto/experimento.
- Validación: `TestExecutionService` orquesta y `SandboxExecutionService` adapta HTTP hacia el Sandbox; RAG Core interpreta el resultado sin perder sus evidencias.
- Artefactos: `ArtifactService` persiste y entrega archivos/diffs detrás de `ObjectStorageService`.
- Evolución posterior: gateway/event publisher y `RepairService`; no participan en el first-shot experimental.

El detalle vigente de cada responsabilidad pertenece al `plan.md` de la feature propietaria. Esta lista evita servicios monolíticos y no autoriza implementar features futuras por anticipado.

## Flujo de generación

`ProjectVersion congelada -> targets -> GenerationStrategy -> adquisición de contexto -> LLMProvider -> CREATE/MERGE -> Sandbox remoto -> ValidationResult -> artifacts/metrics`.

El producto normal utiliza RAG. El modo experimental posee dos brazos conceptuales: `RAG` y `GENERALIST_AGENT`. No se fija `TestContextStrategy` como única frontera porque el agente generalista puede necesitar un ciclo iterativo de búsqueda/lectura antes de generar. Ambos brazos convergen en la misma validación ciega del Sandbox.

## RAG

Target obligatorio + relaciones estructurales (V1 principalmente imports) + búsqueda vectorial cosine + deduplicación + scoring configurable + threshold/topK + token budget. `RetrievalService` recupera candidatos; `ContextBuilder` selecciona, ordena, etiqueta y ajusta el contexto final al presupuesto. El LLM recibe contenido de código, no vectores.

## Servicios externos

- PostgreSQL + pgvector en Supabase para datos de dominio, chunks, embeddings vectoriales y la cola DB-backed de jobs.
- Supabase Storage para snapshots y artefactos, accedido exclusivamente mediante la abstracción interna `ObjectStorageService`.
- LLMProvider y EmbeddingProvider abstractos; proveedor inicial OpenAI.
- `tjc-be-test-execution-sandbox` por HTTP interno.

## Asincronía

V1 usa POST 202 + polling. Estados se persisten. Mecanismo durable: cola DB-backed en PostgreSQL de Supabase (tabla `jobs`, despacho con `SELECT ... FOR UPDATE SKIP LOCKED`, reintentos con backoff, recuperación tras restart por polling del estado persistido); fire-and-forget en memoria está prohibido.

## Evolución

Sprint 3: WebSockets y autorreparación automática acotada. No se usa autorreparación en la comparación experimental RAG vs agente generalista.
