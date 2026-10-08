# WI-CORE-005 — HNSW desestimado (2026-10-08)

Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Autoriza:** usuario, en chat desde la sesión Core.

## Decisión
- HNSW se desestima para el alcance actual. Se mantiene la búsqueda vectorial exacta sobre pgvector, sin índice ANN dedicado (`DEC-VEC-001`, `spec/transversal/persistence/spec.md`).
- No hay spike, implementación, umbrales (recall@10, latencia p95) ni parámetros de aceptación.
- No se accede ni modifica Supabase por este motivo; no se requiere base sintética.
- Razón: no hay evidencia de que volumen o latencia lo justifiquen, y una búsqueda aproximada añadiría una variable a la evaluación experimental del RAG.
- Reapertura: solo con métricas reales de volumen, latencia o escalabilidad, mediante una decisión y un WI nuevos.
- No altera chunking, embeddings ni las reindexaciones necesarias por cambios de representación de chunks; cualquier inventario sobre datos reales es de solo lectura y requiere autorización.

## Cambios
`WI-CORE-005` → `W-CANCELLED`; `ST-CORE-005` → `T-CANCELLED`; retiradas las referencias pendientes en `tasks.md` (002 y persistence), `roadmap.md`, `harness/progress/current.md`; entrada en `CHANGELOG.md`. Ningún WI depende de WI-CORE-005.

## Impacto contractual
`spec/contracts/*` no contiene referencias a HNSW ni a índices vectoriales; la API pública no cambia (la búsqueda exacta ya es el comportamiento vigente). Puramente interno a Core: Console y GitHub Integration sin cambios y sin Contract Sync.
