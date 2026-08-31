# 009-history-realtime-repair — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU20, HU21, HU22, HU23, HU24

## Objetivo

Evolucionar el producto con historial, push de estado, autorreparación acotada y reintento manual.

## Reglas y comportamiento

- Historial permite consultar runs anteriores sin alterar snapshots.
- WebSockets reemplaza polling progresivamente en Sprint 3; HTTP status/results siguen siendo contratos útiles/fallback.
- Autorepair: generate -> sandbox -> failure -> RepairContext -> LLM repair -> rerun, máximo configurable.
- RepairContext incluye test, fallo, stdout/stderr relevante, runnerResult y contexto original.
- Si se agotan intentos: revisión requerida; HU24 permite retry explícito.
- Autorepair nunca se activa en HU19 experimental.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
