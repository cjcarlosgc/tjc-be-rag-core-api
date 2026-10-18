# tjc-be-rag-core-api

Backend de dominio PR-driven: AnalysisRuns por PR/HEAD, indexación versionada, recuperación RAG, conocimiento funcional, generación/validación de pruebas y evaluación RAG vs GENERALIST_AGENT. Toda la interacción directa con GitHub vive en `tjc-be-github-integration-api`; Core conserva el dominio y el ZIP interno de snapshot para Docker/Sandbox.

## Estructura

- `spec/`: fuente funcional/técnica vigente.
- `harness/`: workflow, estado y evidencia de implementación.
- `scripts/`: validadores neutrales de SDD.
- `.claude/` y `.agents/`: adaptadores opcionales; no son fuente de verdad.
- `app/`: código fuente generado.

## Inicio

1. Leer `AGENTS.md`.
2. Leer `spec/README.md`.
3. Ejecutar `node scripts/sdd-check.mjs`.
4. Seleccionar un WI local de `harness/work-items.json` enlazado desde `tasks.md`, registrarlo en `harness/state.json` y ejecutar `node harness/validate-harness.mjs`.
