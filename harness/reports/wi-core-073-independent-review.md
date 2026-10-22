# WI-CORE-073 (WI-C) — revisión independiente (ciclo 1/2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Alcance revisado: comportamiento y código del commit 6723832 (el contrato lo revisa contract-reviewer, `wi-core-073-contract-review.md`).

## Veredicto: APPROVED (sin bloqueos)

## Verificaciones

1. Filtro `app/src/common/filters/all-exceptions.filter.ts`: el mapeo coincide con la tabla aprobada (401, 403, 404, 405, 406, 409, 413, 415, 422; 429 y 503 con `retryable: true`; resto de 5xx → `INTERNAL_ERROR`; otro 4xx → `HTTP_ERROR`). El estado HTTP se conserva. El 400 sin código sigue como `INVALID_REQUEST` con `details`. Un `code` explícito de `AppException` se evalúa antes y prevalece, y no emite `retryable`. El mensaje genérico es fijo y `details` es `null`. Ni `message`, ni `details`, ni las cabeceras repiten el texto de la excepción. El log de 5xx usa método, url, código, correlationId y stack, como antes. Los errores no-HttpException quedan igual (500 `INTERNAL_ERROR`, sin `retryable`).
2. Compatibilidad hacia atrás: no queda ningún consumidor que dependa de `code === 'INVALID_REQUEST'` para 401/403/404. Los usos de `INVALID_REQUEST` en `app/src` y `app/test` son `AppException` explícitas o 400 de validación, que no cambian. `github-integration.client.ts` tiene su propio enum, no es el filtro. `pnpm test` completo: 155 archivos y 2557 tests pasan, 104 omitidos.
3. `app/src/request-body-parsers.ts` sin cambios en el commit (diff vacío). El enum conserva los 62 códigos previos: el diff contra 6723832~1 solo añade 12 líneas y no elimina ni modifica ninguna.
4. Mutaciones sobre el filtro (todas detectadas, filtro restaurado):

   | Mutación | Resultado |
   |---|---|
   | 429 con `retryable` false | 2 tests fallan |
   | 404 → `INVALID_REQUEST` | 2 fallan en unit y 2 en el e2e nuevo |
   | mensaje = `exception.message` | 18 fallan |
   | otro 4xx / 5xx → `HTTP_ERROR` | 3 fallan |
   | mensaje de 403 alterado | 2 fallan |

5. Sin cambios fuera de alcance: `git show --stat` solo toca el filtro, el enum, las pruebas, los tipos generados, spec/contratos y reportes. No hay DTO, migraciones ni otros módulos.

## Ejecuciones (desde `app/`, Node 22)
- `pnpm lint` exit 0, `pnpm build` OK, `pnpm contracts:check` exit 0.
- `pnpm test`: 2557 pasan.
- e2e nuevo `test/error-envelope.e2e-spec.ts`: 5/5 pasan sin variables de entorno. La suite e2e completa no pudo correr aquí: los otros 3 archivos (access-matrix, access-webhooks, github-identity) exigen variables de entorno de `EnvironmentVariables` y no se configuraron. El implementer reporta 251 tests pasando con placeholders. Esto es una limitación de mi entorno, no un hallazgo.
- Validadores de la raíz: `sdd-check`, `validate-work-items`, `validate-harness` y `validate-completions` pasan.

## Hallazgos
- Menor / informativo (sin acción obligatoria): `all-exceptions.filter.ts` (rama final de `buildEnvelope`) no emite `retryable` en errores no-HttpException. Está documentado como decisión del implementer (punto 2 de gobierno) y es coherente con el alcance aprobado.
- Menor / informativo: un `HttpException` con `code` explícito en un cuerpo que no es de `AppException` devuelve ese valor sin validarlo contra el enum. Es el comportamiento previo y no es regresión.

## Blockers
Ninguno.

## Estado del árbol
Todas las mutaciones se restauraron. `git status` solo muestra los informes de revisión de este ciclo (este informe y el de contract-reviewer). El código y `state.json` no se modificaron.

## recommendedNextStep
Cerrar la revisión independiente como aprobada, tras recibir el veredicto de contract-reviewer.
