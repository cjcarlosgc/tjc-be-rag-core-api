# WI-CORE-022 — Revisión de contrato (INTEROP-2.7 §6.15)
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura sobre app/, specs y state. Insumos: INTEROP §4, §5, §6.15, líneas 14 y 1377; `wi-core-022-sdd-verification.md`; `plan.md` de 004 («Detalle técnico verificado»); `async-jobs/plan.md`.

## Veredicto: APPROVED para los cortes 1-3 (sin DEC-RC-001); DECISION_REQUIRED solo para cerrar el WI por DEC-RC-001 (abierta, no aprobada)

## (1) Conformidad con §6.15 y el resto del contrato
Conforme: 4 rutas y códigos de estado; POST con `Idempotency-Key` scope `RETRIEVAL_COMPARISON_CREATE` y Writer; GET por id/results/listado Reader; `202` = `AsyncAccepted` (`status: 'PENDING'`, `pollAfterMs`) más ids; results antes de terminal → `409 RETRIEVAL_COMPARISON_NOT_FINISHED` (regla §5 `*_NOT_FINISHED`); terminales `COMPLETED|FAILED`; `Page<T>` (`items`/`nextCursor`) con `cursor&limit`; envelope §4 (`ErrorEnvelope`); `Run` inexistente/no visible = mismo 404 que `GET /analysis-runs/{id}`; comparación no visible = 404 (no 403, regla §4); 403 `PROJECT_ROLE_INSUFFICIENT` para rol menor a Writer; 400 de §4 (`IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_MISMATCH`, validación whitelist). Sin ganador; `metrics: null` sin groundTruth; `modes` exactamente SE y SEM; solo retrieval, sin tocar el `AnalysisRun`. P@k fijo 5 y 10 y R@k como en el plan son coherentes con `RetrievalMetricsResponse`.

Observaciones (no cambian el contrato):
- Orden de validación del POST no está fijado en §6.15; recomendado: auth/rol (404/403 del Run) → 400 de cuerpo/key → 404 símbolo → 422 tipo → (DEC-RC-001) → idempotencia/replay. Mantener el orden de `POST /experiments` (§6.5) si difiere.
- Tope de `groundTruth` ≤ 200 con 400 de validación: aceptable, es una regla de validación de cuerpo cubierta por «los errores 400 de §4». Recomendado documentarlo en el texto de §6.15 (aditivo, no cambia shapes).
- `symbolQualifiedName` de un candidato `null` nunca coincide con la verdad de terreno: decisión de implementación, declararla en la spec/plan (ya está) y no en INTEROP.
- Replay idempotente con misma key y distinto cuerpo (incl. `groundTruth`) → `400 IDEMPOTENCY_KEY_MISMATCH`, misma key y mismo cuerpo → mismo 202; conflicto en curso `409 IDEMPOTENCY_CONFLICT`. Ya definido en §3/§7.4; no requiere cambio.
- `symbol: AnalysisSymbolResponse` en los DTO: usar el snapshot `jsonb` persistido, debe cumplir la forma de §6.4/6.5.

## (2) ErrorCode
- §4 NO enumera códigos; solo reglas por clase HTTP. Los códigos se definen en la sección que los usa. Por tanto no hay lista de §4 que ampliar: `ANALYSIS_SYMBOL_NOT_FOUND` 404, `UNSUPPORTED_SYMBOL_KIND` 422, `RETRIEVAL_COMPARISON_NOT_FOUND` 404 y `RETRIEVAL_COMPARISON_NOT_FINISHED` 409 quedan definidos solo por su aparición en §6.15 (línea 1043/1046). Basta añadirlos al enum `ErrorCode` de `app/` (hoy ausentes; `PROJECT_ROLE_INSUFFICIENT` ya existe). Recomendación opcional: no tocar §4.
- Corrección al informe SDD: `ANALYSIS_NOT_FINISHED` NO aparece en INTEROP (existe en el enum de Core y en `002-project-version-indexing/spec.md`). Si DEC-RC-001 se aprueba, el código se introduce en INTEROP por primera vez; no es «ya definido en INTEROP».
- `RETRIEVAL_COMPARISON_NOT_FOUND` en `project-access` es nuevo recurso `retrievalComparison`: su 404 debe coincidir con el de la ruta de estado (también lo exige §6.16 para `/evidence`).

