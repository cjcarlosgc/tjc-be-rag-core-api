# 002-project-version-indexing — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** HU03, HU04, HU06

## Objetivo

Indexar un snapshot inmutable del commit asociado a un `AnalysisRun` para recuperar código, relaciones y tests existentes.

## Reglas y comportamiento

- La entrada es un commit SHA de un repositorio vinculado y autorizado. Cada `ProjectVersion` representa un snapshot inmutable; un HEAD nuevo no sobrescribe evidencia del anterior.
- El snapshot ZIP es un transporte **interno** entre materialización, Object Storage y Docker/Sandbox. Se valida integridad y se materializa con rutas seguras; no existe endpoint de carga de código desde el navegador.
- PostgreSQL conserva únicamente la `snapshotKey` interna y metadata; nunca una URL firmada. La key no se expone al navegador.
- La concurrencia se controla por Run/HEAD y jobs idempotentes, sin bloquear todo el Project por una carga manual.
- Validar tamaño, entradas seguras, Zip Slip e integridad del snapshot interno; limpiar siempre el workspace temporal.
- Estados: PENDING -> EXTRACTING -> ANALYZING -> CHUNKING -> EMBEDDING -> PERSISTING -> COMPLETED; cualquier activo -> FAILED.
- `GET /project-versions/:id`; `GET /project-versions/:id/results`; antes de completar: 409 `ANALYSIS_NOT_FINISHED`.
- Pool V1: `.ts/.tsx`, `package.json`, `tsconfig.json`, `jest.config.*`, `vitest.config.*`, `*.spec.ts(x)`, `*.test.ts(x)`. Ignorar `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`.
- Pool PHP V1, definido en `018-php-laravel-support` y `019-project-root-detection`: `.php`, el `composer.json` primario bajo el `projectRoot` detectado y configuración PHPUnit; ignorar dependencias (`vendor`) y directorios generados/de runtime. Un único candidato PHP se detecta aunque esté en un subdirectorio y prevalece para ese Project; un `package.json` hermano no mezcla parsers. La indexación PHP queda confinada al `projectRoot` y conserva paths canónicos relativos a la raíz del repositorio.
- **Composición del snapshot que recibe el Sandbox en proyectos PHP (WI-CORE-102, C1 del Piloto v2).** El ZIP que viaja a Object Storage y al Sandbox contiene el pool PHP (arriba) **y**, añadidos después de indexar y justo antes de zipear, los *fixtures* de texto del repositorio: archivos con extensión `conf`, `csv`, `tsv`, `json`, `yml`, `yaml`, `xml`, `ini`, `txt`, `neon`, `sql` o `dist` en cualquier directorio no ignorado, salvo cualquier ruta con un segmento que empiece por `.` (`.env*`, `.github`, etc.) y los lockfiles de Node (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`). Topes: 500 archivos, 1 MiB por archivo y 5 MiB en total, en orden de ruta; lo que supera un tope, no se puede leer o no es UTF-8 válido se omite y se registra solo con contadores (sin rutas ni contenido) y nunca tumba la materialización. Solo aplica a proyectos PHP (con `composer.json` no ignorado); TypeScript no cambia. Los fixtures **no** forman parte del pool: no entran en el índice, ni en `FileDiscoveryService`, ni en las herramientas del `GENERALIST_AGENT`, ni se envían a OpenAI; viajan en el ZIP del snapshot (Object Storage, igual que el resto del snapshot) y en el workspace temporal de Core, y solo se ejecutan en el workspace del Sandbox, igual para ambos brazos y para Validation y experimentos. Un fixture nunca es archivo del pool (`isPoolFile`: `package.json`, `tsconfig.json`, `jest.config.*`, `vitest.config.*` no viajan como fixtures) ni tiene un nombre base que contenga `auth`, `credential(s)`, `secret(s)` o `service-account` como palabra; un fixture cuya relación de compresión supere 80 se omite porque el Sandbox rechaza el snapshot entero si una entrada supera 100. La exclusión por nombre es una heurística, no un control de secretos (p. ej. `token.json` o `secretKey.json` no se excluyen y `auth_model.conf` sí). Límites declarados: un `getTree` truncado no se refleja en el contador de omisiones, se repite `getTree` también en proyectos TypeScript (sin efecto) y un archivo con el carácter U+FFFD literal se omite como no UTF-8. El snapshot es transporte interno: no cambia ningún contrato. Motivo: en el piloto v1, los tests de `casbin` leían `examples/*.conf|csv`, que no viajaban, y fallaban por el entorno. Los repositorios empresariales siguen condicionados a `DEC-VAL-001` (`PENDING`).
- JavaScript puro (.js/.jsx/.mjs/.cjs) no pertenece al pool V1 aunque la tesis describa el dominio como ecosistema JavaScript/TypeScript.
- Proyecto incompatible: 422 `UNSUPPORTED_PROJECT`.

## Contrato vigente de análisis y chunking

- `FileDiscoveryService` filtra primero el snapshot y entrega únicamente archivos del pool aplicable; no todos los archivos del repositorio reciben el mismo tratamiento.
- `TypeScriptParserService` analiza con ts-morph los `.ts/.tsx` descubiertos, incluyendo archivos de producción y de pruebas.
- `PhpParserService` analiza los `.php` descubiertos mediante la gramática PHP WASM fijada por `DEC-PHP-AST-001`; namespaces y nombres completamente cualificados se conservan. No se interpreta Blade.
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
