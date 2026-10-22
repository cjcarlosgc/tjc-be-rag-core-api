# WI-CORE-073 (WI-C) — verificación SDD del contrato de errores
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

**Estado: DECISION_REQUIRED.** El WI es suficiente para especificarse, pero hay decisiones de nombre, `retryable` y versión que son del usuario. No se editó nada más.

## Correcciones al alcance propuesto (importante)

- El WI dice que 401/403/404/405/406/415 salen «como 400». Es inexacto: el filtro conserva el **status** de la `HttpException` y solo fuerza `code = INVALID_REQUEST` (`app/src/common/filters/all-exceptions.filter.ts:54-86`). El problema real es el `code` engañoso (INVALID_REQUEST con status 401/404...), no el status.
- Peor: lo mismo ocurre con un `HttpException` 5xx sin `code` (p. ej. `ServiceUnavailableException`): sale `503 INVALID_REQUEST`, y el `message` es el texto crudo de la excepción (líneas 72-85), sin saneo.
- Los errores del parser de body (`app/src/request-body-parsers.ts:40-55`, `writeParserError` 59-80) se escriben fuera del filtro: 413 y 400 → `INVALID_REQUEST`, 401 → `AUTH_REQUIRED`. Ya conservan el 413.
- Core **nunca emite `retryable`** hoy (la interfaz `ErrorEnvelope` del filtro, líneas 14-22, ni lo declara).

## (1) Mapeo ACTUAL de estados no previstos (HttpException sin `code`)

| Estado | `code` actual | `retryable` | `message` actual | Origen |
|---|---|---|---|---|
| 401 | INVALID_REQUEST | ausente | texto de Nest ("Unauthorized"...) | filter.ts:77-85 |
| 403 | INVALID_REQUEST | ausente | texto de Nest ("Forbidden"...) | idem |
| 404 (ruta inexistente) | INVALID_REQUEST | ausente | "Cannot GET /x" | idem |
| 405 / 406 / 415 / 422 / 429 | INVALID_REQUEST | ausente | texto de Nest | idem |
| 409 | INVALID_REQUEST | ausente | texto de Nest | idem |
| 413 (JSON general / rutas de webhook) | INVALID_REQUEST (413) vía parser | ausente | "La solicitud no es válida." | request-body-parsers.ts:46-50 |
| 5xx `HttpException` sin código (502/503/504) | INVALID_REQUEST con status 5xx | ausente | texto crudo de la excepción | filter.ts:77-85 |
| Error no HttpException | INTERNAL_ERROR 500 | ausente | "Error interno del servidor." | filter.ts:88-96 |
| Con `code` (AppException) | el `code` tal cual | ausente | el del AppException | filter.ts:58-70 |

Específicos que no cambian: 401 `AUTH_REQUIRED`/`INVALID_ACCESS_TOKEN`, 403 `PROJECT_ROLE_INSUFFICIENT`..., 404 `*_NOT_FOUND`, 409 `*_NOT_FINISHED`/`IDEMPOTENCY_CONFLICT`, 422 `REASONING_EFFORT_UNSUPPORTED`, 503 `*_UNAVAILABLE`.

## (2) Tabla PROPUESTA (solo para HttpException/errores del framework SIN `code`)

`code` es **string abierto** en el esquema (`error-envelope.schema.json`: `type: string, minLength: 1`, sin enum) y en `ErrorEnvelope` de INTEROP §4 (`code: string`). Solo el enum TS interno `ErrorCode` (`app/src/common/errors/error-code.enum.ts`) y el tipo del filtro necesitan ampliarse. No hay cambio de esquema obligatorio: se propone solo mejorar las descripciones y añadir un ejemplo.

Nombres: se propone **alinear con los códigos genéricos que ya emite el Sandbox** (`tjc-be-test-execution-sandbox/app/src/common/http/http-exception.filter.ts:14-23`) para que los tres servicios hablen igual; añadiendo los que el Sandbox no tiene (`HTTP_ERROR` ya existe allí como fallback).

| Status | `code` | `retryable` | Mensaje por defecto (español, fijo, sin texto de la excepción) |
|---|---|---|---|
| 401 | UNAUTHORIZED | false | Se requiere una credencial válida. |
| 403 | FORBIDDEN | false | No tienes permiso para realizar esta operación. |
| 404 | NOT_FOUND | false | El recurso solicitado no existe. |
| 405 | METHOD_NOT_ALLOWED | false | El método HTTP no está permitido para esta ruta. |
| 406 | NOT_ACCEPTABLE | false | El servicio no puede responder en el formato solicitado. |
| 409 | CONFLICT | false | El estado actual del recurso no permite la operación. |
| 413 | PAYLOAD_TOO_LARGE | false | El cuerpo de la solicitud excede el límite permitido. |
| 415 | UNSUPPORTED_MEDIA_TYPE | false | El tipo de contenido no es compatible. |
| 422 | UNPROCESSABLE_ENTITY | false | La solicitud es reconocible pero no se puede procesar. |
| 429 | TOO_MANY_REQUESTS | true | Se superó el límite de solicitudes; reintenta más tarde. |
| 503 | SERVICE_UNAVAILABLE | true | El servicio no está disponible temporalmente. |
| 500/502/504 sin código | INTERNAL_ERROR | false | Error interno del servidor. |
| otro 4xx | HTTP_ERROR | false | La solicitud no pudo procesarse. |