## (3) failureCode internos
`failureCode: string | null` es abierto en el DTO: `RETRIEVAL_TARGET_UNRESOLVABLE`, `RETRIEVAL_COMPARISON_FAILED`, `RETRIEVAL_COMPARISON_WORKER_LOST` pueden exponerse sin cambio de contrato (§5: FAILED conserva código/mensaje resumido). Condición: no filtrar stack/credenciales en `failureMessage`. Para el cliente Console conviene listarlos como valores conocidos en el Contract Sync, sin cerrar el tipo.

## (4) Texto propuesto (NO aplicado)
- §6.15, primera línea: «**Implementado en Core (`WI-CORE-022`, 2026-10-XX)**; la Console la consume en `WI-CONSOLE-014`. Capacidad experimental separada...» (resto igual). Añadir tras la lista de errores: «`groundTruth` admite hasta 200 elementos; más, o elementos mal formados, es un `400` de validación. Los `failureCode` de una comparación `FAILED` son cadenas abiertas; Core emite hoy `RETRIEVAL_TARGET_UNRESOLVABLE`, `RETRIEVAL_COMPARISON_FAILED` y `RETRIEVAL_COMPARISON_WORKER_LOST`.»
- Línea 14: sustituir «la comparación de retrieval OE2 (§6.15) y el trace operativo...» manteniendo el texto y cambiar «están implementados en Core (`WI-CORE-018`, `WI-CORE-019`, `WI-CORE-020`), así como las extensiones de OE5 (...)» por «... así como las extensiones de OE5 (§6.5.1; `WI-CORE-023`, `WI-CORE-024`, `WI-CORE-025`) y la comparación de retrieval OE2 (§6.15; `WI-CORE-022`); lo demás (trace y evidencia, §6.16)...».
- Línea 1377: «Las operaciones 6.8-6.13 y 6.15 son contrato aprobado e implementado/para implementar ... la de 6.16 (INTEROP-2.7) está definida y pendiente de implementar.» (retirar 6.15 de «pendientes»).
- §4: sin cambios (no enumera códigos).
- Nota de enmienda en `async-jobs` ya hecha (DEC-RC-002); no afecta INTEROP.
- CHANGELOG: entrada de implementación de §6.15; Contract Sync a Console (WI-CONSOLE-014) con rutas, DTOs, 4 ErrorCode nuevos y failureCode abiertos.

## (5) DEC-RC-001 (abierta, no aprobada)
Impacto: sin ella, `POST` con un Run sin `projectVersionId` (QUEUED/snapshot sin terminar) no puede producir `202` (exige `projectVersionId`). Hasta aprobarse, la implementación no valida esto y el comportamiento queda indefinido (riesgo: 500 o `projectVersionId` nulo); mínimo defensivo recomendado: no aceptar silenciosamente, lanzar error controlado interno marcado «pendiente DEC-RC-001» sin inventar código público. PHP: `422 UNSUPPORTED_SYMBOL_KIND` sobre un criterio de lenguaje desvía el significado del código («tipo»); alternativa más limpia a evaluar: un código propio (`UNSUPPORTED_LANGUAGE`) o diferir a WI-CORE-028. Ambas son cambios aditivos de contrato (nuevo 409 y ampliación del 422) y requieren aprobación del usuario y coordinación con Console (nuevo mensaje en UI).
Redacción propuesta (solo si se aprueba), tras el párrafo de errores: «Si el `AnalysisRun` es visible pero aún no tiene `projectVersionId`, responde `409 ANALYSIS_NOT_FINISHED`. Un símbolo de lenguaje sin soporte de retrieval (hoy PHP, hasta `WI-CORE-028`) responde `422 UNSUPPORTED_SYMBOL_KIND`.» Y añadir `ANALYSIS_NOT_FINISHED` a la lista de errores del contrato, con la nota de que el 409 aplica solo a la creación.

## Contract Sync de implementación (propuesto)
Productor Core, consumidor Console (`WI-CONSOLE-014`). Checkpoints: (a) rutas y roles, (b) DTOs/enums §6.15 incluido `failureCode` abierto, (c) 4 ErrorCode nuevos + `PROJECT_ROLE_INSUFFICIENT`/400 de idempotencia, (d) tope `groundTruth` 200 y pollAfterMs. Si DEC-RC-001 se aprueba, checkpoint adicional con 409 y 422 de lenguaje. Estado a registrar: contrato sin cambio de forma; solo notas de estado y mínimas aclaraciones aditivas.
