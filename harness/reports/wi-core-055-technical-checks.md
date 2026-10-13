# WI-CORE-055 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low); verificación del leader.
- Rojo → verde: 5 de 9 pruebas nuevas fallaban antes (método calificado con y sin `\` inicial, `Clase::método`, `Clase.método`, método en namespace con llaves, clase calificada); después `src/generation/agent` 46/46 (pruebas PHP y TypeScript previas intactas).
- `npx vitest run` (app): 140 archivos pasan, 6 omitidos; 2211 pruebas pasan, 104 omitidas. `oxlint src/generation` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base).
- `validate-harness` y `node --test harness/*.test.mjs` pasan. Sin build; `app/.env` no tocado.
- Alcance: solo `workspace-agent-tools.ts` y su spec; sin ranking/contexto RAG, experimentos (más allá de la herramienta del agente), evidencia, métricas ni contratos. Nota: un nombre TypeScript con `.` ahora busca referencias por el último segmento (antes un nombre con `.` no coincidía con ninguna declaración).
