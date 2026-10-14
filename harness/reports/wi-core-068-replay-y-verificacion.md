# WI-CORE-068 — replay offline, medición y criterio de verificación
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Versión del prompt PHP:** `php-prompt-2026-10-14.7` (solo cambia el texto de la marca en la sección de dependencias del brazo RAG; convenciones y agente sin cambio).

## Texto de las marcas
- Enum: « — enum: no se puede mockear ni instanciar con new; usa un caso (Enum::Caso)» (24 tokens, igual que la marca previa).
- `final class`: « — final: no se puede mockear; usa una instancia real con new» (15 tokens; antes 24 por «(new, o un caso si es un enum)»).

## M5 (top-10 idéntico)
Replay real V1 9/9 idéntico; `calibrate.mjs` sobre V1 (9 casos) y 22 experimentos de verificación: línea base 10/10 en los 31 casos. Sin cambio de recuperación, ranking, pesos, R-PHP ni targets.

## M4 (tokens de la sección; el prompt RAG varía lo mismo)
| Caso | Sección .6 | Sección .7 | Delta | Marcas afectadas |
|---|---|---|---|---|
| SAL-1 | 123 | 105 | −18 | 2 final (Customer, Promotion) |
| RES-1 / RES-2 | 145 | 127 | −18 | 2 final |
| SUB-1 / SUB-2 | 228 | 202 | −26 | RenewalDatePolicy, Subscription, + `Plan` (profundidad 2) |
| SUB-3 | 114 | 105 | −9 | Plan (final), SubscriptionStatus (enum, mismo tamaño) |
| SAL-2/3, RES-3 | 0 | 0 | 0 | — |
Sin truncado en ningún caso; el máximo es 202 ≤ 300. El prompt RAG completo baja entre 9 y 26 tokens en los casos con sección.

## M6 (V1 + 22 experimentos; sin regresión)
R-FINAL 0,90/1,0; R-SAME 1,0/0,33; R-NS 0,17/0,5; R-ANON-FINAL 0,83/1,0; R-STATIC-THIS 1,0/1,0; R-SIG 0,88/1,0; R-NEW-ENUM 1/1 (1,0/1,0). Idéntico a WI-CORE-067: las reglas son estáticas sobre `testContent`.

## Criterio de verificación para un experimento no oficial (SUB-3 y SUB-1/SUB-2)
1. Misma configuración que la verificación posterior a WI-067 (nano .6) y prompt `.7`.
2. No interferencia: `contextTokens`, `selectedChunks`, `retrievedChunks`, candidatos y `configuration` iguales; `dependencyContext` en la traza sin cambio (`SubscriptionStatus` sigue con `final: true`, sin campo `enum`); `promptSha256` de RAG distinto en los casos con sección; prompt del agente igual.
3. Efecto esperado: la sección de SUB-3 muestra «SubscriptionStatus … — enum: no se puede mockear ni instanciar con new; usa un caso (Enum::Caso)»; en `errorSummary` ningún «Cannot instantiate enum»; en `testContent` ningún `new SubscriptionStatus(` (R-NEW-ENUM sin hits); R-ANON-FINAL sin hits.
4. Comparar con `harness/calibration/calibrate.mjs` (R-NEW-ENUM, M4); sin n suficiente no se concluye mejora.
