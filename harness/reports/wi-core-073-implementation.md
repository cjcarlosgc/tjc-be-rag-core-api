# WI-CORE-073 (WI-C) — implementación: códigos genéricos del error envelope
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Informe del implementer (transcrito por el leader). Alcance aprobado por el usuario: `wi-core-073-scope-approval.md`.

## Qué cambió

1. **Filtro** `app/src/common/filters/all-exceptions.filter.ts`: HttpException sin `code` propio → código genérico con el estado HTTP conservado: 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 405 `METHOD_NOT_ALLOWED`, 406 `NOT_ACCEPTABLE`, 409 `CONFLICT`, 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 422 `UNPROCESSABLE_ENTITY`, 429 `TOO_MANY_REQUESTS` (retryable true), 503 `SERVICE_UNAVAILABLE` (retryable true); 500/502/504 y otros 5xx sin código → `INTERNAL_ERROR`; otro 4xx → `HTTP_ERROR`; 400 sin código sigue `INVALID_REQUEST` con mensaje/details de validación; un `code` de `AppException` prevalece y se devuelve tal cual (sin `retryable`). Mensaje fijo en español, `details: null`, nunca el texto de la excepción (la excepción sigue yendo a log en 5xx). Los errores que no son HttpException no cambian.
2. **Enum** `error-code.enum.ts`: 12 códigos nuevos; ninguno existente cambia.
3. **Esquema** `error-envelope.schema.json`: solo descripciones; `code` sigue string abierto; `retryable` y `phase` opcionales. Ejemplo nuevo `examples/error-envelope.generic.json` (429, retryable true) en `manifest.json`. Tipos regenerados (`pnpm contracts:generate`; diff solo de descripciones).
4. **Contrato** `interoperability-contract.md`: INTEROP-2.18 (cabecera, fecha 2026-10-19, 2.17 pasa a «fue»); §4 con `retryable?` actualizado y nueva §4.1 (tabla de genéricos, precedencia, 400 sin cambio, parser sin cambio, nombres alineados con Sandbox, Anexo E solo por referencia). `spec/README.md` línea 5 → INTEROP-2.18. `spec/transversal/errors/spec.md`: regla nueva y `DEC-ERR-001` (PROPOSED, `Blocks: NONE`, formato de DEC-JOBS-001/DEC-EMB-001). `CHANGELOG.md`: entrada en [Unreleased].
5. **Pruebas:** `all-exceptions.filter.spec.ts` (404 ahora `NOT_FOUND`; it.each por estado con código, retryable, mensaje fijo y sin eco; AppException conserva su código; 5xx sin código ≠ `INVALID_REQUEST`; otro 4xx → `HTTP_ERROR`), `all-exceptions.filter.contract.spec.ts` (mensaje fijo de Forbidden; genéricos validados contra el esquema; `retryable` solo en genéricos; ejemplo canónico), e2e nuevo `app/test/error-envelope.e2e-spec.ts` (5 casos: 404 por ruta inexistente, 404 por método no registrado, 403, 503 retryable, 500). 405 y 415 solo en unit: Nest/Express responden 404 ante método no registrado y no hay 415 sin parser propio.

## Evidencia (desde `app/`, Node 22)

| Comando | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm build` | OK |
| `pnpm contracts:check` | exit 0 |
| `pnpm test` | 155 archivos pasan; 2557 tests pasan, 104 omitidos (antes 2527, +30) |
| `pnpm test:e2e` (placeholders de entorno, sin secretos reales) | 8 archivos, 251 tests pasan, incluidos los 5 nuevos |
| `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs` | OK (74 WI) |

## Puntos de gobierno señalados

1. El enum tenía **62** códigos, no 59 como decía el informe SDD y el alcance aprobado; ninguno cambió (errata registrada en `wi-core-073-scope-approval.md`).
2. Los errores que no son HttpException (catch-all) siguen sin `retryable`; no es un código genérico aprobado.
3. `DEC-ERR-001` quedó en `spec/transversal/errors/spec.md` y no en `system-contract.md` (hacerlo exigiría SYSTEM-2.14, no aprobado), con `Blocks: NONE`.
4. Referencias de versión «INTEROP-2.17» no tocadas por ser históricas o por exigir bump ajeno: `system-contract.md` (SYSTEM-2.13), `github-integration-contract.md` (GH-INTEROP-1.8 cita «INTEROP-2.17 §4» como forma del envelope), `sandbox-execution.schema.json` y comentarios de código. Se revisan en WI-D o en un bump de GH-INTEROP.
5. Console, GitHub Integration y Sandbox siguen en INTEROP-2.17 hasta el Contract Sync de WI-D.
