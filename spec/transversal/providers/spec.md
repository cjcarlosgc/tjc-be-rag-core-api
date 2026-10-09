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


## ESC-MOD-01 — paridad de `LLMProvider` (SDD 2026-10-08; implementación pendiente)

ESC-MOD-01 evalúa solo `LLMProvider`; no incluye embeddings. RAG y `GENERALIST_AGENT` invocan al LLM a través de la abstracción `LLMProvider`; el SDK de OpenAI no se filtra al dominio ni a los servicios de generación o del agente. Cambiar de proveedor no altera retrieval, Sandbox ni contratos HTTP, y no hay selector permanente en la interfaz. Ambos brazos resuelven una única configuración efectiva (proveedor, modelo y versión, esfuerzo de razonamiento y parámetros comunes); el razonamiento no se degrada en silencio. Métricas de cierre: M1 = 0 archivos fuera del adaptador y la configuración permitidos; M2 = 0 cambios de contrato; M3 = 100 % de pruebas aplicables en verde. No se crea `arch-v1.0` ni se inventa un segundo proveedor concreto. Implementación: `WI-CORE-023`.

## WI-CORE-031 — llamadas del proveedor LLM por `/v1/responses` (aprobado 2026-10-09)

Todas las llamadas del adaptador OpenAI (experimentos y producto) usan `/v1/responses`, sin estado (`store=false`, sin `previous_response_id`) y devolviendo los ítems de razonamiento cifrados en cada turno. El parámetro `reasoning` se omite en modelos sin razonamiento y el esfuerzo no soportado sigue fallando con `REASONING_EFFORT_UNSUPPORTED`, sin degradar en silencio. El endpoint efectivo es interno (`modelConfig`); no cambia el contrato. Detalle en `plan.md`.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
