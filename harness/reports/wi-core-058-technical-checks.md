# WI-CORE-058 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low); contrato por el leader con contract-reviewer (`harness/reports/wi-core-058-contract-review.md`, APPROVED).
- Contrato: `4b0f34a3a73d50df1c2b88934e8a2350732067a9` (INTEROP-2.15 y spec 004). Código: `334708c2c7b88bc1d4b57ab67d3b229f26738408`.
- Rojo → verde: `isFinalPhpDeclaration` y render fallaban antes (22 fallos en el primer run del archivo), servicio con marcas, traza con `final: true`, `makeRagDetail` con `final: true`; guardas verdes por diseño (traza sin `final`/con `false`/basura, error de consulta sin marcas).
- `npx vitest run` (app): 144 archivos pasan, 7 omitidos (uno es el replay con datos externos); 2312 pruebas pasan, 104 omitidas. `oxlint src` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base).
- `validate-harness` y `node --test harness/*.test.mjs` pasan. Sin build; sin migraciones; ranking, pesos, `topK`, `minimumScore`, R-PHP1..5, `contextTokens`, agente generalista y evidencia §6.16 sin cambios; `DEC-RAG-001` sin cerrar.
- Riesgos: +24 tokens por marca (hasta 25 % del contexto base en estos casos, dentro del tope de 300); en un FQCN con dos declaraciones el repositorio devuelve una fila; el repositorio nuevo `findPhpTypeDeclarations` se prueba a través del servicio y del replay.
