[leader::GPT-6 Luna / xhigh] · WI-CORE-035 · Cierre
Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

**Fecha:** 2026-10-11 (America/Lima)
**Estado:** `W-DONE`
**Historias:** HU17
**Subtarea:** ST-CORE-042
**Revisiones:** ciclo 1 de 2; reviewer independiente y contract-reviewer `APPROVED`.

## Entrega

`POST /experiments` acepta el request OE5 V3 (`analysisRunId`, `symbolFilePath`, `symbolQualifiedName`, `repetitions?`), autoriza por AnalysisRun/WRITER y resuelve el TestTarget desde su ProjectVersion congelada completada. El símbolo debe coincidir exactamente y ser METHOD/FUNCTION `DIRECTLY_CHANGED`. Se preservan `Idempotency-Key`, el enqueue atómico y la respuesta `202` con `analysisRunId`, `experimentId` y `projectVersionId`.

`symbolFilePath` aplica ahora la regla contractual RelativePath POSIX, relativa y normalizada; absolute paths, traversal, segmentos vacíos o `.` y backslash se rechazan con HTTP 400 antes del lookup. Los campos heredados `projectId` y `targetId` no son aceptados.

## Evidencia y gates

- `npm test`: 135 archivos pasaron, 6 omitidos; 2076 pruebas pasaron, 104 omitidas.
- Después del ciclo 1: 43 pruebas DTO/servicio y 123 pruebas de matriz de acceso pasaron; lint, build y `git diff --check` pasaron.
- `sdd-check`, validación de WIs y Harness: PASS.
- Contract Sync `start`, `implementation-delivery`, `before-review` y `before-done`: PASS; cero eventos relevantes pendientes. `CS-CONSOLE-20261010-001` quedó `C-RESOLVED`; `CS-20260920-001` y `CS-20260921-003` son `NOT_RELEVANT` para este WI.
- Reportes: `wi-core-035-implementation.md`, `wi-core-035-independent-review.md`, `wi-core-035-contract-review.md` y `wi-core-035-final-review-cycle-1.md`.

## Límite

No se ejecutó el piloto autenticado integrado PHP → Core → GitHub Integration; este cierre acredita el cambio local de Core, no el E2E real entre servicios. No hubo cambios a los contratos canónicos, push ni infraestructura externa.
