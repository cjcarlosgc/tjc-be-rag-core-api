# WI-CORE-057 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low) en cortes A a D; contrato por el leader con contract-reviewer (`harness/reports/wi-core-057-contract-review.md`, CHANGES_REQUESTED aplicado).
- Código: corte A `4bbed5fc116333bf3006d5c1628ccbcc7bd9c50c`, corte B `7acbcdadd59a0653c3c588202dd5f8b174d4cdc8`, cortes C y D `dcfee56f3baf5997ac8674115df77cf84a14fdd3`; contrato `5e6d8a637beb0dec359b352e5d3f1b810abce598` (INTEROP-2.14 y spec 004).
- `npx vitest run` (app): 144 archivos pasan, 7 omitidos (uno es el replay, que requiere datos externos); 2276 pruebas pasan, 104 omitidas. `oxlint src` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base).
- `validate-harness` y `node --test harness/*.test.mjs` pasan. Sin build; sin migraciones; sin tocar ranking, pesos, `topK`, `minimumScore`, R-PHP1..5, `contextTokens`, experimentos (más allá de pasar la sección), agente generalista ni evidencia §6.16. `DEC-RAG-001` no se cerró.
- Replay offline: `harness/reports/wi-core-057-replay-y-verificacion.md` (top-10 idéntico en 9/9; tokens extra 0 a 91).
- Riesgo declarado: el constructor de `ExperimentJobHandler` y de `AnalysisRunValidationJobHandler` ganó un parámetro posicional (los specs se actualizaron); el prompt puede superar `maxContextTokens` hasta en 300 tokens.
