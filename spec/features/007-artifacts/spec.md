# 007-artifacts — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU15, HU16, HU17, HU18, HU27

## Objetivo

Persistir y entregar artefactos generados/modificados de un TestGenerationRun.

## Reglas y comportamiento

- Artifact: id,runId,relativePath,artifactType CREATED|MODIFIED,storageKey,valid.
- Storage path `test-runs/{runId}/artifacts/...`.
- Endpoints: artifact download, download all, diff.
- Diff compara original congelado vs artifact final; CREATED -> 409 DIFF_NOT_AVAILABLE.
- Las rutas y DTOs para listar, diff y descargar son los definidos en `spec/contracts/interoperability-contract.md`; `storageKey` nunca se expone al navegador.
- `ArtifactResponse.targetIds` declara qué targets del run se materializaron en el archivo y permite abrir el contexto focalizado de un artefacto sin inferirlo por nombre.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
