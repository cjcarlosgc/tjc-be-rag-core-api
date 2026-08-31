# 002-project-version-indexing — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU02, HU03, HU04, HU05, HU07

## Objetivo

Ingerir un ZIP seguro, crear un snapshot versionado e indexarlo para recuperación posterior.

## Reglas y comportamiento

- `POST /projects/index` multipart `file` + `projectId?` + `name?`; responde 202 con `projectId`, `projectVersionId`, `status=PENDING`, `pollAfterMs`.
- Nueva carga crea nueva ProjectVersion; nunca sobrescribe.
- Bloquear indexación simultánea del mismo Project con 409 `PROJECT_INDEXING_IN_PROGRESS`.
- ZIP: extensión/MIME/no vacío/tamaño/safe paths/Zip Slip/cleanup.
- Estados: PENDING -> EXTRACTING -> ANALYZING -> CHUNKING -> EMBEDDING -> PERSISTING -> COMPLETED; cualquier activo -> FAILED.
- `GET /project-versions/:id`; `GET /project-versions/:id/results`; antes de completar: 409 `ANALYSIS_NOT_FINISHED`.
- Pool V1: .ts/.tsx, package.json, tsconfig.json, jest.config.*, vitest.config.*, *.spec.ts(x), *.test.ts(x). Ignorar node_modules,.git,dist,build,coverage,.next.
- Proyecto incompatible: 422 `UNSUPPORTED_PROJECT`.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
