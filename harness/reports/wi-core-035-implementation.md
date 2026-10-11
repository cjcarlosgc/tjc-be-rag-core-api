[implementer-high::GPT-6 Luna / high] · WI-CORE-035 · Adaptación POST experiments OE5 V3
Modelo: implementer-high · configurado gpt-6-luna · atendido unknown · esfuerzo high

## status

IMPLEMENTATION_COMPLETE; pendiente revisión independiente y gates de cierre del WI.

## findings

- `POST /experiments` acepta `analysisRunId`, `symbolFilePath`, `symbolQualifiedName` y `repetitions` opcional. `projectId` y `targetId` no pertenecen al DTO; con `whitelist` y `forbidNonWhitelisted`, ambos campos heredados se rechazan.
- La política HTTP exige WRITER sobre el AnalysisRun. El servicio vuelve a comprobar WRITER sobre el Project del Run y obtiene la versión únicamente desde `AnalysisRun.projectVersionId`; exige que esa versión esté COMPLETED.
- La selección requiere coincidencia exacta `(filePath, qualifiedName)` con un AnalysisSymbol `METHOD` o `FUNCTION` y `DIRECTLY_CHANGED`. El TestTarget interno se resuelve por correspondencia exacta usando solo los targets de la versión congelada.
- Se conservan la clave de idempotencia, creación transaccional, job asíncrono y respuesta 202; la respuesta aceptada añade `analysisRunId` junto a `experimentId` y `projectVersionId`.
- La matriz HTTP de acceso fue actualizada para que la autorización de `POST /experiments` se evalúe sobre AnalysisRun. No se cambiaron contratos canónicos ni servicios consumidores.

## blockers

- Ninguno para la implementación local. No se ejecutó un E2E real PHP/Core/GitHub Integration: la verificación del corte usa servicios de prueba y la matriz de acceso en memoria; el piloto integrado depende del entorno autenticado preconfigurado.

## filesAffected

- `app/src/experiments/dto/create-experiment.dto.ts`
- `app/src/experiments/dto/create-experiment.dto.spec.ts`
- `app/src/experiments/dto/experiment.response.ts`
- `app/src/experiments/experiments.controller.ts`
- `app/src/experiments/experiments.module.ts`
- `app/src/experiments/experiments.service.ts`
- `app/src/experiments/experiments.service.spec.ts`
- `app/src/experiments/experiments.model-config.spec.ts`
- `app/test/access-matrix.e2e-spec.ts`

## evidence

- En `app/`: `npm test` — 135 archivos pasaron, 6 omitidos; 2069 pruebas pasaron, 104 omitidas.
- En `app/`: `npm run test:e2e -- test/access-matrix.e2e-spec.ts` — 1 archivo pasó; 123 pruebas pasaron.
- En `app/`: `npm run lint` — pasó.
- En `app/`: `npm run build` — pasó.
- En la raíz: `git diff --check` — pasó.
- Después del ajuste final de casos de elegibilidad: `npm test -- src/experiments/experiments.service.spec.ts` — 34 pruebas pasaron; `npm run lint` y `git diff --check` — pasaron.

## recommendedNextStep

Solicitar revisión técnica independiente del diff y la evidencia; luego el leader puede registrar el gate de implementación y continuar el checkpoint `implementation-delivery` de Contract Sync para `CS-CONSOLE-20261010-001`.

## ciclo de corrección 1 — RelativePath

- Se añadió al DTO una constraint síncrona de class-validator para `symbolFilePath`: requiere ruta POSIX relativa y normalizada; rechaza raíz absoluta, prefijos de unidad, backslash, traversal y segmentos vacíos o `.`.
- Pruebas de la `ValidationPipe` verifican `BadRequestException` (HTTP 400) para `/src/example.ts`, `src/../example.ts`, `src//example.ts`, `src/./example.ts` y `src\example.ts`; `src/example.ts` sigue válido.
- Evidencia del ciclo: en `app/`, `npm test -- src/experiments/dto/create-experiment.dto.spec.ts src/experiments/experiments.service.spec.ts` — 2 archivos, 43 pruebas pasaron; `npm run lint` y `npm run build` — pasaron; `git diff --check` — pasó.
- Sin bloqueos; recomendado: revisar este ciclo junto con el diff del WI antes de avanzar los gates de cierre.
