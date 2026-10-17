# WI-CORE-067 — replay offline, medición y criterio de verificación
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Versión del prompt PHP:** `php-prompt-2026-10-14.6`. Cambia solo la redacción de dos líneas; las cinco líneas suman 232 tokens (cl100k) frente a 196 de `.5`: **+36 tokens por prompt PHP** en RAG y agente (misma constante).

## M5 (top-10 idéntico)
- Replay real V1 (`php-dependency-replay.spec.ts`, datos externos): 9/9 con `relatedChunks`, candidatos, `contextTokens`, `selectedChunks` y `retrievedChunks` idénticos.
- `calibrate.mjs` sobre V1 (9 casos) + 22 experimentos de verificación (`calib-all67`): línea base **OK 10/10 en los 31 casos**.

## M4 (tokens; prompt RAG completo)
| Caso | .5 | .6 | extra | % |
|---|---|---|---|---|
| SAL-1 | 1093 | 1129 | 36 | 3,3 |
| SAL-2 | 880 | 916 | 36 | 4,1 |
| SAL-3 | 897 | 933 | 36 | 4,0 |
| RES-1 | 1033 | 1069 | 36 | 3,5 |
| RES-2 | 1039 | 1075 | 36 | 3,5 |
| RES-3 | 1132 | 1168 | 36 | 3,2 |
| SUB-1 | 1416 | 1452 | 36 | 2,5 |
| SUB-2 | 1383 | 1419 | 36 | 2,6 |
| SUB-3 | 1190 | 1226 | 36 | 3,0 |
El prompt del agente recibe los mismos +36 tokens (misma constante; sin sección de dependencias). Acumulado frente a `.3`: SUB-1/2 ≈ +195 tokens.

## M6 sobre V1 + 22 experimentos (31 casos; trials con evidencia real, incluidas rondas nano y Luna)
| Regla | Trials con hit | Hit y valid (posible FP) | Fallidos con evidencia | Precisión | Sensibilidad |
|---|---|---|---|---|---|
| R-FINAL | 20 | 0 | 18 | 0,90 | 1,0 |
| R-SAME | 1 | 0 | 3 | 1,0 | 0,33 |
| R-NS | 6 | 1 | 2 | 0,17 | 0,5 |
| R-ANON-FINAL (extends + implements) | 6 | 0 | 5 | 0,83 | 1,0 |
| R-STATIC-THIS | 2 | 0 | 2 | 1,0 | 1,0 |
| R-SIG | 8 | 0 | 7 | 0,88 | 1,0 |
| R-NEW-ENUM (nueva) | 1 | 0 | 1 | 1,0 | 1,0 |
Evidencia real reproducida: `46e82081`/`6b661170` (`new class implements RenewalDatePolicy`, «cannot implement … not an interface») y `5a1efbc2` (`Cannot instantiate enum …SubscriptionStatus`). Muestra pequeña: no es una estimación estable; el efecto de la redacción no se mide sin LLM.

## Criterio de verificación para un experimento no oficial (SUB-1/SUB-2/SUB-3)
1. Misma configuración que la verificación posterior a WI-066; declarar prompt `.6`.
2. No interferencia: `contextTokens`, `selectedChunks`, `retrievedChunks`, candidatos y `configuration` iguales; `dependencyContext` sin cambio; `promptSha256` distinto en RAG y agente (la redacción cambió en ambos).
3. Efecto esperado en `testContent`/`errorSummary`: ninguna clase anónima con `extends|implements` de un tipo `final` (sin «cannot extend final» ni «cannot implement … not an interface»); ningún `new` ni mock sobre un enum (sin «Cannot instantiate enum»); R-ANON-FINAL y R-NEW-ENUM sin hits.
4. Comparar con `harness/calibration/calibrate.mjs` (R-ANON-FINAL, R-NEW-ENUM, M4); sin n suficiente no se concluye mejora. Las rondas son pareadas: el agente recibe la misma redacción.
