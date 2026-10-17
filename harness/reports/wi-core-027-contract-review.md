# WI-CORE-027 — Ratificación contractual (§6.16 `/evidence`)
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura; no se editó contrato, spec ni código. Fuentes: INTEROP-2.7 §6.16, §6.5/§6.5.1, §6.13, §6.15, línea 14 y §8; `spec/transversal/experimental-metrics/plan.md`; `harness/reports/wi-core-027-sdd-verification.md`.

## Veredicto

- **Cortes A y B: APPROVED.** No tocan §6.16 ni DTO publicados.
- **Corte C: APPROVED CON UNA CONDICIÓN (C1, abajo)** que debe cerrarse antes de implementar `retrieval[].config`. Resto de la enmienda B conforme.
- **Corte D: DECISION_REQUIRED** solo por DEC-EVID-001 (toca §6.5 y Contract Sync). No decidida aquí.

## 1. La enmienda B (DEC-EVID-002) es aditiva y conforme

- Campos nuevos (`experimental[].technicallyEvaluable`, `sandbox[].repetition/strategy`, `generation[].repetition/attempt/strategy` ya existente, `retrieval[].metrics`) son claves nuevas: los consumidores ya deben ignorar o tolerar campos desconocidos (§1).
- `| null` en `durationMs`, `requestId`, `correlationId`, `artifactHash`, `executionId` es ensanchamiento de tipo, no estrictamente aditivo para un consumidor TS estricto. Aceptable porque **ningún emisor existe** (`/evidence` no está implementado y WI-CONSOLE-017 aún no lo consume): no hay ruptura observable. Es coherente con §6.5 (línea «un valor no observable se representa con `null`, nunca con cero») y con el trace (filas previas sin backfill => `null`/`NOT_APPLICABLE`).
- `technicallyEvaluable: boolean` no nulo reutiliza la semántica ya vigente en `ExperimentRepetitionV27Additions` (§6.5.1): mismo nombre, tipo y valor por defecto (`true` en filas previas). Conforme.
- `retrieval[].metrics: RetrievalMetricsResponse | null` reutiliza el tipo de §6.15; `null` fuera de RETRIEVAL_COMPARISON y sin `groundTruth`. `groundTruth` no se exporta. Conforme.
- `repetition` en `sandbox[]`/`generation[]`: `number | null` (null en ANALYSIS_RUN, donde no hay repetición); `strategy` en `sandbox[]`: `ExperimentStrategy | 'PRODUCT' | null`... recomendado: `ExperimentStrategy | 'PRODUCT'` (no nulo; el Run usa `PRODUCT`, igual que `generation[]`).

### C1 (condición, corte C). `retrieval[].config` no es siempre observable
§6.16 tipa `config` como `RetrievalModeResultResponse['config']` con `semanticTopK`, `finalTopK`, `embeddingModel` no nulos. El informe SDD (H2) verifica que `analysis_retrievals` guarda solo `{mode, vectorTopK, targetChunkIds}`: `finalTopK` y `embeddingModel` hoy no se persisten para el Run (y el JSONB RAG del experimento trae `topK` pero no necesariamente el modelo de embedding). Con los tipos actuales habría que inventar valores, lo que viola «no observable => null».
Opciones (decide el usuario; no estaba en DEC-EVID-002 aprobada):
- (a) **Recomendada:** ampliar la misma enmienda B con un tipo propio en el bundle (no alias de §6.15): `config: { semanticTopK: number | null; finalTopK: number | null; semanticWeight: number | null; structuralWeight: number | null; embeddingModel: string | null }`. Sin emisor previo, sin ruptura. §6.15 no cambia.
- (b) Persistir `finalTopK`/`embeddingModel` en la migración B (DEC-EVID-003) y mantener tipos no nulos; deja filas previas sin valor y vuelve a forzar invención o 500.
Hasta resolverla, el corte C no debe emitir `config` con valores sintéticos.

