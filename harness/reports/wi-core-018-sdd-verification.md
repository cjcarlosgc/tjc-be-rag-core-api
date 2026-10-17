Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-018 · Verificación de suficiencia SDD

Fecha: 2026-10-08. Solo lectura sobre código, `state.json` y `work-items.json`. Estado del WI: `W-SELECTED`, depende de `WI-CORE-017` (cerrado).

## 1. Decisiones aplicables y `Blocks`

| Decisión | Estado | Aplica a 018 | ¿`Blocks` alcanza 018? |
|---|---|---|---|
| DEC-FK-002 (UNKNOWN = abstención auditada) | APROBADO | Sí, núcleo | No |
| DEC-FK-003 (activación determinista de ACTION_REQUIRED) | APROBADO | Sí, núcleo | No |
| DEC-FK-004 (huella, forma normalizada, `scenarioKind`/`scenarioKey`) | APROBADO (incluye normalización y mapeo, aprobados al cerrar 017) | Sí: huella + `scenarioKind`/`scenarioKey` de la pregunta | No |
| DEC-FK-001 (varias ACTIVE por `scenarioKey`) | APROBADO | Solo contexto; implementación en WI-CORE-020 | No |
| DEC-ORG-003 (Writer) | APROBADO | No; WI-CORE-019 (hoy `ProjectRole` = ADMIN/MAINTAINER/READER) | No |

Ninguna decisión `PENDING`/`PROPOSED` aplica. No hay bloqueo por decisiones. (Verificar en `harness/state.json` que los IDs `DEC-FK-002/003/004` queden registrados al pasar a `SPEC_VERIFIED`; no los modifiqué.)

## 2. Matriz criterio de aceptación -> spec -> código actual

| # | Criterio | Spec | Código actual | Brecha |
|---|---|---|---|---|
| A1 | Módulo determinista: constructos del AST TS, forma normalizada, huella, comparación base vs HEAD; invariante a cosmética/rename de locales/reformateo | DEC-FK-003/004; plan.md "Huella de construcciones" | No existe. `ts-morph ^28` ya está en `package.json` y lo usa `TypeScriptParserService`; `typescript ^6` es devDependency | Total: módulo nuevo (extracción + normalización + SHA-256[0..16]) |
| A2 | Pregunta solo si METHOD/FUNCTION DIRECTLY_CHANGED + sin ACTIVE aplicable + constructo nuevo/modificado; sin pregunta si no califica; una por constructo, de una en una | DEC-FK-003, spec.md l.64, system-contract l.139 | `FunctionalContextEvaluatorService.evaluate` pregunta por **cualquier** METHOD/FUNCTION DIRECTLY_CHANGED sin regla ACTIVE (`findActive(project, scope, targetRef)`); texto templado; dedupe por `filePath::qualifiedName`; no mira constructos | Reescribir `evaluate`: filtrar por constructos, dedupe por (target, `scenarioKey`), orden determinista, texto por `scenarioKind` |
| A3 | `scenarioKind`/`scenarioKey` persistidos (columnas aditivas, nulas en históricas) y expuestos en `FunctionalQuestionResponse` | INTEROP §6.11 (l.792-793) | `FunctionalQuestion` sin esos campos; `toFunctionalQuestionResponse` no los emite | Migración aditiva + `CreateFunctionalQuestionInput` + DTO (ver ambigüedad 4.2) |
| A4 | UNKNOWN: Maintainer/Admin, pregunta PENDING, sin Knowledge, sin continuación, Run sigue ACTION_REQUIRED, 202 `outcome:'ABSTAINED'`, ids null; orden 404 -> obsoleta -> rol -> UNKNOWN -> normal; no llama `answer()` | DEC-FK-002; INTEROP l.854 | `submitAnswer`: `resolveKnowledge` devuelve null para UNKNOWN, pero luego **llama `answer()` (status ANSWERED)**, reevalúa y, si no hay pregunta nueva, `requestContinuation` + encola job. Contradicción ya registrada en spec.md l.65. `FunctionalAnswerAcceptedResponse` no tiene `outcome`. Test existente l.204 fija el comportamiento viejo | Rama UNKNOWN nueva antes de `resolveKnowledge`; `outcome` en DTO y rama normal (`'ANSWERED'`); actualizar test |
| A5 | Tabla `functional_question_abstentions(id, questionId, userId, role, createdAt)`; `abstention` = {count,lastAt,lastByUserId,lastByRole} o null; conteo atómico bajo concurrencia; repetido audita sin duplicar efectos | INTEROP l.794 | No existe tabla ni `abstention` | Modelo Prisma + migración + repositorio (`recordAbstention`, `summarize`) + mapping en DTO (`listActionRequired`, `getQuestionSet`) |
| A6 | No-UNKNOWN sigue flujo normal; HEAD nuevo obsoleta la pregunta | INTEROP l.854 | Ya implementado (`isRunStale`, `markObsolete`) | Solo regresión |
| A7 | Pruebas y Contract Sync a Console; specs a actualizar: service, evaluator, questions.repository, continuation handler | AC final | Los cuatro specs existen | Ampliar; añadir spec del módulo de huellas; Contract Sync de implementación (ABSTAINED, abstention, scenarioKind/Key) |

