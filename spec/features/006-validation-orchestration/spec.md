# 006-validation-orchestration — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU13, HU14

## Objetivo

Orquestar la validación mediante el endpoint configurable del Sandbox —local temporal o remoto futuro— y normalizar el resultado para el producto.

## Reglas y comportamiento

- Solo validar artefactos creados/modificados del run actual; full regression queda futuro.
- En modos de proyecto, validar targets y luego batch de artefactos actuales cuando aplique.
- `validation.valid=false` es resultado de negocio/técnico normal, no HTTP 5xx.
- FailureType: NONE, COMPILATION, TEST_ASSERTION, TEST_RUNTIME, DEPENDENCY, CONFIGURATION, INFRASTRUCTURE, UNKNOWN.
- 503 solo cuando la plataforma no puede iniciar/usar dependencia; fallos luego del 202 se persisten.
- La integración usa el contrato asíncrono Core↔Sandbox `INTEROP-1.1`. Core genera una `EphemeralDownloadRef` de vida corta para el snapshot y los artefactos necesarios; el Sandbox devuelve hechos y Core calcula `valid`, `FailureType` y persiste el resultado del producto.
- El Sandbox no recibe credenciales Supabase/DB ni escribe directamente en PostgreSQL. Core no persiste ni registra completa la URL firmada.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
