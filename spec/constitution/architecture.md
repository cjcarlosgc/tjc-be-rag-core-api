# Arquitectura

**Estado:** aprobado con decisiones PENDING explícitas

## Flujo de indexación

`ZIP -> Project/ProjectVersion -> source.zip en Object Storage -> extracción segura -> discovery/filter -> ts-morph/config parsers -> inventario de tests -> chunks -> embeddings -> PostgreSQL/pgvector -> metadata -> COMPLETED|FAILED`.

## Flujo de generación

`ProjectVersion congelada -> targets -> TestContextStrategy -> PromptBuilder -> LLMProvider -> CREATE/MERGE -> Sandbox remoto -> ValidationResult -> artifacts/metrics`.

`TestContextStrategy` posee dos implementaciones: `RagContextStrategy` y `BaselineContextStrategy`.

## RAG

Target obligatorio + relaciones estructurales (V1 principalmente imports) + búsqueda vectorial cosine + deduplicación + scoring configurable + threshold/topK + token budget. El LLM recibe contenido de código, no vectores.

## Servicios externos

- PostgreSQL + pgvector.
- Object Storage abstracto para snapshots y artefactos.
- LLMProvider y EmbeddingProvider abstractos; proveedor inicial OpenAI.
- `tjc-be-test-execution-sandbox` por HTTP interno.

## Asincronía

V1 usa POST 202 + polling. Estados se persisten. **PENDING:** seleccionar el mecanismo durable de jobs (DB-backed queue vs Redis/RabbitMQ u otro) antes de implementar workers; fire-and-forget en memoria está prohibido.

## Evolución

Sprint 3: WebSockets y autorreparación automática acotada. No se usa autorreparación en la comparación experimental RAG vs baseline.
