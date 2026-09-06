# providers — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** capacidad técnica transversal

## Objetivo

Desacoplar LLM y embeddings de un proveedor concreto.

## Reglas y comportamiento

- La lógica de indexación/retrieval depende de `EmbeddingProvider`, no del SDK o los DTO de un proveedor concreto.
- `text-embedding-3-small` queda aprobado como modelo definitivo de V1, con dimensionalidad `1536`. Es una elección pragmática para desbloquear Sprint 2, no una conclusión de superioridad para code retrieval.
- `voyage-code-4` se conserva documentado como candidato para una reevaluación futura con evidencia del experimento; no bloquea nada mientras tanto.
- PostgreSQL + pgvector en Supabase permanece aprobado independientemente del proveedor/modelo elegido.

### DEC-EMB-001 — Modelo definitivo de embeddings

**Estado:** APROBADO

**Resolución:** se mantiene `text-embedding-3-small` como modelo definitivo de V1, dimensionalidad `1536` sin cambios respecto al provisional. `voyage-code-4` sigue documentado como candidato para una reevaluación posterior si el experimento aporta evidencia que lo justifique; no es una decisión pendiente ni bloquea nada.

El implementador no debe reabrir la comparación de embeddings como una nueva pregunta de investigación de la tesis sin una decisión humana explícita que lo pida.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