## 2. Forma final de los items por kind y qué NO se exporta

Regla común: ensamblado campo a campo, nunca spread de JSONB; dato no observado => `null`, nunca `0`/`''`; secciones sin aplicación => `[]` / `null` (`analysisRun`, `publication`).

| Sección | ANALYSIS_RUN | EXPERIMENT | RETRIEVAL_COMPARISON |
|---|---|---|---|
| `analysisRun` | objeto; `snapshotRef` = UUIDv5 de `urn:tjc:snapshot-ref:v1:{projectVersionId}:{headSha}` (DEC-EVID-005); `targets` = `AnalysisSymbolResponse[]` del trace | `null` | `null` |
| `retrieval[]` | uno por target presente: `retrievalId` (id de `analysis_retrievals`), `mode: 'SE'`, `config` (ver C1), `candidates` (`rank` = posición persistida, `selected` desde `selectedChunkIds`, `combinedScore`/pesos `null` si no persistidos), `metrics: null` | uno por repetición RAG vigente: `retrievalId = ContextTrace.id`; `candidates` desde `detail.candidates` (rank/combinedScore/decision) sin `excerpt`; `metrics: null` | los dos resultados SE y SEM; `retrievalId` del resultado; `metrics` poblado (`RetrievalMetricsResponse`); `[]` si la comparación está `FAILED` |
| `context[]` | `analysis_contexts`: `contextId`, `selectedChunkIds`, `discardedChunkIds`, `tokenCounts{selected,budget|null}`, `functionalRuleIds` | brazo RAG: `contextId = ContextTrace.id`; ids desde `detail.candidates[].decision`; `functionalRuleIds` desde `detail.functionalRules` | `[]` |
| `generation[]` | `strategy: 'PRODUCT'`, `repetition: null`, `attempt` del Run; `provider/model/modelVersion/reasoningEffort/inputTokens/outputTokens/durationMs` de la nueva columna `generation`, `null` si fila previa; `artifactHash` = `contentSha256` salvo propuesta de excepción (`content=''` => `null`) | una por repetición vigente (RAG y GA): `modelConfig` + tokens + `generationDurationMs`; `artifactHash` nuevo, `null` si ausente | `[]` |
| `agentExploration[]` | `[]` | solo trazas AGENT: `toolCallCap`, `contextTokenBudget`, `filesInspected|null`, `steps[{step,toolName,status}]` (sin argumentos, resultados ni razonamiento) | `[]` |
| `sandbox[]` | por `analysis_run_executions`: `executionId`, `executionProfile`, `runnerHint`, `attempt`, `facts` (14 claves cerradas), `durationMs|null`, `requestId|null`, `correlationId|null`, `repetition: null`, `strategy: 'PRODUCT'` | por repetición con invocación al Sandbox; sin invocación no hay entrada; `executionId|null` si no se capturó | `[]` |
| `experimental[]` | `[]` | por repetición vigente: `experimentId`, `strategy`, `repetition`, `pairId` (`Id|null` filas previas), `pairPosition` (`1|2|null`), `attempt`, `randomizationSeed` (`string|null`), `technicallyEvaluable` | `[]` |
| `publication` | `toPublication` del trace | `null` | `null` |

Nota de tipos para el texto de §6.16: `pairId`, `pairPosition` y `randomizationSeed` deben declararse `| null` (igual que §6.5.1: «`null` en filas previas a OE5»); el §6.16 vigente los tiene no nulos, lo que contradiría el emisor real en experimentos anteriores a OE5. Incluirlo en la misma enmienda B (es el mismo principio y no hay emisor previo). Si el usuario prefiere no ampliar, esos experimentos se excluyen: no recomendado.

`sandbox.facts`: exactamente las 14 claves del contrato, construidas por función explícita; conteos y banderas de `RunnerFacts`; `failure*` desde `failure` persistido re-saneado al leer. DEC-EVID-006: en `COMPLETED` con pruebas fallidas, `failureCategory = failureType` validado y sin `NONE`; `failureStage/Code/Message = null`. DEC-EVID-003: `sandboxFacts` guarda solo conteos y banderas.

