# 002-project-version-indexing — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
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
- JavaScript puro (.js/.jsx/.mjs/.cjs) no pertenece al pool V1 aunque la tesis describa el dominio como ecosistema JavaScript/TypeScript.
- Proyecto incompatible: 422 `UNSUPPORTED_PROJECT`.

## Contrato vigente de análisis y chunking

- `FileDiscoveryService` filtra primero el snapshot y entrega únicamente archivos del pool V1; no todos los archivos del ZIP reciben el mismo tratamiento.
- `TypeScriptParserService` analiza con ts-morph los `.ts/.tsx` descubiertos, incluyendo archivos de producción y de pruebas.
- El chunking implementado produce un chunk por declaración top-level `CLASS`, `FUNCTION`, `INTERFACE`, `TYPE_ALIAS` o `ENUM`. Un chunk `CLASS` contiene la declaración completa de la clase, incluidos sus métodos; no crea actualmente chunks independientes por método.
- Si un archivo TypeScript no contiene alguna de esas declaraciones y su contenido no está vacío, se conserva un único chunk `FILE` con el archivo completo.
- Cada chunk conserva `filePath`, `symbolKind`, `symbolName`, `startLine`, `endLine`, `content` y una estimación de `tokenCount`; el embedding se persiste en pgvector asociado a la `ProjectVersion` inmutable.
- `TestTargetExtractorService` extrae los objetivos testables del código de producción; `ExistingTestResolverService` relaciona esos objetivos con pruebas existentes. El inventario de objetivos y los chunks son productos diferentes de la misma indexación.
- `EmbeddingProvider` calcula embeddings por lotes y `CodeChunksRepository` persiste chunks/metadata/vector. `IndexingJobHandler` orquesta el pipeline, pero no concentra las reglas internas de discovery, parsing, inventario, embedding o persistencia.

### DEC-CHUNK-001 — Estrategia definitiva de representación para retrieval

**Estado:** PENDING

**Blocks:** implementación de retrieval/context de `004-rag-retrieval-context`; no invalida ni bloquea la indexación Sprint 1 ya implementada

**Pregunta:** antes de usar los chunks como contrato experimental, decidir mediante análisis si se conserva el chunking actual o se refina: unidades adicionales (método/constructor/variable), límites para declaraciones extensas, solapamiento si aplica, metadata y relaciones estructurales, cálculo real del presupuesto y estabilidad de identidad entre reindexaciones/versiones.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
