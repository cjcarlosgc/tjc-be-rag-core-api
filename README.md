# tjc-be-rag-core-api

Backend principal de la tesis: indexación versionada, recuperación RAG, generación de pruebas, orquestación de validación y evaluación experimental RAG vs baseline.

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
4. Seleccionar trabajo en `harness/state.json`.