**No se exporta nunca:** `groundTruth`; `testCases` (ni mensajes de error); `excerpt`/contenido de código y `content` de propuestas; URLs (firmadas o no) y claves/buckets de storage (el `snapshotRef` es derivado, no una clave); logs y evidencias del Sandbox; argumentos/resultados de herramientas del agente y chain-of-thought/`reasoning`; credenciales; identificadores `EV-OE*`; `valid`, tasas, ganador, CF/CO o significancia; `knowledgeId`, reglas omitidas y conteos de Functional Knowledge; campos internos de persistencia (marca `TIMED_OUT`, latido de intentos). La prueba de claves prohibidas del plan (criterio 6) cubre este listado; se recomienda añadir `groundTruth`, `testCases` y `knowledgeId`.

## 3. IDEA-015 (sanear `errorSummary`/`failureSummary`, validar `failure.category`)

Confirmado: no requiere enmienda de DTO ni Contract Sync propio. Los campos ya existen como `string | null`/`FailureType` en `/results` y en las respuestas de Run; cambia solo su contenido (más redacción) y un valor de enum fuera de dominio pasa a `UNKNOWN`, que ya pertenece a `FailureType`. Es compatible hacia atrás para Console.

Nota exacta propuesta (al cerrar el WI, en §6.5 tras el párrafo de `ExperimentRepetitionResponse`, y como bullet breve en la sección de errores/resultados del Run si aplica):

> Nota (WI-CORE-027, IDEA-015): `errorSummary` y `failureSummary` se emiten saneados (secretos redactados y truncado a 500 caracteres, de forma idempotente, también sobre filas previas) y `failure.category` se valida contra `FailureType` (un valor desconocido se emite como `UNKNOWN`). El cambio afecta solo al contenido de campos ya existentes; la forma de las respuestas no cambia.

Observación de higiene (no bloqueante): `plan.md`, viñeta DEC-EVID-004, aún dice «IDEA-015 (`errorSummary`) queda fuera», contradiciendo la ampliación aprobada y la nota que le sigue. Corregir en el siguiente commit de spec.

## 4. `schemaVersion`

**Mantener `'1'`.** El bundle nunca se ha emitido; la enmienda B (y C1) se aplica antes de la primera implementación, por lo que '1' queda definido en su forma final y no hay consumidor previo que romper. El bump solo corresponde si, después del corte D, se cambia o quita una clave ya emitida. La prueba de esquema estable (criterio 6) ancla las claves por kind a `schemaVersion '1'` y obliga al bump ante cualquier clave nueva posterior. Línea INTEROP-2.7 y SYSTEM no cambian de versión por esto (contrato 2.7 en preparación; se registra en CHANGELOG).

## 5. Texto propuesto (NO aplicado)

### 5.1 §6.16, encabezado y tipos
Reemplazar el primer párrafo de §6.16 (tras `WI-CORE-027` implementado, en el corte D) por:

> **`GET /analysis-runs/{analysisRunId}/trace` y `GET .../evidence`, `GET /experiments/{experimentId}/evidence` y `GET /retrieval-comparisons/{retrievalComparisonId}/evidence` implementados en Core** (`WI-CORE-026` y `WI-CORE-027`, 2026-10-09; la Console los consume en `WI-CONSOLE-020` y `WI-CONSOLE-017`). …(resto sin cambios)

Antes del corte D (cortes C), en lugar de lo anterior: «La exportación de evidencia (`/evidence`) está **implementada en Core hasta el corte C** … pendiente de verificación y de Contract Sync»; se reserva «Implementado» para el corte D.

Nota nueva tras el tipo `EvidenceBundleResponse`:

