# WI-CORE-056 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Corte de análisis (HARNESS): sin cambios en `app/`, contratos, migraciones ni base de datos.
- Lectura: `psql` con `default_transaction_read_only=on` y `statement_timeout`, solo `SELECT` sobre `experiment_runs`, `experiment_repetitions`, `context_traces`, `functional_knowledge` y `code_chunks`; la credencial se tomó de `app/.env` dentro del proceso y no se imprime ni se versiona. No se ejecutó ninguna escritura, DDL ni LLM.
- Datos extraídos a un JSON temporal fuera del repositorio (scratchpad) con las trazas RAG de los dos experimentos; la simulación es un script determinista sobre esos datos.
- `node harness/validate-harness.mjs` y `node --test harness/*.test.mjs` pasan. Informe: `harness/reports/wi-core-056-rag-context-noise-analysis.md`.
