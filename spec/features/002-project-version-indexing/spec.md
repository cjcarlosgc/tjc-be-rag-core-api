# 002-project-version-indexing — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** HU02, HU03, HU04, HU05, HU07

> **Retirado por SDD 2.0:** el ingreso ZIP queda retirado como ruta de producto (ver `CHANGELOG.md`); `ProjectVersion` se conserva como modelo, pero su único origen pasa a ser un snapshot inmutable por commit SHA desde un `RepositoryBinding` (HU33/34, pendiente de implementación), ejecutando `BOOTSTRAP` o `INDEX_DELTA` y ampliando el análisis a PHP/Laravel sin invalidar el soporte TypeScript existente. El contenido técnico de esta spec (chunking, snapshot, estados) sigue siendo referencia de implementación; su disparador ya no es la carga manual.

## Objetivo

Ingerir un ZIP seguro, crear un snapshot versionado e indexarlo para recuperación posterior.

## Reglas y comportamiento

- `POST /projects/index` multipart `file` + `projectId?` + `name?`; responde 202 con `projectId`, `projectVersionId`, `status=PENDING`, `pollAfterMs`.
- Nueva carga crea nueva ProjectVersion; nunca sobrescribe.
- El ZIP original se almacena con `upsert=false` en el bucket privado `repository-zips`; la key interna vigente es `repositories/{projectId}/versions/{projectVersionId}/original.zip`, preservando el versionado inmutable de HU07.
- PostgreSQL conserva únicamente la `snapshotKey` interna y metadata; nunca una URL firmada. La key no se expone al navegador.
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
- **Granularidad jerárquica (definitiva):** una declaración top-level `CLASS` produce un chunk `CLASS` con la declaración completa (imports relevantes, propiedades, herencia, todos sus métodos) **y además** un chunk hijo `METHOD`/`CONSTRUCTOR` por cada método/constructor de la clase, con `parentSymbolName` apuntando al `symbolName` de la clase dueña. `FUNCTION`, `INTERFACE`, `TYPE_ALIAS` y `ENUM` top-level siguen produciendo un único chunk cada uno, sin cambios.
- Si un archivo TypeScript no contiene alguna de esas declaraciones y su contenido no está vacío, se conserva un único chunk `FILE` con el archivo completo.
- **Oversized structured chunks:** cuando una declaración individual (`CLASS`, `METHOD`, `CONSTRUCTOR`, `FUNCTION`) supera `maxChunkTokens` (parámetro configurable, default `1500`, no una constante de arquitectura), se divide en partes ordenadas `PART 1..N` (`partIndex`/`partsTotal`) por bloques lógicos/statements de alto nivel, **sin solapamiento textual entre partes**. Cada parte conserva el mismo `symbolName`/`symbolKind` que el símbolo original y su metadata de adyacencia (`partIndex`, `partsTotal`), de modo que `ContextBuilder` (`004-rag-retrieval-context`) pueda expandir dinámicamente a partes vecinas en tiempo de retrieval si lo necesita; la indexación no decide esa expansión, solo la hace posible.
- Cada chunk conserva `filePath`, `symbolKind`, `symbolName`, `startLine`, `endLine`, `content`, `parentSymbolName` (nulo salvo en chunks `METHOD`/`CONSTRUCTOR`), `importsUsed` (módulos importados referenciados dentro del chunk) y `tokenCount`. `tokenCount` es un conteo real con el tokenizer del modelo de embeddings vigente (no una estimación heurística), calculado al crear el chunk y recalculado si el proyecto se reindexa.
- **Identidad del chunk:** queda scoped a `(projectVersionId, filePath, symbolKind, symbolName, partIndex)`. No se exige ni se implementa continuidad de identidad entre `ProjectVersion` distintas: cada versión es inmutable y genera su propio conjunto de chunks independiente; no hay noción de "el mismo chunk" a través de reindexaciones.
- El embedding se persiste en pgvector asociado a la `ProjectVersion` inmutable.
- `TestTargetExtractorService` extrae los objetivos testables del código de producción; `ExistingTestResolverService` relaciona esos objetivos con pruebas existentes. El inventario de objetivos y los chunks son productos diferentes de la misma indexación.
- `EmbeddingProvider` calcula embeddings por lotes y `CodeChunksRepository` persiste chunks/metadata/vector. `IndexingJobHandler` orquesta el pipeline, pero no concentra las reglas internas de discovery, parsing, inventario, embedding o persistencia.

### DEC-CHUNK-001 — Estrategia definitiva de representación para retrieval

**Estado:** APROBADO

**Resolución:** el diseño queda fijado como se describe arriba en "Contrato vigente de análisis y chunking" — granularidad jerárquica (clase completa + chunks por método/constructor), oversized structured chunks con `maxChunkTokens` configurable y sin overlap textual mientras se conserva identidad/orden/adyacencia, metadata mínima adicional (`parentSymbolName`, `importsUsed`), `tokenCount` real vía tokenizer, e identidad de chunk scoped a la `ProjectVersion` sin continuidad entre versiones. Queda pendiente su implementación (ver `tasks.md`); no invalida la indexación Sprint 1 ya implementada, que debe refinarse conforme a este diseño antes de que `004-rag-retrieval-context` lo consuma.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