> Aclaraciones de la exportación implementada (`WI-CORE-027`): un dato no observado es `null`, nunca `0` ni cadena vacía; los runs, propuestas y repeticiones anteriores a la implementación no se rellenan (sin backfill) y emiten `null` en `durationMs`, `requestId`, `correlationId`, `artifactHash`, `executionId` y en los campos de generación. `sandbox[]` y `generation[]` llevan `repetition` y `strategy` (`repetition` es `null` y `strategy` es `PRODUCT` para un `AnalysisRun`) para unirse con `experimental[]`; `generation[]` lleva además `attempt`. `experimental[].technicallyEvaluable` refleja la exclusión de repeticiones no evaluables del agregado (§6.5.1); `pairId`, `pairPosition` y `randomizationSeed` son `null` en experimentos anteriores a OE5. `retrievalId` y `contextId` de un `EXPERIMENT` son el `id` de la `ContextTrace` del brazo RAG; `snapshotRef` es una referencia opaca derivada del proyecto y del HEAD, nunca una clave de almacenamiento ni una URL. `retrieval[].metrics` solo se informa en `RETRIEVAL_COMPARISON`; `groundTruth` no se exporta. En una repetición `COMPLETED` con pruebas fallidas, `sandbox.facts.failureCategory` es el tipo de fallo observado y `failureStage`, `failureCode` y `failureMessage` son `null`. `failureMessage` y `failureCode` se sanean al emitir. La evidencia no incluye `testCases`, fragmentos de código, logs, URLs ni claves de almacenamiento. `schemaVersion` permanece `'1'`.

Tipos (diff sobre `EvidenceBundleResponse`):
```ts
retrieval: { retrievalId: Id; mode: RetrievalMode; config: { semanticTopK: number | null; finalTopK: number | null; semanticWeight: number | null; structuralWeight: number | null; embeddingModel: string | null }; candidates: RetrievalCandidateResponse[]; metrics: RetrievalMetricsResponse | null }[]
generation: { strategy: ExperimentStrategy | 'PRODUCT'; repetition: number | null; attempt: number | null; provider: string | null; model: string | null; modelVersion: string | null; reasoningEffort: string | null; inputTokens: number | null; outputTokens: number | null; durationMs: number | null; artifactHash: Sha256 | null }[]
sandbox: { executionId: string | null; strategy: ExperimentStrategy | 'PRODUCT'; repetition: number | null; executionProfile: string; runnerHint: string; attempt: number; facts: Record<string, string | number | boolean | null>; durationMs: number | null; requestId: string | null; correlationId: string | null }[]
experimental: { experimentId: Id; strategy: ExperimentStrategy; repetition: number; pairId: Id | null; pairPosition: 1 | 2 | null; attempt: number; randomizationSeed: string | null; technicallyEvaluable: boolean }[]
```
(`generation.provider/model` pasan a `| null` por la misma razón: filas previas sin la columna `generation`; `executionProfile`/`runnerHint` y `attempt` ya existen en la fila.)

### 5.2 Línea 14
En la oración «y el trace operativo (`GET /analysis-runs/{id}/trace` de §6.16; `WI-CORE-026`)» sustituir por: «y el trace operativo y la exportación de evidencia (`/trace` y `/evidence` de §6.16; `WI-CORE-026` y `WI-CORE-027`)». Aplicar solo en el corte D.

### 5.3 Nota ~línea 1379 (§8)
Sustituir «de 6.16 (INTEROP-2.7) el trace está implementado (`WI-CORE-026`) y la exportación de evidencia sigue definida y pendiente de implementar (`WI-CORE-027`)» por «6.16 (INTEROP-2.7) está implementado en Core: el trace (`WI-CORE-026`) y la exportación de evidencia (`WI-CORE-027`)». Aplicar en el corte D (ver §6 abajo para la dependencia).

