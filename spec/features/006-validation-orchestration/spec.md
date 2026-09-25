# 006-validation-orchestration — Especificación

**Estado:** vigente para la validación de propuestas del `AnalysisRun`; prueba end-to-end contra Sandbox desplegado pendiente y fuera de este corte.
**Historias:** HU11, HU13

## Objetivo

Orquestar la validación mediante el endpoint configurable del Sandbox —local temporal o remoto futuro— y normalizar el resultado para el producto.

## Reglas y comportamiento

- Solo validar propuestas y archivos de prueba creados/modificados del `AnalysisRun` vigente; full regression queda fuera de este alcance.
- Validar únicamente propuestas y targets del `AnalysisRun` vigente, sin un modo manual de proyecto.
- `validation.valid=false` es resultado de negocio/técnico normal, no HTTP 5xx.
- FailureType: NONE, COMPILATION, TEST_ASSERTION, TEST_RUNTIME, DEPENDENCY, CONFIGURATION, INFRASTRUCTURE, UNKNOWN.
- 503 solo cuando la plataforma no puede iniciar/usar dependencia; fallos luego del 202 se persisten.
- La integración usa el contrato asíncrono Core↔Sandbox `INTEROP-2.4`. Core genera una `EphemeralDownloadRef` de vida corta para el snapshot interno y las pruebas candidatas; el Sandbox devuelve hechos y Core calcula la clasificación y persiste el resultado del producto.
- Core envía `Authorization: Bearer` con `SANDBOX_SERVICE_TOKEN` en POST y GET de `/executions`. Si `SANDBOX_URL` existe, el token también debe existir y validarse al arranque; jamás se entrega al frontend ni al container.
- Cada subejecución usa un `requestId`/`Idempotency-Key` UUID v5 estable conforme a `DEC-IDEMP-001`, derivado del job durable y la unidad lógica. Un retry HTTP reutiliza esa identidad; nunca genera una key aleatoria nueva.
- V1 solo envía al Sandbox proyectos con `pnpm-lock.yaml`; una incompatibilidad se expone como `UNSUPPORTED_PACKAGE_MANAGER`.
- El Sandbox no recibe credenciales Supabase/DB ni escribe directamente en PostgreSQL. Core no persiste ni registra completa la URL firmada.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.

La implementación de Core envía `Authorization: Bearer <SANDBOX_SERVICE_TOKEN>` a `/executions` y deriva `requestId`/`Idempotency-Key` UUID v5 del job. La verificación live de extremo a extremo contra Sandbox desplegado sigue pendiente; no se modifica el repositorio Sandbox mientras lo mantiene otro desarrollador.
