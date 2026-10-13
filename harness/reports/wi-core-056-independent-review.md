Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-056 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**Veredicto: CHANGES_REQUESTED** (correcciones menores de texto; sin blockers de alcance ni de seguridad).

Alcance revisado: `harness/reports/wi-core-056-rag-context-noise-analysis.md`, `wi-core-056-scope-approval.md`, `wi-core-056-technical-checks.md`. Sin acceso a la base de datos ni a `app/.env`; solo datos extraídos (`rag_traces.json`, `sim.json`) y código en `app/src`.

## 1. Cifras recalculadas desde `rag_traces.json`
Verificadas sin discrepancia:
- Configuración (topK 10, minimumScore 0, 0.7/0.3, maxContextTokens 8000); las 3 repeticiones de cada experimento tienen candidatos idénticos; recuperados 23/20, seleccionados 10/10; contexto 756/569 tokens.
- Exp. 1: 8/10 seleccionados son pruebas (7 métodos de prueba + el chunk de la clase de pruebas, 177 tok), 397/739 = 53,7 % de tokens, 80 % de chunks; ninguna menciona `hasStock` (solo el chunk de la clase declarante); los otros 2 son la clase (326) e `isEmpty`; 13 descartados todos `TOP_K_LIMIT`.
- Exp. 2: 9/10 vecinos, 296/348 = 85 %; solo `Voucher` (52 tok) relevante; 10 descartados `TOP_K_LIMIT`; la única prueba candidata (`test_negative_quantity_is_rejected`) quedó en rank 20.
- Tabla P1-P3: reproduje las 6 celdas (n y tokens) con una reimplementación independiente; todas coinciden. Las reducciones «33 % y 38 %» y «7 pruebas / 5 de 9 vecinos» son correctas.

## 2. Código/configuración
- topK 10 y pesos 0.7/0.3 por defecto, `minimumScore` 0 y descarte `TOP_K_LIMIT`: verdaderos (`app/src/retrieval/context-builder.service.ts`).
- `IMPORTED_BY` es de clase: verdadero (`retrieval.service.ts`, R-PHP2: el chunk candidato importa la clase del target; sin granularidad de método).
- **`maxContextTokens`: parcialmente falso** (hallazgo F1).

## Hallazgos

**F1 — medium — `maxContextTokens` sí se usa.** §3 afirma «`maxContextTokens` ya existe y hoy no se usa». `ContextBuilder.build` lo aplica tras el corte por topK (líneas ~147 y ~167 de `context-builder.service.ts`): omite reglas y descarta chunks con `TOKEN_BUDGET`, y `RETRIEVAL_MAX_CONTEXT_TOKENS` es configurable; `spec/features/004` y `011` lo documentan. En estas corridas solo es no vinculante (569/756 < 8000), lo que sí dice §1. Corregir §3: lo que no existe es selección por presupuesto *en lugar de* topK con umbral y capas, no el presupuesto en sí. recommendedNextStep: reescribir la frase de §3 y precisar en §1 «no vinculante» y que el presupuesto actúa después del topK.

**F2 — medium — políticas P1-P3 no reproducibles solo con el texto.** El informe describe umbral/presupuesto/≤N pruebas pero no fija: (a) el presupuesto incluye los tokens del target (sin eso, P2 exp. 1 daría 3 chunks/391 tok, no 2/375); (b) el umbral se aplica a `semanticScore`, no al combinado; (c) clase declarante y constructor entran siempre (el constructor es un candidato descartado/rank 21 en exp. 1, y rank 14 en exp. 2, que el baseline no seleccionó); (d) las pruebas admitidas (≤N, por rank) están exentas del umbral; (e) las columnas «tokens» excluyen el target; (f) el script de simulación no se conserva (solo `sim.json` en scratchpad fuera del repo). Pude reproducirlo por inferencia, pero un lector no. recommendedNextStep: añadir un párrafo con estas reglas exactas (o anexar el script como artefacto del informe).

**F3 — low — rango semántico del exp. 2.** §2 dice «similitud semántica (0.50–0.77)»; los 9 vecinos seleccionados van de 0,497 a 0,706; 0,77 es la clase `Voucher` (relevante). recommendedNextStep: corregir a 0.50–0.71.

**F4 — low — tokens de reglas no explicados.** El exp. 2 declara «348 de candidatos (+36 target)» = 384 frente a un contexto de 569; los ~185 restantes son de las 2 reglas funcionales (inferido) y no se mencionan. Aclararlo evita que el lector crea una discrepancia. El porcentaje 85 % es sobre tokens de candidatos, correcto pero conviene decirlo.

