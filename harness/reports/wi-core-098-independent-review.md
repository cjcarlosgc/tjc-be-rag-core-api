# WI-CORE-098 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

Ciclo 1 de 2. Árbol de trabajo sin commitear, revisado solo en lectura (mutaciones temporales restauradas; `git diff --stat` idéntico antes y después).

**Veredicto: APPROVED** (sin HIGH ni MEDIUM; 4 hallazgos LOW para el cierre del leader).

## Hallazgos

| # | Sev. | Dónde | Hallazgo / qué cambiar |
|---|---|---|---|
| 1 | LOW | `app/src/experiments/experiment-job.handler.ts` `requiredScenarioKeysOf` | Si el símbolo no se encuentra por `filePath::qualifiedName` (o no hay `analysisRunId`), requeridas = `[]` y la cláusula (c) nunca se activa: falla abierta y silenciosa. Es coherente con la verificación SDD, pero conviene que el spec 008 / informe de cierre diga que en Experiments la cláusula (c) solo opera cuando el símbolo del AnalysisRun se localiza (hoy solo está dicho «sin AnalysisRun»). |
| 2 | LOW | `app/src/generation/context-sufficiency.spec.ts` | `tsc --noEmit` reporta errores de tipo en este spec nuevo (fixtures de chunk sin `projectVersionId`, `createdAt`, `importsUsed`, `partIndex`, `partsTotal`; `RetrievalCandidate`). El repo ya tiene muchos errores de tsc en specs ajenos (cliente Prisma generado desactualizado en mi entorno), vitest no tipa y no afectan a producción, pero este fichero añade ruido nuevo: completar los fixtures o tiparlos con `as never`/`Partial`. |
| 3 | LOW | `app/src/experiments/experiment-job.handler.spec.ts` (final) | El `describe` nuevo termina con una línea en blanco sobrante (EOF con doble salto). Estético. |
| 4 | LOW | `spec/features/004-rag-retrieval-context/tasks.md`, `008-.../tasks.md` | ST-CORE-115/116 quedan `[ ] T-IN_PROGRESS`; el leader debe pasarlos a `[x] T-DONE` en el cierre. Además el encabezado de la sección «Alineación SMART V3 … implementación pendiente» de spec 004 aloja la nueva viñeta; aceptable, sin cambio obligatorio. |

## Verificado directamente

1. **Regla D-5** (`context-sufficiency.ts`): (a) `target.content.trim()===''` bloquea (probado con vacío y solo espacios, aun con candidatos y reglas); (b)∧(c) bloquea solo con 0 elegibles y ≥1 clave requerida ausente; cada cláusula sola no bloquea (casos 3, 4, 6 del spec). Elegibles = `discardReason !== 'BELOW_MINIMUM_SCORE'`; `TOP_K_LIMIT`/`TOKEN_BUDGET` cuentan (confirmado contra `context-builder.service.ts:104-112`, donde un seleccionado tiene `discardReason` null). Reglas «presentes» = las recuperadas (`functionalRules` local), no las del contexto (caso 9). Claves duplicadas deduplicadas con `Set`; `behaviorConstructs` null o vacío ⇒ `readBehaviorConstructs(...) ?? []` ⇒ sin requeridas ⇒ no bloquea. Si `audit` falta, usa `retrievedChunks` (inocuo).
2. **Regresión cero:** `acquireGenerationContext` solo evalúa si `input.sufficiency` existe; `runRagArm` (`contextOptions` en :1136) no lo pasa. Con una mutación que sí lo pasa, fallan 5 pruebas existentes de Experiments.
3. **Validation:** rama de captura antes del catch genérico; `HELD`, `content ''`, `failureSummary` por `sanitizeFailureMessage`, `contextId null`, retorno `TECHNICAL_GENERATION_FAILURE` sin `platformFailure`; la excepción se lanza antes de prompt/LLM/Sandbox y de `persistTraceEvidence`. Sin cambios en `classifyRun`, por lo que DEC-VAL-002 queda intacta. Efecto lateral: solo el import de `readBehaviorConstructs`.
4. **Experiments:** el pre-chequeo va tras cargar `version`/`target` y antes de `objectStorageService.get`, de la construcción de `runContext`/pares y de `beginAttempt` (único punto que crea `ContextTrace`; confirmado). Pero va después de `markStarted` y de `assertNoInFlightAttempt` (el estado queda `RUNNING→FAILED`, consistente). `markFailed(id,'EXPERIMENT_FAILED', saneado)` es código existente; hay `statusChanged`; `return` sin relanzar, así el job termina y no se reintenta (ni `onExhausted`). Un error distinto del pre-chequeo (BD, `UNRESOLVABLE_TARGET`) se registra con `warn` y el flujo continúa como antes (probado). Coste: una recuperación extra por experimento, solo lecturas de BD (el embedding es el del chunk ancla; sin LLM ni Sandbox).
   **Paridad entre brazos:** la decisión es única por experimento y previa a cualquier brazo, y ninguno recibe la compuerta después; no hay forma de que RAG falle y el agente continúe. Un bloqueado es caso no evaluable (0 repeticiones, no entra en CF/CO/VT). Es una asimetría solo de información ya aceptada (DEC-EXP-FK-001); no veo sesgo nuevo. Riesgos considerados: experimentos oficiales con reglas faltantes y cero candidatos se bloquearían, pero exige ambas condiciones y, con `RETRIEVAL_MINIMUM_SCORE=0`, cero candidatos en un repo indexado es raro; experimentos sin `analysisRunId` solo bloquean por target vacío. Está declarado en spec 004/008 y CHANGELOG.
