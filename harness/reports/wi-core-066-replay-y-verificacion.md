# WI-CORE-066 — replay offline, medición y criterio de verificación
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Versión del prompt PHP:** `php-prompt-2026-10-14.5` (solo cambia el contenido de la sección RAG; la redacción de las convenciones no cambia).

## M5 (top-10 idéntico)
El replay real (`php-dependency-replay.spec.ts`, datos V1 externos) pasa 9/9; `calibrate.mjs` con `deps.json` actualizado mantiene M5 10/10 en los 9 casos. Sin cambio de ranking, pesos, `topK` ni R-PHP.

## Profundidad 2 y M4 (cl100k)
| Caso | Entradas profundidad 2 | Sección .4 | Sección .5 | Extra | Truncado |
|---|---|---|---|---|---|
| SUB-1 | `Plan` vía `Subscription`: `(public string $code, public float $monthlyPrice)` | 176 | 228 | +52 | no |
| SUB-2 | igual | 176 | 228 | +52 | no |
| SUB-3 | — (Plan ya directa) | 114 | 114 | 0 | no |
| SAL-1/2/3, RES-1/2/3 | — | sin cambio | sin cambio | 0 | no |
Tope de 300 tokens: la sección máxima es 228, por lo que no trunca en ningún caso V1. Prompt RAG completo SUB-1: 1364 → 1416 tokens (+3,8 %); acumulado frente a `.3`: +159 tokens (+12,6 %) en SUB-1/2.

## M1, R-SIG y reglas
- M1 sección sin cambio: SUB-1/SUB-2 4/4 (Plan presente en la sección con firma «vía Subscription»); top-10 1/4 igual.
- M6 sin regresión: las reglas son estáticas sobre `testContent` y no dependen de la sección; resultados V1 idénticos (R-FINAL 3/0/5 en SUB-1…). R-SIG deriva la firma de `Plan` del chunk `CONSTRUCTOR` (o de `deps.json signatures`, ahora con Plan), por lo que su precisión/sensibilidad medida en WI-065 (0,83 / 1,0 sobre 11 experimentos) no cambia; el efecto sobre `ArgumentCountError` solo se mide con un experimento nuevo.

## Criterio de verificación para un experimento no oficial (SUB-1/SUB-2 y resto)
1. Misma configuración que la verificación posterior a WI-065; declarar prompt `.5`.
2. No interferencia: `contextTokens`, `selectedChunks`, `retrievedChunks`, candidatos y `configuration` iguales; `dependencyContext` sin campo nuevo (solo directas; `Plan` NO aparece en la traza); `promptSha256` de RAG distinto del anterior en SUB-1/SUB-2 (el prompt del agente no cambia).
3. Efecto esperado: el prompt RAG de SUB-1/SUB-2 incluye la línea `Plan … (vía Subscription) — constructor(public string $code, public float $monthlyPrice)`; en `testContent` ningún `new Plan(...)` sin `$code` y sin `ArgumentCountError` por `Plan`; reglas R-ANON-FINAL/R-STATIC-THIS sin hits.
4. Comparar con `harness/calibration/calibrate.mjs` (R-SIG, M4); sin n suficiente no se concluye mejora.
