# Arquitectura

**Contratos compartidos:** SYSTEM-1.5 / INTEROP-1.5

**Estado:** aprobado con decisiones PENDING explícitas

## Topología de la solución

La arquitectura base se materializa en tres proyectos, dos backend y uno frontend:

`tjc-fe-rag-developer-console -> tjc-be-rag-core-api -> tjc-be-test-execution-sandbox`.

- Developer Console: cliente web de referencia; no llama directamente al Sandbox.
- RAG Core API: indexación, retrieval, construcción de contexto, generación, experimentación, orquestación y persistencia de métricas.
- Test Execution Sandbox: ejecución aislada de Jest/Vitest y devolución de hechos objetivos; no conoce si una ejecución provino de RAG o del agente generalista.

## Flujo de indexación

`ZIP -> Project/ProjectVersion -> original.zip privado en Object Storage -> extracción segura -> discovery/filter -> ts-morph/análisis de configuración -> inventario de tests -> chunks -> embeddings -> PostgreSQL/pgvector -> metadata -> COMPLETED|FAILED`.

## Fronteras de servicios de RAG Core

Los nombres siguientes expresan responsabilidades verificables, no la obligación de crear un módulo NestJS por cada elemento:

- Ingesta/versionado: `ProjectVersionsService`, `ZipValidationService`, `ObjectStorageService`, `JobsService`, `IndexingJobHandler` y `ZipExtractionService`.
- Análisis/indexación: `FileDiscoveryService`, `TypeScriptParserService`, `TestTargetExtractorService`, `ExistingTestResolverService`, `EmbeddingProvider`, `CodeChunksRepository` y `TestTargetsRepository`.
- Retrieval/contexto: `RetrievalService` recupera candidatos; `ContextBuilder` construye el contexto final. Su contrato definitivo queda fijado por `DEC-CHUNK-001` (`002-project-version-indexing/spec.md`) y `DEC-EMB-001` (`transversal/providers/spec.md`), ambas `APROBADO`; pendiente de implementación en `004-rag-retrieval-context`.
- Generación: `GapAnalyzer`, `PromptBuilder`, `LLMProvider` y las `GenerationStrategy` del producto/experimento.
- Validación: `TestExecutionService` orquesta y `SandboxExecutionService` adapta HTTP hacia el Sandbox; RAG Core interpreta el resultado sin perder sus evidencias.
- Artefactos: `ArtifactService` persiste y entrega archivos/diffs detrás de `ObjectStorageService`.
- Tiempo real y reintento: `RealtimeGateway` publica progreso y `RetryTargetJobHandler` permite un reintento manual desde cero. No existe `RepairService` ni corrección automática vía LLM.

El detalle vigente de cada responsabilidad pertenece al `plan.md` de la feature propietaria. Esta lista evita servicios monolíticos y no autoriza implementar features futuras por anticipado.

## Flujo de generación

`ProjectVersion congelada -> targets -> GenerationStrategy -> adquisición de contexto -> LLMProvider -> CREATE/MERGE -> Sandbox local temporal o remoto futuro -> ValidationResult -> artifacts/metrics`.

El producto normal utiliza RAG. El modo experimental posee dos brazos conceptuales: `RAG` y `GENERALIST_AGENT`. No se fija `TestContextStrategy` como única frontera porque el agente generalista puede necesitar un ciclo iterativo de búsqueda/lectura antes de generar. Ambos brazos convergen en la misma validación ciega del Sandbox.

## RAG

Target obligatorio + relaciones estructurales (V1 principalmente imports) + búsqueda vectorial cosine + deduplicación + scoring configurable + threshold/topK + token budget. `RetrievalService` recupera candidatos; `ContextBuilder` selecciona, ordena, etiqueta y ajusta el contexto final al presupuesto. El LLM recibe contenido de código, no vectores.

## Servicios externos

- PostgreSQL + pgvector en Supabase para datos de dominio, chunks, embeddings vectoriales y la cola DB-backed de jobs.
- Supabase Storage privado para snapshots y artefactos, accedido exclusivamente por RAG Core mediante la abstracción interna `ObjectStorageService`.
- Para ejecutar, Core convierte la `snapshotKey` interna en una URL firmada de vida corta y la entrega al host Sandbox junto con SHA-256 y tamaño. La URL no se persiste ni se registra completa.
- El Sandbox descarga el ZIP sin credenciales Supabase, ejecuta en un workspace efímero y devuelve hechos estructurados. RAG Core interpreta y persiste el estado y resultado autoritativos.
- V1 ejecuta únicamente snapshots con `pnpm-lock.yaml`, usando pnpm y lockfile congelado conforme a la decisión local `DEC-SBX-002` del Sandbox.
- LLMProvider y EmbeddingProvider abstractos; proveedor inicial OpenAI.
- `tjc-be-test-execution-sandbox` por HTTP interno.

## Entornos del Sandbox

- Desarrollo y prevalidación actuales: MacBook del desarrollador encendida, Docker Desktop activo y su VM Linux como motor de containers efímeros.
- Destino previsto: VM Linux remota con Docker Engine.
- `DEC-INF-001` mantiene `PENDING` la selección del proveedor remoto, priorizando alternativas gratuitas que cumplan las restricciones técnicas. No bloquea el entorno local: se confirma que Docker Desktop local es suficiente para desarrollo/prevalidación durante Sprint 2-4; la selección del proveedor remoto se revisita después de cerrar Sprint 4.
- La URL del Sandbox es configuración de RAG Core; cuando existe, Core requiere `SANDBOX_SERVICE_TOKEN` y envía `Authorization: Bearer` en cada llamada `/executions`. El token opaco se comparte solo mediante configuración segura de host y nunca alcanza frontend ni containers.

## Asincronía

V1 usa POST 202 + polling y WebSockets como complemento para progreso. Estados se persisten. Mecanismo durable: cola DB-backed en PostgreSQL de Supabase (tabla `jobs`, despacho con `SELECT ... FOR UPDATE SKIP LOCKED`, reintentos con backoff, recuperación tras restart por polling del estado persistido); fire-and-forget en memoria está prohibido. Las operaciones de creación/reintento reservan su `Idempotency-Key` y su job de forma atómica o recuperable; las subejecuciones hacia Sandbox conservan un UUID v5 estable según `DEC-IDEMP-001`.

## Alcance definitivo de validación

Una generación validada produce una sola ejecución Sandbox por target/intento lógico. Un fallo queda registrado como `INVALID`/`FAILED`; HU23 y la autorreparación automática vía LLM están descartadas. HU24 permite únicamente un nuevo intento manual explícito desde cero, con identidad idempotente propia.
