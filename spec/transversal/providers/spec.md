# providers — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** capacidad técnica transversal

## Objetivo

Desacoplar LLM y embeddings de un proveedor concreto.

## Reglas y comportamiento

- La lógica de indexación/retrieval depende de `EmbeddingProvider`, no del SDK o los DTO de un proveedor concreto.
- `text-embedding-3-small` queda aprobado como default provisional para mantener estable la configuración y documentación actuales; no constituye una conclusión de superioridad para code retrieval.
- `voyage-code-4` se conserva como candidato explícito por evaluar antes de fijar el modelo definitivo.
- La selección definitiva del modelo y su dimensionalidad se resuelven juntas; no se congela 1536 como decisión independiente si cambia el modelo.
- PostgreSQL + pgvector en Supabase permanece aprobado independientemente del proveedor/modelo elegido.

### DEC-EMB-001 — Modelo definitivo de embeddings

**Estado:** PENDING

**Default provisional aprobado:** `text-embedding-3-small`

**Candidato:** `voyage-code-4`

**Blocks:** implementación definitiva de embeddings/vector query en `004-rag-retrieval-context` y cualquier migración que consolide modelo/dimensionalidad para producción o experimento; no bloquea tareas no relacionadas

**Pregunta:** justo antes del work item bloqueado, elegir humanamente entre mantener `text-embedding-3-small`, cambiar a `voyage-code-4` o adoptar otra opción respaldada por evidencia técnica. Resolver en la misma decisión dimensionalidad, compatibilidad de pgvector, reindexación y configuración.

El implementador no debe seleccionar silenciosamente el modelo final ni transformar la comparación de embeddings en una nueva pregunta de investigación de la tesis.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