**F5 — low — DEC-RAG-001 no se nombra como bloqueante de la propuesta.** DEC-RAG-001 sigue `PENDING` y bloquea todo WI que implemente recuperación/ranking test-aware; los pasos 2-3 de la propuesta (pruebas que ejercitan el target, `TEST_OF_TARGET`, ≤1 prueba de estilo) caen en ese supuesto, y la política P1 contradiría la definición vigente de SE («10 primeros», spec 004/OE2) si se aplicara al producto. El informe lo menciona solo como riesgo. recommendedNextStep: en §3/§6 declarar que cualquier implementación exige resolver DEC-RAG-001 y una enmienda de la definición de SE o un modo experimental aparte.

## 3. Honestidad y coherencia
- No afirma mejoras de calidad: lo declara expresamente en §4 y §5 (muestra mínima, pool de 20-23, proxy, sin LLM, sobreajuste). Correcto.
- La nota «el fallo del exp. 2 no se debe al ruido» es coherente con `harness/reports/exp-rag-vs-ga-observaciones-2026-10-13.md` (reglas ACTIVE exigen `InvalidArgumentException`; código devuelve `0.0`; 3/3 `TEST_ASSERTION`), con spec 013/008 (reglas ACTIVE = verdad funcional) y con WI-CORE-054 (`technicallyValidRate`). Exp. 1 2/3 vs 2/3 coincide. No pude verificar contra la DB (fuera de mi autorización); se apoya en el reporte previo.
- La explicación de por qué «70 %» (plan WI-053/056) difiere de 80 %/54 % es honesta aunque algo confusa; aceptable.

## 4. Decisiones y alcance
- No cambia código, ranking ni contexto; no contradice DEC-RC-00x (ninguna toca el contexto) ni el alcance aprobado. Las tres decisiones pedidas al usuario (replay offline, ablación con LLM, política de producto) son claras y no se presentan como cerradas; ver F5 para DEC-RAG-001.

## 5. Secretos
- Sin credenciales, URL de DB ni identificadores sensibles en el informe ni en los reportes WI-056; solo prefijos de ID de experimento y nombres de clases de un proyecto de prueba. `grep` de patrones de secretos sin coincidencias.

## 6. Gates
- `node harness/validate-harness.mjs`: pasa. `node --test harness/*.test.mjs`: 31/31 pass. `git status` limpio (sin cambios en `app/`); el WI solo añade documentos del harness.

## Resumen
status: CHANGES_REQUESTED · blockers: ninguno · filesAffected: `harness/reports/wi-core-056-rag-context-noise-analysis.md` (F1-F5) · recommendedNextStep: el leader corrige F1 y F2 (y F3-F5 si es barato) en el informe y solicita el ciclo 2 de revisión; no se requiere decisión del usuario para estas correcciones.

---

# Ciclo 2 de 2 (Modo fuera de casa) — revisión de la corrección e1be98b

Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium. Sin acceso a la base de datos; solo `rag_traces.json` extraído y código/spec del repositorio.

**Veredicto final: APPROVED** (una observación menor no bloqueante).

| Hallazgo | Estado | Evidencia |
|---|---|---|
| F1 `maxContextTokens` | Resuelto | §1 y §3 lo describen como `TOKEN_BUDGET` posterior al `topK`, no vinculante en estas corridas (569/756 < 8000); coincide con `context-builder.service.ts` (líneas 151 y 170). |
| F2 simulación reproducible | Resuelto | Reimplementé P1-P3 solo con la definición del informe (presupuesto incluye target; umbral sobre `semanticScore`; pruebas admitidas exentas del umbral; clase declarante, constructor y evidencia entran primero) y reproduje las 6 celdas: P1 8/497/2 (375) y 7/215/2 (62); P2 2/375/2 y 3/85/2; P3 11/555/2 y 11/352/2. Nota: el constructor figura como símbolo `constructor` en las trazas. |
| F3 rango 0.50–0.71 | Resuelto | Vecinos seleccionados exp. 2: 0,497–0,706; 0,77 es la clase `Voucher`. |
| F4 ~185 tokens de reglas | Resuelto | 569 − 36 − 348 = 185; 2 reglas seleccionadas en la traza (atribución a reglas inferida pero consistente). |
| F5 DEC-RAG-001 | Resuelto | Listado en §5 como decisión PENDING bloqueante; coincide con `spec/features/004.../spec.md` (`Blocks`: WI futuro test-aware). |

## Observación menor (no bloqueante, sin ciclo adicional)
- §5 dice que `DEC-RAG-001` «define hoy la selección como los 10 primeros por puntaje»: impreciso; esa definición viene de spec 004/OE2, y `DEC-RAG-001` es la decisión pendiente sobre una señal test-aware. Sugerencia de redacción: «la selección vigente (spec 004: los 10 primeros por puntaje) se contradiría al aplicar P1, y la parte test-aware exige resolver `DEC-RAG-001`». Tampoco se repite en §3/§6; basta con §5.

## Pendiente
- Nada bloqueante. `node harness/validate-harness.mjs` pasa; sin cambios en `app/`. El leader puede corregir la frase anterior si quiere, sin nueva revisión.
