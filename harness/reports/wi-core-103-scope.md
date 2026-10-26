# WI-CORE-103 — alcance: Context Builder por capas (C2 del Piloto v2)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Aprobado por el usuario (chat de Core, 2026-10-25):** «Apruebo D-v2-1 a D-v2-6 como los recomienda Core y el alcance de WI-CORE-102→105, incluido el Contract Sync aditivo INTEROP 2.22 a Console. Ábrelos en ese orden, uno a la vez, en feature/jean, sin push ni deploy hasta que yo lo ordene.»
D-v2-1: DEC-RAG-001 sigue PENDING; C2 sin trato especial a las pruebas (sin tope ni preferencia por pruebas; la capa 4 excluye archivos de prueba y el relleno es agnóstico). D-v2-2: umbral `semanticScore ≥ 0.60`; capa 3 ≤ 4000 tokens; capa 4 ≤ 2000 tokens; `topK=10` como techo del relleno; `maxContextTokens`=8000 sin cambio; `LAYERED` por defecto en código y `RANKED` opt-in; calibración solo con `smoke-*`. D-v2-6: Contract Sync aditivo a Console (INTEROP 2.22).

## Problema y evidencia (v1, arch-v1.0 cc3e49d303)
`ContextBuilder.build` ordena todos los candidatos por `0.7·semántico + 0.3·estructural` y recorta a `topK=10` ANTES del presupuesto. Un candidato solo estructural vale 0.30 y queda por debajo de cualquier candidato semántico (score combinado ≥ 0.36): la clase declarante entra solo si además es similar semánticamente.
- persistence-c1 RAG-1/3 (métodos abstractos sin implementar): clase declarante (1239 tok) rank 21, DISCARDED/TOP_K_LIMIT; contexto 542/8000 tokens.
- money-c2 RAG-2 (`Call to private Money::__construct()`): la parte de `Money` con `private function __construct` (src/Money.php:43-220, 1500 tok) rank 24, 0.30, DISCARDED/TOP_K_LIMIT.
Spec/código: `context-builder.service.ts:87-94,165-187` (topK antes del presupuesto), `retrieval.service.ts:263-270` (R-PHP5), spec 004 `:21`, 018 `:118-119`.

## Alcance
`ContextBuilder.build` gana la estrategia `LAYERED` (PHP) y conserva la actual como `RANKED` (línea base comparable). Todo dentro del mismo `maxContextTokens` (8000), sin cambiarlo.
- Selección por estrategia: `LAYERED` por defecto en código; `RANKED` solo si `RETRIEVAL_CONTEXT_STRATEGY=RANKED`. `LAYERED` aplica solo a proyectos PHP (`metadata.language==='php'`); TypeScript sigue con `RANKED` (declarado).
- Capas, en orden, hasta agotar su tope y siempre dentro de `maxContextTokens`:
  1. target (como hoy);
  2. reglas funcionales (FK): como hoy, descuentan tokens antes que cualquier chunk (CT-05-A4);
  3. clase declarante: candidatos con `structuralMatch=DECLARING_CLASS` (todas las partes), en orden de `startLine` (la cabecera, propiedades y constructor van primero), tope `RETRIEVAL_DECLARING_CLASS_MAX_TOKENS` (4000); lo que no cabe en el tope o en el presupuesto queda DISCARDED/`TOKEN_BUDGET`;
  4. evidencia del target: candidatos no seleccionados, que NO sean archivos de prueba (`isTestFile`), con `structuralMatch ∈ {IMPORTS, FULLY_QUALIFIED_REFERENCE, SAME_NAMESPACE}`, por `combinedScore` descendente, tope `RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS` (2000). `IMPORTED_BY` queda fuera de esta capa (era el ruido de WI-056);
  5. relleno semántico: resto con `semanticScore ≥ RETRIEVAL_RELEVANCE_THRESHOLD` (0.60) por `combinedScore` descendente, como máximo `topK` (techo del relleno) y hasta agotar `maxContextTokens`.
- Motivos de descarte: `BELOW_MINIMUM_SCORE` (como hoy, sobre el score combinado), nuevo `BELOW_RELEVANCE_THRESHOLD` (sin `semanticScore` o por debajo del umbral y no seleccionado por las capas 3–4), `TOP_K_LIMIT` (techo del relleno), `TOKEN_BUDGET` (tope de capa o de presupuesto). `RANKED` solo usa los tres de hoy.
- Traza (aditivo, INTEROP-2.22): `layer` opcional en el candidato seleccionado (`DECLARING_CLASS | TARGET_EVIDENCE | RELEVANT_SEMANTIC`, null si descartado) y en `configuration`: `strategy`, `relevanceThreshold`, `declaringClassMaxTokens`, `targetEvidenceMaxTokens` (ausentes en trazas anteriores). `contextTokens`, `selectedChunks`, `retrievedChunks` conservan su significado.
- Variables nuevas (validación en `env.validation.ts`, defaults en código): `RETRIEVAL_CONTEXT_STRATEGY` (`LAYERED|RANKED`, default `LAYERED`), `RETRIEVAL_RELEVANCE_THRESHOLD` (0–1, 0.60), `RETRIEVAL_DECLARING_CLASS_MAX_TOKENS` (4000), `RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS` (2000).
- D-5 (`assessContextSufficiency`): `BELOW_RELEVANCE_THRESHOLD` se trata como `BELOW_MINIMUM_SCORE` (no cuenta como candidato relevante); con `LAYERED` y clase declarante indexada la cláusula (b) casi nunca se cumple (limitación declarada en spec 004 y en CT-05-A5).
- Superficies de traza a actualizar: `retrieval/generation-context.ts` (tipos), `context-traces/context-traces.service.ts` (validación estricta de lo almacenado: acepta el motivo y los campos nuevos), `experiments/dto/context-trace.response.ts`, `experiments/experiment-attempt-presenters.ts`, `evidence/evidence-mapping.ts`, DTO de la comparación de retrieval (solo tipos), y el `audit` que ya se persiste.

## Fuera de alcance
Retriever, ranking y pesos (`RetrievalService`, `scoreCandidate`, `resolveWeights`): NO cambian; comparación OE2 intacta (se fija con test dorado). Trato especial a pruebas (DEC-RAG-001). TypeScript. R2 (WI-104). Cambiar `maxContextTokens`, `topK`, `minimumScore` por defecto.

## Contrato
INTEROP 2.21→2.22 (minor, aditivo, `breaking:false`): trazas de contexto RAG (`RagDiscardReason`, `RagCandidateNodeResponse.layer?`, `configuration.*?`, §6.7 en el índice del documento). INTEROP se espeja byte a byte en los cuatro repositorios: el evento de Contract Sync va a Console (debe tolerar/etiquetar los valores nuevos), GitHub Integration y Sandbox (re-espejo documental, sin cambio de código). Sin cambio de ruta ni de schemas JSON (`contracts:check` limpio). SYSTEM-2.16 no cambia.

## Hecho cuando
Pruebas de cada capa, tope, motivo de descarte y orden; `RANKED` idéntico al comportamiento anterior (pruebas existentes sin tocar); TypeScript sin cambio; D-5 coherente; la traza y su validación aceptan lo nuevo y siguen leyendo trazas anteriores; test dorado OE2 (misma entrada ⇒ mismo ranking y mismos candidatos); Contract Sync publicado y revisión del contract-reviewer; CT-05-A2/A3/A5/A6 re-declaradas; lint, build y test en verde; revisión independiente del reviewer.