## 3. Mapa de archivos y fuente de AST/diff

Archivos a crear:
- `app/src/functional-knowledge/behavior-fingerprint/` (nombre sugerido): extractor ts-morph + normalizador + huella + `scenarioKind`; con spec. Reusar el patrón `new Project({ skipAddingFilesFromTsConfig, skipFileDependencyResolution })` de `app/src/project-versions/parsing/typescript-parser.service.ts` (permite `createSourceFile` desde string en memoria, sin disco).
- Migración `app/prisma/migrations/<ts>_functional_question_scenarios_abstentions/migration.sql`: `ALTER TABLE functional_questions ADD COLUMN scenarioKind/scenarioKey NULL`, `CREATE TABLE functional_question_abstentions`, e índice por `questionId`. Incluir `ENABLE ROW LEVEL SECURITY` (como `20260923120000_context_traces`; la migración `enable_rls_all_tables` solo cubre tablas existentes entonces).

Archivos a modificar:
- `app/prisma/schema.prisma` (`FunctionalQuestion` + nuevo modelo + enum `ScenarioKind`).
- `app/src/functional-knowledge/functional-knowledge.service.ts` (rama UNKNOWN, orden de pasos, `outcome`).
- `functional-context-evaluator.service.ts` (elegibilidad por constructos, dedupe por `scenarioKey`).
- `functional-questions.repository.ts` (`CreateFunctionalQuestionInput` con scenario*, dedupe en `createForCurrentRun` por scenarioKey, `recordAbstention` transaccional, include/resumen de abstenciones en `findActionRequired`/`findPendingByAnalysisRun`).
- `dto/functional-question.response.ts`, `dto/functional-answer-accepted.response.ts`.
- `functional-knowledge.controller.ts` (ver 4.3).
- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts` y `analysis-runs/persistence/analysis-symbols.repository.ts` si se persiste la huella (ver abajo).
- Specs: los cuatro del AC, más `snapshot-analysis-job.handler.spec.ts` si cambia el handler.

De dónde sale el AST y el estado:
- `DIRECTLY_CHANGED` se decide solo en `SnapshotAnalysisJobHandler.detectSymbols` (único lugar que lo asigna) comparando `chunk.content` del HEAD contra el `ProjectVersion` completado más reciente del Project (`previousVersion`, `indexDeltaBaseSha`). Se persiste en `analysis_symbols` (`changeKind`, sin contenido ni huella).
- Parser TS existente: `TypeScriptParserService` (ts-morph). Produce chunks de METHOD/FUNCTION/CONSTRUCTOR; `CONSTRUCTOR` se mapea a `METHOD` en `CHUNK_SYMBOL_TO_ANALYSIS_KIND`.
- Código HEAD: el workspace materializado (`githubSnapshotMaterializerService.materialize(binding, run.headSha)`) solo existe durante el job de snapshot (se limpia en `finally`). El evaluator también corre en `FunctionalContinuationJobHandler` y en `submitAnswer`, donde NO hay workspace.
- Código base: `GithubRepositoryContentService.getFileContent(installationId, repositoryName, path, sha)` con `run.baseSha` (y `previousFilename` del `CompareFile` para renombres). Es la única fuente fiel de "la base" del PR. Alternativa débil: `code_chunks.content` del `previousVersion`, que no es `run.baseSha` y tiene problemas (ver 5).
- Recomendación de diseño: calcular el conjunto de huellas base y HEAD dentro del job de snapshot (donde ya hay HEAD en disco y se puede pedir el base de los archivos cambiados) y persistir en `analysis_symbols` las construcciones nuevas/modificadas (p.ej. columna JSON `behaviorConstructs: [{scenarioKind, scenarioKey, order}]`, aditiva y nullable). Así `evaluate` queda determinista y sin I/O en continuation/submitAnswer. Esto requiere que `plan.md` lo registre (hoy el plan no dice dónde se persiste ni dónde se calcula).

## 4. Ambigüedades o contradicciones reales

4.1 (decisión de diseño, se recomienda confirmar; no bloquea): definición de "base". DEC-FK-003/AC dicen "base" vs HEAD; el código define DIRECTLY_CHANGED contra el último `ProjectVersion` indexado (BOOTSTRAP: todo chunk de archivo cambiado es DIRECTLY_CHANGED sin base). Si se compara contra `run.baseSha` (recomendado, es el significado natural de "base" del PR), los dos criterios pueden discrepar: un símbolo DIRECTLY_CHANGED por chunk pero sin constructo nuevo -> no se pregunta (correcto por DEC-FK-003); a la inversa, un constructo nuevo en símbolo no marcado DIRECTLY_CHANGED -> el target no califica. Pedir al usuario que confirme "base = `run.baseSha` vía `getFileContent`" y que el conjunto de candidatos sigue siendo el de `analysis_symbols` DIRECTLY_CHANGED.

4.2 (contradicción menor, requiere una línea de spec): INTEROP l.792-793 tipa `scenarioKind: ScenarioKind` y `scenarioKey: string` como no nulos en `FunctionalQuestionResponse`, mientras el AC dice columnas nulas en preguntas históricas. DEC-FK-004 define `EXPECTED_RESULT`/`LEGACY` solo para reglas, no para preguntas. Hay que fijar el mapeo de respuesta para preguntas históricas (propuesta: `EXPECTED_RESULT` / `LEGACY`), porque es visible para Console.

4.3 (orden de errores): el AC exige 404 -> obsoleta -> rol -> UNKNOWN, pero el controller usa `@RequireProjectRole('MAINTAINER', analysisRun)` (guard anterior al service) y el service además llama `projectAccess.require(MAINTAINER)` antes de buscar la pregunta; hoy un Reader recibe 403 aunque la pregunta no exista. Para cumplir el AC literalmente hay que bajar el guard a READER y hacer el chequeo de rol tras las verificaciones de pregunta (cambia 403->404 para Readers ante preguntas inexistentes/obsoletas). Confirmar que es la intención; si no, reinterpretar el orden como interno al service.

4.4 (vacío de especificación implementable, el analyst puede cerrarlo en plan.md sin decisión del usuario): DEC-FK-004 no precisa qué AST cuenta como "escritura o transición de estado" (propuesta: asignación/`++`/`--`/op-asignación o mutación por llamada a `this.<campo>`/propiedad de objeto no local; excluir variables locales), ni el orden entre varias construcciones de un símbolo (propuesta: orden de aparición en el HEAD), ni las construcciones "modificadas" vs "nuevas" (el conjunto de huellas difiere: una modificada aparece como huella nueva en HEAD y una huella ausente en base). Esto necesita registrarse antes de implementar para que las pruebas "cada construcción calificante" sean verificables.

4.5 (consecuencia, no contradicción): hasta WI-CORE-020 la regla es aplicable por target (DEC-FK-003). Respondida la primera pregunta de un target se crea una regla ACTIVE y las demás construcciones de ese target ya no preguntan. "Una pregunta por construcción" solo se materializa plenamente con 020. Conviene dejarlo explícito en plan.md/tests.

## 5. Riesgos de datos/migración y concurrencia

- Migración aditiva y reversible (columnas nullable + tabla nueva); sin backfill. Preguntas históricas con `scenarioKey` null deben seguir pudiendo recibir UNKNOWN/respuesta y no deben romper el dedupe (el dedupe actual por target debe coexistir con el nuevo por `scenarioKey`).
- RLS: la tabla nueva debe habilitar RLS en su migración (patrón `context_traces`); olvidarlo la deja expuesta a la Data API.
- Conteo atómico de abstenciones: derivar `count` de `COUNT(*)` sobre filas insert-only. La carrera real es UNKNOWN concurrente con una respuesta normal: `answer()` hoy es un `update` incondicional (dos respuestas simultáneas ambas pasan y ambas crean Knowledge). La abstención debe insertar y devolver solo si la pregunta sigue `PENDING` y el Run sigue `ACTION_REQUIRED/current` (transacción con `SELECT ... FOR UPDATE` o `updateMany` condicional), y `answer()` debería ser condicional a `status = PENDING`. Sin esto, puede quedar una fila de abstención en una pregunta ya ANSWERED.
- Idempotencia: UNKNOWN repetido debe insertar una fila por solicitud sin efectos adicionales (sin Knowledge, sin job, sin cambio de estado del Run). Confirmar si `submitAnswer` está bajo la política `Idempotency-Key` (DEC-IDEMP-001) para que un reintento con la misma clave no duplique la auditoría; no verifiqué el interceptor.
- Cálculo de huella: archivos base que no existan (añadidos), renombrados (`previousFilename`), TS que no parsea o `getFileContent` que falla. Definir el fallback: si no hay base, todas las construcciones del HEAD son nuevas; si el parseo falla, no inventar preguntas (decidir y probar). Chunks grandes se dividen en partes (`partIndex`/`partsTotal`) y `detectSymbols` indexa por identidad sin `partIndex`, así que usar `code_chunks` como fuente base daría AST incompleto; reforzar la recomendación de parsear archivos completos.
- Costo: una llamada `getFileContent` por archivo cambiado de base; acotar a archivos con símbolos DIRECTLY_CHANGED METHOD/FUNCTION.
- Contrato: `FunctionalAnswerAcceptedResponse.status` sigue `'PENDING'`; el `outcome` nuevo debe ser aditivo y el Contract Sync a Console debe emitirse al implementar (ya hay `CS-...` NOT_RELEVANT revisados en el reporte de alcance).
- PHP queda diferido: la rama PHP del evaluador no debe preguntar ni fallar (decidir: sin constructos = sin pregunta, o conservar comportamiento actual; DEC-FK-003 solo cubre TS).

## Veredicto

SDD suficiente para pasar a `SPEC_VERIFIED` con ajustes menores de plan.md (4.4, ubicación de cálculo/persistencia de huellas, 4.5) y dos confirmaciones del usuario (4.1 base = `run.baseSha`; 4.3 orden guard vs service) más una línea de spec (4.2). Ninguna decisión `Blocks` impide avanzar.