5. **Sin cambio de contrato:** `git diff --stat` solo toca los ficheros listados; `spec/contracts/` y `ContextBuilder` sin diff; no hay enum, `ErrorCode`, ruta, DTO, evento, esquema, env ni migración nuevos. G-03: texto neutral, conserva `ErrorCode.REASONING_EFFORT_UNSUPPORTED`, 422 y `details`; grep del literal anterior sin resultados en `app/src`, `spec` ni `harness` (fuera de la historia).
6. **Calidad de pruebas.** Mutaciones (todas restauradas):
   - M1 invertir `&&` por `||` en la cláusula (b)∧(c): fallan pruebas (varias de Validation, p. ej. clasificación `TECHNICAL_GENERATION_FAILURE`).
   - M2 quitar el `return` tras `markFailed`: falla «marks the experiment FAILED without repetitions…».
   - M3 pasar `sufficiency` en `runRagArm`: fallan 5 pruebas de Experiments.
   - M4 cambiar `HELD` por `FAILED` en la rama de Validation: fallan las 2 pruebas nuevas de Validation.
   Las 3 aserciones de conteo ajustadas (:1284→`toHaveBeenCalledTimes(1)`, :1349 3→4, :1503/1512 3→4, :4041-4049 3→4) son legítimas: reflejan exactamente +1 por el pre-chequeo, con comentario, y las pruebas conservan la verificación de las 3 repeticiones RAG por otras aserciones (`beginAttempt`, `ragAttemptIndexes`). No ocultan regresión.
7. **Docs/spec:** spec 004/008/013 y CHANGELOG declaran V1, la limitación V2, caso no evaluable, riesgo residual (b)∧(c), `RETRIEVAL_MINIMUM_SCORE=0`, y la contradicción con la redacción «ACTION_REQUIRED» de CT-05-A5. No encontré promesas sin respaldo.
8. **Seguridad:** el mensaje del error es fijo por `reason`, sin código ni claves; además pasa por `sanitizeFailureMessage` en ambos llamadores; no hay secretos ni `.env` leído.
9. **Estilo:** comentarios con prefijo `WI-CORE-098` y español coherentes con el entorno; sin código muerto (los campos `eligibleCandidates`/`retrievedCandidates`/`missingScenarioKeys` del error se usan en pruebas y quedan disponibles para diagnóstico).

Ejecutado: `vitest` (sin `*.pg.spec.ts`) completo, **174 archivos pasan, 1 omitido; 3007 tests pasan**; `oxlint` (`pnpm run lint`) sin errores. `tsc --noEmit`: errores solo en specs (ver hallazgo 2 y los preexistentes por el cliente Prisma); ninguno en ficheros de producción modificados.

## No verificado
- No ejecuté `*.pg.spec.ts` ni nada contra BD real (por instrucción).
- No ejecuté `pnpm run build` ni `lint:types`.
- No comprobé el comportamiento end-to-end con Sandbox/LLM reales ni el efecto real sobre experimentos oficiales de los pilotos.
- La equivalencia entre `filePath::qualifiedName` del símbolo y `functionalTargetRef` en todos los tipos de target PHP la razono por lectura, sin prueba dedicada.

## Siguiente paso recomendado
El leader aplica los LOW (1 como línea en spec 008/informe, 2-4 de limpieza) y cierra con `W-DONE` previa aprobación del usuario según su flujo.
