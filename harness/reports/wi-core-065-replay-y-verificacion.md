# WI-CORE-065 — replay offline, medición y criterio de verificación
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Versión del prompt PHP:** `php-prompt-2026-10-14.4`.

## M5 (top-10 idéntico)
El replay real (`php-dependency-replay.spec.ts`) pasa 9/9 con `relatedChunks`, candidatos, `contextTokens`, `selectedChunks` y `retrievedChunks` idénticos; `calibrate.mjs` mantiene 10/10 en 15 casos. No se toca ranking, pesos, `topK` ni R-PHP.

## M4 (tokens, cl100k; prompt `.3` → `.4`)
| Caso | .3 | .4 | extra | % | sección sin firmas → con firmas |
|---|---|---|---|---|---|
| SAL-1 | 999 | 1093 | 94 | 9,4 | 99 → 123 |
| SAL-2 | 810 | 880 | 70 | 8,6 | igual |
| SAL-3 | 827 | 897 | 70 | 8,5 | igual |
| RES-1 | 930 | 1033 | 103 | 11,1 | 112 → 145 |
| RES-2 | 936 | 1039 | 103 | 11,0 | 112 → 145 |
| RES-3 | 1062 | 1132 | 70 | 6,6 | igual |
| SUB-1 | 1257 | 1364 | 107 | 8,5 | 139 → 176 |
| SUB-2 | 1224 | 1331 | 107 | 8,7 | 139 → 176 |
| SUB-3 | 1107 | 1190 | 83 | 7,5 | 101 → 114 |
Convenciones: 70 tokens (dos líneas de 35). La sección nunca supera 300 tokens.

## M6 (reglas estáticas sobre V1 + 11 experimentos; no mide calidad)
| Regla | Aciertos | Precisión | Sensibilidad |
|---|---|---|---|
| R-ANON-FINAL | 2/2 | 1,0 | 1,0 |
| R-STATIC-THIS | 2/2 | 1,0 | 1,0 |
| R-SIG | 6 hallazgos, 5 con evidencia | 0,83 | 1,0 |
| R-FINAL | 13/13 | 1,0 | — |
| R-SAME | 1 acierto | — | 0,33 |
| R-NS | 1 acierto válido | 0,17 | — |
En los 9 casos V1 las reglas nuevas no se activan (0 hallazgos): las fallas viven en las verificaciones posteriores (ArgumentCountError 4/6 RAG, clase anónima sobre `RenewalDatePolicy`, closures `static`). El efecto real no se mide sin LLM.

## Criterio de verificación para un experimento no oficial
1. Misma configuración que la verificación posterior a WI-064; declarar resolutor WI-057/058, `inspect_symbol` WI-059, prompt `.4`.
2. No interferencia: traza con `contextTokens`, `selectedChunks`, `retrievedChunks`, candidatos y `configuration` iguales; `dependencyContext` sin campo `signature`; `promptSha256` distinto del anterior en ambos brazos.
3. Efecto esperado en `testContent`: ningún `new Plan(...)`/equivalente sin argumentos obligatorios en RAG (sin `ArgumentCountError`); ninguna clase anónima que extienda un tipo `final`; ningún closure `static` que use `$this`; sin `Cannot extend final class` ni «Using $this when not in object context» en `errorSummary`.
4. Comparar con `harness/calibration/calibrate.mjs` (R-ANON-FINAL, R-STATIC-THIS, R-SIG, M4); sin n suficiente no se concluye mejora.
