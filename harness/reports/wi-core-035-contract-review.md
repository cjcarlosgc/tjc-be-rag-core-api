[contract-reviewer::GPT-6 Luna / high] · WI-CORE-035 · Revisión contractual
Modelo: contract-reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo high

status: APPROVED

findings:
- Ciclo de corrección 1 atendido: `symbolFilePath` ahora valida forma POSIX relativa normalizada, rechaza `/` inicial, separadores `\\`, segmentos vacíos, `.` y `..`, y evita rutas absolutas con prefijo de unidad (`app/src/experiments/dto/create-experiment.dto.ts:14-32`). Como el `ValidationPipe` global rechaza el DTO antes de invocar el controller (`app/src/main.ts:19-25`), estos casos fallan con HTTP 400 antes del lookup de `AnalysisSymbol`.
- El resto del corte sigue alineado con INTEROP: DTO V3, rechazo de campos heredados, autorización WRITER sobre AnalysisRun, versión congelada para resolver el TestTarget, errores de símbolo/estado, key idempotente y respuesta 202 con `analysisRunId`, `experimentId` y `projectVersionId`.
- `CS-CONSOLE-20261010-001` permanece `C-RESOLVED`. No hay cambios contractuales canónicos: diff de INTEROP, SYSTEM y GitHub Integration contract vacío.

blockers:
- Ninguno. No hay ambigüedad ni decisión contractual pendiente.

filesAffected:
- `app/src/experiments/dto/create-experiment.dto.ts`
- `app/src/experiments/dto/create-experiment.dto.spec.ts`
- `app/src/experiments/experiments.controller.ts`
- `app/src/experiments/experiments.service.ts`
- `app/src/experiments/dto/experiment.response.ts`
- `app/src/main.ts`
- `harness/contract-sync/inbox/CS-CONSOLE-20261010-001.yaml`
- `harness/reports/wi-core-035-implementation.md`
- `spec/contracts/interoperability-contract.md` (referencia normativa; sin cambios)

evidence:
- `app/src/experiments/dto/create-experiment.dto.ts:14-32`: validador de RelativePath rechaza paths absolutos, traversal y rutas no normalizadas.
- `app/src/experiments/dto/create-experiment.dto.spec.ts:30-55`: cubre ruta relativa válida y HTTP 400 para ruta absoluta, traversal, segmento vacío, segmento `.` y backslash.
- `app/src/main.ts:19-25`: pipe global con whitelist y `forbidNonWhitelisted`, previo a la ejecución del handler/controller.
- Verificación de regresión: `npm test -- --run src/experiments/dto/create-experiment.dto.spec.ts` pasó (1 archivo, 9 pruebas).
- `app/src/experiments/experiments.controller.ts:36-44`: la ruta retorna HTTP 202 y usa `ProjectTargets.body('analysisRun', 'analysisRunId')` con rol WRITER.
- `app/src/experiments/experiments.service.ts:115-137`: la autorización de dominio vuelve a exigir WRITER; usa solo `analysisRun.projectVersionId` y devuelve `409 ANALYSIS_NOT_FINISHED` si la versión congelada no está completa.
- `app/src/experiments/experiments.service.ts:139-171`: busca coincidencia exacta `(filePath, qualifiedName)`, limita a `METHOD`/`FUNCTION` `DIRECTLY_CHANGED`, y resuelve el TestTarget solo desde la versión congelada; errores `404 ANALYSIS_SYMBOL_NOT_FOUND`, `422 UNSUPPORTED_SYMBOL_KIND` y `404 UNRESOLVABLE_TARGET`.
- `app/src/experiments/experiments.service.ts:118,192-254`: valida la key, usa la operación idempotente y atómica existente, y devuelve/reconstruye `analysisRunId`, `experimentId`, `projectVersionId` en la aceptación.
- `app/src/experiments/dto/create-experiment.dto.spec.ts`: prueba la forma V3 y el rechazo de `projectId`/`targetId` con whitelist y forbidNonWhitelisted.
- `harness/contract-sync/inbox/CS-CONSOLE-20261010-001.yaml`: `status: C-RESOLVED`, con referencia a `harness/reports/wi-core-035-implementation.md`.
- `spec/contracts/interoperability-contract.md:246-257`: define el request V3 y los tres IDs obligatorios de `ExperimentAcceptedResponse`; `:39` establece las reglas de `RelativePath`.

recommendedNextStep:
- Continuar con los gates y el proceso de revisión/cierre de WI-CORE-035. No cambiar INTEROP ni emitir un contrato nuevo: la corrección cumple la regla existente.