Reglas: (a) un `code` explícito (AppException) **siempre gana** y nada de los códigos vigentes cambia; (b) 400 sin código sigue `INVALID_REQUEST` (validación DTO, incluida la lista `details` de mensajes, que se conserva); (c) para los genéricos el `message` es fijo y no refleja el texto de la excepción (evita filtrar internals / "Cannot GET ..."); `details: null` salvo 400; (d) 413 del parser pasa a `PAYLOAD_TOO_LARGE` (hoy `INVALID_REQUEST` 413), único cambio de código sobre un caso ya existente: ver riesgo R2.

Códigos vigentes (no se tocan): los 59 del enum `ErrorCode` (error-code.enum.ts:1-65), p. ej. `INVALID_REQUEST` (400 validación/DTO), `AUTH_REQUIRED`/`INVALID_ACCESS_TOKEN` (401), `PROJECT_ROLE_INSUFFICIENT` (403), `*_NOT_FOUND` (404), `*_NOT_FINISHED`/`IDEMPOTENCY_CONFLICT` (409), `*_UNAVAILABLE` (503), `INTERNAL_ERROR` (500). Colisión de nombres: ninguno de los genéricos propuestos existe hoy en Core; `GITHUB_*` de GH-INTEROP no se solapan.

## (3) Consumidores (solo lectura)

- **Console** (`tjc-fe-rag-developer-console/app/src/api/client.ts:4-16`): `ApiError(status, code, retryable?)`. Ningún código de producción depende de `INVALID_REQUEST` recibido de Core (solo lo fabrica localmente en `control-plane/api.ts:58-83` para validar antes de llamar). Decide por `status` (404/403 en `evidence/queries.ts:15`) y por códigos específicos (`CONTEXT_TRACE_NOT_FINISHED`, `IDEMPOTENCY_CONFLICT`). El status no cambia → sin impacto. Un `code` desconocido solo cae al `message` (ahora en español y claro: mejora).
- **GitHub Integration** (`app/src/github/internal-error.filter.ts:21-34`): ya aplica la política espejo (4xx no previstos → `INVALID_REQUEST` 400 no reintentable; 413 conservado). Core como cliente de GH (`github-app/github-integration.client.ts:43-50,222-246`) usa `CONTRACT_ERRORS` cerrado y rechaza `code` desconocidos: WI-C **no cambia lo que GH emite**, así que sin impacto. Observación: GH usa `INVALID_REQUEST` para sus 4xx no previstos (política distinta de la de Core propuesta aquí); GH-INTEROP no se toca en WI-C (ver R4).
- **Sandbox**: ya emite NOT_FOUND/FORBIDDEN/etc. (filter.ts:14-23,76-79). El cliente de Core lee solo el resultado de ejecución, no depende de `INVALID_REQUEST` de Core. Sin impacto; la propuesta alinea a Core con él.
- Clientes externos que dependieran de `code == INVALID_REQUEST` para 401/403/404 de Core: no hay evidencia en los tres repos.

## (4) Tesis Anexo E (C-01–C-10)

**No existe en `spec/` ni en `harness/reports/`.** Solo se menciona como requisito (`work-items.json`, `wi-core-073-scope.md`, `spec/transversal/errors/tasks.md`). No se inventa ni se cita. Decisión del usuario: aportar el texto o fijar que el WI lo cite por referencia sin transcribir; criterio de aceptación 1 no es verificable sin él.

## (5) Versión de INTEROP

INTEROP vigente 2.17. WI-C es aditivo y aclaratorio.

| Opción | Pros | Contras |
|---|---|---|
| **A. Una sola 2.18 con WI-D** (propuesta del WI) | Una ronda de Contract Sync y de importación; menos ruido en consumidores | Entre el cierre de WI-C y WI-D el canónico queda por delante de los espejos; WI-C sin `publishesContract` no cierra sincronía; si WI-D se retrasa o se descarta, el cambio de errores queda sin publicar; versión mezcla dos temas |
| B. 2.18 (WI-C) y 2.19 (WI-D) | Cada WI cierra y publica; trazabilidad limpia; consumidores pueden importar errores ya (Console gana mensajes claros) | Dos juegos CS y dos rondas por repo; ruido en espejos |

Recomendación: **A**, ya aprobada en la cola (criterio 3 del WI); con la salvedad de que WI-C no se da por «contrato sincronizado» hasta WI-D. B si el usuario quiere cerrar el tag `arch-v1.0` sin esperar WI-D. **Decisión del usuario.**

## (6) Pruebas

