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
- La integración usa el contrato asíncrono Core↔Sandbox `INTEROP-1.6`. Core genera una `EphemeralDownloadRef` de vida corta para el snapshot y los artefactos necesarios; el Sandbox devuelve hechos y Core calcula `valid`, `FailureType` y persiste el resultado del producto.
- Core envía `Authorization: Bearer` con `SANDBOX_SERVICE_TOKEN` en POST y GET de `/executions`. Si `SANDBOX_URL` existe, el token también debe existir y validarse al arranque; jamás se entrega al frontend ni al container.
- Cada subejecución usa un `requestId`/`Idempotency-Key` UUID v5 estable conforme a `DEC-IDEMP-001`, derivado del job durable y la unidad lógica. Un retry HTTP reutiliza esa identidad; nunca genera una key aleatoria nueva.
- V1 solo envía al Sandbox proyectos con `pnpm-lock.yaml`; una incompatibilidad se expone como `UNSUPPORTED_PACKAGE_MANAGER`.
- El Sandbox no recibe credenciales Supabase/DB ni escribe directamente en PostgreSQL. Core no persiste ni registra completa la URL firmada.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.

## Cierre de la brecha de implementación SDD 1.14

Resuelto en SDD 1.15 del lado de Core: `SandboxExecutionService` envía `Authorization: Bearer <SANDBOX_SERVICE_TOKEN>` en las tres llamadas a `/executions`, y `requestId`/`Idempotency-Key` es ahora un UUID v5 estable derivado del `jobId` (`sandbox-request-id.util.ts`), reutilizado en cualquier retry en vez de un UUID aleatorio por intento. La integración real de extremo a extremo contra el Sandbox desplegado sigue pendiente — eso es validación cross-repo, no una tarea de código de Core.
