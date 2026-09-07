# observability — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Producir trazas suficientes para depurar indexación, retrieval, generación, sandbox y experimentos sin exponer secretos/código innecesario.

## Reglas y comportamiento

- Correlacionar operaciones mediante IDs técnicos estables, sin registrar secretos ni contenido de código salvo necesidad explícita y acotada.
- Redactar `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DATABASE_PASSWORD`, headers de autorización y URLs firmadas completas.
- Para una URL firmada solo puede registrarse metadata no sensible —por ejemplo tipo de recurso, expiración o hash—, nunca query string/token.
- Acotar stdout/stderr y artifacts de ejecución; Sandbox devuelve evidencia factual según `INTEROP-1.5` y Core decide qué persiste.
- Puede registrarse la identidad idempotente/correlation id para trazabilidad, pero nunca la huella completa del payload si expone contenido, ni el valor de `SANDBOX_SERVICE_TOKEN` o el header `Authorization`.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