Existentes que fijan lo actual:
- `app/src/common/filters/all-exceptions.filter.spec.ts:59-69` («maps a generic HttpException to INVALID_REQUEST»): sigue válido solo para 400 (BadRequestException) → se mantiene.
- `:71-77` (NotFoundException conserva status): se extiende para exigir `NOT_FOUND`.
- `all-exceptions.filter.contract.spec.ts:22-34`: `ForbiddenException('prohibido')` sigue validando el esquema; el mensaje cambia a fijo.
- `app/src/request-body-parsers.spec.ts:60` (`ordinary.body.code` = INVALID_REQUEST): revisar la rama 413 si cambia a `PAYLOAD_TOO_LARGE`.
- e2e `app/test/projects.e2e-spec.ts:74,85,198` (400 INVALID_REQUEST de validación): sin cambio.
- `retrieval-comparisons.http.spec.ts:181`: 400 de validación; sin cambio (confirmar).

Nuevas: tabla `it.each` en el filtro por (401,403,404,405,406,409,413,415,422,429,503,502,otro 4xx) → `code`/`retryable`/mensaje fijo, sin eco del texto de la excepción; AppException con `code` explícito intacto (también con status 404/409/503); 5xx sin código no devuelve `INVALID_REQUEST` y no filtra el mensaje; cada caso valida con `validateContract('error-envelope.schema.json')`; ruta inexistente e2e → `404 NOT_FOUND`, método incorrecto → 405, `Content-Type` incorrecto → 415; ejemplo nuevo `error-envelope.generic.json` registrado en `examples/manifest.json` y verificado por contract tests; `contracts:check` (`app/package.json:30`) en verde. Gate de contrato: el esquema no cambia en estructura (solo descripciones), así que regenerar tipos no debe producir diff funcional.

## (7) Decisiones PENDING/PROPOSED con Blocks que alcancen este WI

Ninguna hallada: `spec/` solo registra DEC-INF-001 (APROBADO) y DEC-INF-002 (aprobada en SYSTEM-2.12) sobre infraestructura; DEC-TRACE-001/002, DEC-PHP-ROOT-001, DEC-FK-005 y DEC-VAL-* no tocan errores genéricos. No existe un DEC específico de errores: se recomienda registrar uno nuevo (p. ej. `DEC-ERR-001`, PROPOSED) con las decisiones de abajo, si el usuario quiere trazabilidad normativa.

## (8) Riesgos, opciones y recomendación

- R1 Nombres: opción A (alinear con Sandbox, recomendada) vs B (prefijo `HTTP_*`/`ROUTE_NOT_FOUND`). A da coherencia entre servicios; B evita confundir `NOT_FOUND` de ruta con 404 de recurso, pero se diferencia por el `status`/`message`. **Decisión del usuario.**
- R2 413: cambiar `INVALID_REQUEST` 413 → `PAYLOAD_TOO_LARGE` rompe a quien matche ese par (GH-INTEROP lo lista como `INVALID_REQUEST` 400/413 para su propio servicio; Core envía a GH, no al revés, y GH webhook→Core 413 solo lo ve GH). Opción segura: dejar los errores del parser intactos en WI-C. Recomendado: **no tocar el parser** (menor riesgo); la tabla aplica solo al filtro.
- R3 `retryable`: Core no lo emite. Opción 1 (recomendada): emitirlo solo en los genéricos (true en 429/503) y dejar ausente en el resto (campo opcional). Opción 2: emitirlo en todos los errores de Core (más amplio, rompe el alcance «solo genéricos»). Opción 3: no emitirlo. **Decisión del usuario.**
- R4 Divergencia con GH: GH colapsa 4xx no previstos a `INVALID_REQUEST`; Core propondría códigos específicos. Es una política distinta entre servicios; documentarlo en INTEROP §4 sin tocar GH-INTEROP. Aceptable (criterio dice «sin romper»).
- R5 `message` fijo pierde el detalle (p. ej. qué header faltó): mitigado conservando `details` solo en 400.
- R6 5xx con código oculto: cambiar `503 INVALID_REQUEST` por `SERVICE_UNAVAILABLE` corrige un código claramente erróneo; el caso 500/502/504 pasa a `INTERNAL_ERROR`.
- R7 Anexo E ausente (sección 4).

**Recomendación:** aprobar el alcance con: nombres alineados con Sandbox (R1-A), `retryable` solo en los genéricos (R3-1), parser sin tocar (R2), INTEROP-2.18 única con WI-D (5-A), mensajes fijos en español, esquema sin cambio estructural (solo descripciones + ejemplo `error-envelope.generic.json`), texto del Anexo E aportado por el usuario. Archivos esperados: `all-exceptions.filter.ts` y su spec/contract spec, `error-code.enum.ts`, `interoperability-contract.md` (§4 y cabecera), `error-envelope.schema.json`, `examples/` y `manifest.json`, `spec/transversal/errors/{spec,tasks}.md`, tipos generados.

## Lo que requiere decisión del usuario

1. Nombres de los códigos (R1). 2. `retryable` (R3). 3. Tocar o no el parser/413 (R2). 4. Versión 2.18 única vs 2.18/2.19 (5). 5. Texto del Anexo E (4). 6. Registrar `DEC-ERR-001` (7).
