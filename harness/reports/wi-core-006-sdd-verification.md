# WI-CORE-006 — Verificación de especificación y alcance
Modelo: sdd-analyst + contract-reviewer (consolidado por leader) · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low


## Alcance

Verificar y completar pruebas de la trazabilidad de la decisión de cada candidato RAG (HU05, HU15, HU17). El contrato INTEROP-2.6 §6.7 (`RagCandidateNodeResponse`, `RagContextTraceDetailResponse`, `configuration`, `discardReason` nulo solo si `SELECTED`) ya está aprobado y publicado, y `app/src` ya lo implementa (`context-builder.service.ts`, `experiment-job.handler.ts`, `context-traces.service.ts`).

## Decisiones

`DEC-RAG-001` (PENDING) solo bloquea un WI futuro de retrieval test-aware; no alcanza este WI. Sin otra decisión PENDING/PROPOSED aplicable. `decisionGate`: sin bloqueantes.

## Contrato

- `contract-reviewer`: APPROVED. Sin brecha de DTO ni semántica; la ruta vigente es `GET /context-traces/{traceId}` (la ruta anidada no existe en el contrato).
- No se cambia contrato ni se emite Contract Sync al outbox: el contrato ya está publicado y este corte solo agrega pruebas. `contractSyncPublished` no pasa (`G-NOT_RUN`) y queda como punto para el reviewer: si se juzga innecesario, requiere ajustar `publishesContract` en el registro.

## Corte aprobado (alcance autorizado por el usuario para esta sesión)

Solo pruebas: (a) 404 de `getContextTraceDetail`; (b) 500 por `discardReason` incoherente con `decision`; (c) fixture con `DISCARDED` y los tres motivos; (d) `makeRagDetail` con auditoría mixta; (e) bordes del builder (score igual al mínimo, empate, `TOKEN_BUDGET` seguido de candidato menor que cabe); (f) traza con `candidates: []`. Sin cambios de producto salvo defecto demostrado.

## Validación de selección

Contract Sync `start`: sin eventos relevantes pendientes (`CS-20260920-001` y `CS-20260921-003` clasificados `NOT_RELEVANT` solo para este WI).
