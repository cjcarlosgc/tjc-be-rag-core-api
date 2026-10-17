# WI-CORE-022 — Resultados de una comparación de retrieval FAILED
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

## Veredicto: DECISION_REQUIRED (el contrato no lo resuelve por texto ni por patrón)

## Evidencia
- INTEROP §5 (líneas 93-95): resultados antes de estado terminal -> `409 *_NOT_FINISHED`; `FAILED` conserva código/mensaje y timestamps. No dice qué devuelve `/results` en `FAILED`.
- §6.15 (1043): `200 RetrievalComparisonResultsResponse`; 409 solo "antes de un estado terminal". `FAILED` es terminal (RetrievalComparisonStatus y §6.16 línea 1135 lo declaran terminal), por lo que la opción (b) 409 contradice el texto.
- `RetrievalComparisonResultsResponse` (1120-1127) NO tiene `failureCode`/`failureMessage`, `completedAt` es no nulo y `modes` está comentado "exactamente SE y SEM". La implementación actual (`retrieval-comparisons.service.ts` getResults) devuelve 200 con `modes: []` y `completedAt` rellenado con `new Date()` si es null: viola el comentario del tipo y fabrica un timestamp. La opción (a) tal como se pregunta (con failureCode) exigiría campos que el DTO no define.
- Patrón experimentos (§6.5, 236): "`200` al completar"; la implementación devuelve 200 también en `FAILED` (resultados parciales). Patrón ProjectVersion (149): "solo al completar", sin definir FAILED. No hay patrón uniforme ratificable; los experimentos tienen datos parciales útiles, la comparación FAILED no tiene ninguno.
- El estado FAILED ya es obtenible por `GET /retrieval-comparisons/{id}` (failureCode/failureMessage/timestamps), así que §5 queda cumplido sin `/results`.

## Opciones
- (a) 200 con `modes: []` más `failureCode`/`failureMessage` (campos nuevos, `completedAt` nullable o ausente). Console: un solo fetch; debe ramificar por `modes.length`/failureCode; cambio aditivo pero rompe el invariante "exactamente SE y SEM" y el tipo de `completedAt`. Requiere enmienda INTEROP.
- (a') 200 `modes: []` sin campos nuevos (estado actual). Console debe consultar el status para saber por qué; `completedAt` hoy es inventado si null. Mínima enmienda: relajar comentario de `modes` y `completedAt`.
- (b) `409 RETRIEVAL_COMPARISON_NOT_FINISHED` en FAILED. Semánticamente incorrecto (es terminal; Console reintentaría/polling inútil); contradice §5/§6.16.
- (c) Error dedicado `409/422 RETRIEVAL_COMPARISON_FAILED` (nuevo código) con failureCode/message en el error. Console: maneja error explícito, sin DTO ambiguo; contrato nuevo de error.

## Recomendación (sin decidir)
(c) o (a) con cambio de tipo; prefiero (c): mantiene el DTO 200 siempre con exactamente SE y SEM y `completedAt` no nulo, y el detalle del fallo ya vive en el status. Si se prioriza mínimo impacto en Console, (a') con `modes` documentado como vacío solo en FAILED y `completedAt` = `completedAt` del registro (nullable) es aceptable. En cualquier caso, la implementación actual debe dejar de fabricar `new Date()` para `completedAt`.

## Texto propuesto para §6.15 (solo si el usuario aprueba una opción; no se editó INTEROP)
Opción (c): "`GET .../results` en una comparación `FAILED` responde `409 RETRIEVAL_COMPARISON_FAILED` (mismo cuerpo de error de §4; el detalle `failureCode`/`failureMessage` se obtiene del status). `RETRIEVAL_COMPARISON_NOT_FINISHED` aplica solo a `PENDING`/`RUNNING`."
Opción (a'): "En una comparación `FAILED`, `GET .../results` responde `200` con `modes: []` y `completedAt` igual al del status; `modes` contiene exactamente SE y SEM solo cuando el estado es `COMPLETED`."
