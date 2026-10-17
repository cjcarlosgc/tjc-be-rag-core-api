# WI-CORE-056 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador: «WI-056: AUTORIZADO `SELECT` de solo lectura sobre la DB real (`code_chunks`, `context_traces`, `experiment_repetitions` de los dos experimentos) con la credencial de `app/.env`, sin versionarla ni escribir».

## Alcance
Informe de análisis (sin cambios de producto): diagnóstico del ruido del contexto RAG (70% tests ajenos en el experimento 1; 9/10 símbolos vecinos en el experimento 2), propuesta que priorice target y reglas sobre `topK` fijo, y antes/después simulado offline sobre las mismas entradas de los experimentos `89a16229…` y `800689b9…` (solo `SELECT` en transacción de solo lectura; sin LLM; sin escribir; sin aplicar ni fusionar), con riesgos. La credencial se lee de `app/.env` en el proceso y no se imprime ni se versiona. No cambia ranking ni contexto RAG; cualquier cambio posterior requiere su WI y aprobación.