### 5.4 §6.13 (línea 913)
Sustituir «La fila Reader incluye `GET /analysis-runs/{id}/trace`, implementado en `WI-CORE-026`; `/evidence` sigue pendiente de `WI-CORE-027`.» por «La fila Reader incluye `GET /analysis-runs/{id}/trace`, implementado en `WI-CORE-026`, y las tres rutas `/evidence`, implementadas en `WI-CORE-027`.» Aplicar en el corte D. Revisar también la matriz (línea ~980) para que no conserve «pendiente».

## 6. Contract Sync a Console (WI-CONSOLE-017) y dependencia de DEC-EVID-001

Productor: Core (`publishesContract=true`). Consumidor: Console (`WI-CONSOLE-017` evidencia; `WI-CONSOLE-020` trace ya consume). Sin impacto en Sandbox ni GitHub Integration. Core y Console mantienen espejo byte por byte de INTEROP; la copia de Console se actualiza por su propia sesión tras confirmación del usuario (handoff compacto, no se corrige en ese repo).

Checkpoints propuestos:
1. **CS-0 (start, ya registrado en 6de3cf6):** Console es consumidor pendiente; la forma de §6.16 puede cambiar hasta el corte C.
2. **CS-1 (fin de C, contrato congelado en `schemaVersion '1'`):** publicar el texto de §5.1 (tipos con `| null`, claves de unión, `technicallyEvaluable`, `metrics`, `config` nullable), las tres rutas, la matriz de 200/404/409 (`EVIDENCE_NOT_FINISHED`; `FAILED` de experimento y comparación = 200), la lista de lo no exportado y que `403` no es alcanzable con Reader. Pedir a Console: tolerar `null` en los campos indicados y no inferir CF/CO de `technicallyEvaluable`.
3. **CS-2 (fin de A, solo informativo):** nota IDEA-015 (§3); sin acción de Console salvo tolerar el valor `UNKNOWN`.
4. **CS-3 (corte D):** estados «implementado» (líneas 14, ~913, ~1132, ~1379), CHANGELOG y espejo; si DEC-EVID-001 = B, los tipos de §6.5 (`validRate`, `compilationRate`, `executionRate`, `passedRate`, medias de duración `number | null`; `evaluableRepetitions`/`nonEvaluableRepetitions`) con handoff aparte a Console para su mock y UI.
5. **CS-4 (cierre):** acuse del dueño de Console (o declaración del usuario) de que `WI-CONSOLE-017` consume la versión congelada; hasta entonces el estado en Core es «implementado, consumidor pendiente».

**Qué depende de DEC-EVID-001 (solo corte D):** el cambio de `StrategyMetricsResponse` en §6.5 (y su semántica en §6.5.1 «sin slots evaluables las tasas valen `0`»), sus pruebas en `experiments.service.spec.ts` y el checkpoint CS-3 sobre §6.5. **No depende:** la forma del bundle, las rutas, el saneado, la migración, los cortes A–C ni el texto de §6.16, que en ningún campo contiene tasas. Si se decide A o C (mantener `0`), §6.5 solo recibe contadores aditivos o ningún cambio y el corte D se reduce al cierre documental. Recomendación de proceso: cerrar documentalmente D (estados «implementado») solo cuando DEC-EVID-001 esté decidida o explícitamente diferida, para no declarar «implementado» con una obligación de WI-CORE-025 abierta.

## Recomendaciones resumidas
1. Resolver C1 antes de codificar `retrieval[].config` (opción a).
2. Incluir `pairId/pairPosition/randomizationSeed | null` y `generation.provider/model | null` en la enmienda B.
3. Mantener `schemaVersion '1'`; no editar §6.16 hasta el cierre del corte C (texto de §5.1) y las líneas de estado en D.
4. Corregir la viñeta DEC-EVID-004 del plan (IDEA-015 ya incluida).
5. Añadir `groundTruth`, `testCases`, `knowledgeId` a la prueba de claves prohibidas.
6. Contract Sync CS-1 al cerrar C; CS-3 con DEC-EVID-001 resuelta.
