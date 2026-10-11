[reviewer::GPT-6 Luna / xhigh] · WI-CORE-035 · Revisión independiente
Modelo: reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## status

APPROVED

## findings

- El ciclo de corrección 1 satisface el hallazgo contractual de `RelativePath`: `symbolFilePath` ahora requiere una ruta POSIX relativa normalizada y rechaza rutas absolutas, prefijos de unidad, backslash, segmentos vacíos, `.` y `..`. La constraint usa `class-validator` y el `ValidationPipe` global transforma estos casos en HTTP 400 antes del handler. Las pruebas cubren path válido, absolutas/traversal/separadores no normalizados y campos heredados.
- No encontré regresiones en el alcance original. El DTO sigue exponiendo request OE5 V3 y rechaza `projectId` y `targetId`; la ruta declara WRITER sobre `analysisRunId` y el servicio vuelve a exigir WRITER en el Project del Run, preservando `404` para recursos no visibles.
- El servicio exige una `projectVersionId` congelada y COMPLETED, encuentra el símbolo por coincidencia exacta `(filePath, qualifiedName)`, y limita la selección a METHOD/FUNCTION `DIRECTLY_CHANGED`. El `TestTarget` se resuelve solo desde esa versión y su ID interno alimenta persistencia y job; no se consulta `currentVersionId` ni se confía en IDs de target/versión del cliente.
- Se conserva `Idempotency-Key`, su scope/fingerprint y la creación transaccional del experimento junto con el enqueue. La respuesta 202 devuelve `analysisRunId`, `experimentId` y `projectVersionId`, además del estado y `pollAfterMs` existentes.
- Mejora de cobertura no bloqueante: añadir un caso positivo de símbolo FUNCTION junto al caso METHOD existente. El código admite ambas ramas y no observé una regresión asociada a esa ausencia.

## blockers

- Ninguno para la revisión técnica del corte local.
- No se ejecutó un E2E real autenticado PHP → Core → GitHub Integration; el reporte del implementer lo mantiene pendiente del piloto preconfigurado. No debe declararse verificado ese flujo integrado todavía.

## filesAffected

- Revisados: `app/src/experiments/dto/create-experiment.dto.ts`, `app/src/experiments/dto/create-experiment.dto.spec.ts`, `app/src/experiments/dto/experiment.response.ts`, `app/src/experiments/experiments.controller.ts`, `app/src/experiments/experiments.module.ts`, `app/src/experiments/experiments.service.ts`, `app/src/experiments/experiments.service.spec.ts`, `app/src/experiments/experiments.model-config.spec.ts` y `app/test/access-matrix.e2e-spec.ts`.
- Modificado por esta revisión: solo `harness/reports/wi-core-035-independent-review.md`.

## evidence

- Contraste read-only del diff completo de `app/` con INTEROP-2.7 §§2, 4 y 6.5, los criterios originales de WI-CORE-035 y el reporte de implementación.
- `app/src/main.ts` configura `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted`; la nueva validación posicional se ejecuta antes del controller. La constraint sigue el criterio de seguridad de rutas relativas normalizadas ya empleado en validadores internos de Core.
- Reejecutado en `app/`: `npm test -- src/experiments/dto/create-experiment.dto.spec.ts src/experiments/experiments.service.spec.ts` — 2 archivos, 43 pruebas pasaron.
- Reejecutado en `app/`: `npm run test:e2e -- test/access-matrix.e2e-spec.ts` — 1 archivo, 123 pruebas pasaron. El log `GITHUB_VERIFICATION_UNAVAILABLE` corresponde a un escenario de fallo esperado; la prueba terminó pasando.
- El reporte del implementer documenta además suite completa (2069 pruebas pasaron, 104 omitidas), lint, build y `git diff --check` exitosos; no los reejecuté en este ciclo.

## recommendedNextStep

Registrar el veredicto de este ciclo y continuar los gates de cierre de WI-CORE-035. Mantener explícito que el E2E PHP/Core/GitHub Integration sigue pendiente del piloto autenticado.
