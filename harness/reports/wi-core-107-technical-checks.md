# WI-CORE-107: comprobaciones técnicas del implementer

**Modelo:** Haiku 5.5 (`claude-haiku-5-5`), rol `implementer`, rama `feature/jean`.
**Alcance ejecutado:** `harness/reports/wi-core-107-scope.md` (aprobado por el usuario en el chat de Core, 2026-10-26).
**Estado:** implementado y verificado en local. Revisado una vez por el reviewer independiente (CHANGES_REQUESTED); corregido en el ciclo 1 de 2 (sección 7). Sin commit, sin push, sin cambios en `app/src`, contratos, esquemas, migraciones ni `harness/` (salvo este informe).

## 1. Archivos

Creados:

- `app/scripts/oe2.mjs`: CLI, `runCli` y códigos de salida 0/1/2.
- `app/scripts/oe2/args.mjs`: análisis de argumentos por subcomando.
- `app/scripts/oe2/io-primitives.mjs`: CSV de lectura, PRNG mulberry32, barajado, lectura de `chunks.jsonl` con verificación de hash.
- `app/scripts/oe2/product-copies.mjs`: copias locales de `computeRetrievalMetrics`, `rankComparisonCandidates`, `symbolQualifiedNameOf`, `isTestFile`, `isIgnoredPath`, regex R-PHP3/R-PHP4 y fórmula combinada.
- `app/scripts/oe2/php-signature.mjs`: escáner de firma PHP para `hasBody`.
- `app/scripts/oe2/closure.mjs`: cierre estático de profundidad 1, compartido por `sample` y `pool`.
- `app/scripts/oe2/universe.mjs`: agrupación de símbolos, elegibilidad y universo.
- `app/scripts/oe2/sample.mjs`, `support-files.mjs`, `pool.mjs`, `score.mjs`, `compare-dumps.mjs`, `dump-chunks.mjs`, `dump-results.mjs`: un módulo por subcomando.
- `app/scripts/oe2/db.mjs`: acceso de solo lectura (usa la sesión del extractor).
- `app/scripts/oe2/output.mjs`, `files.mjs`: escritura de paquetes (reutiliza `PackagePlan`, `finalizePackage`, `writePackageFiles`) y listado de volcados.
- `app/scripts/oe2/fixtures.mjs`: fixtures sintéticos (PHP inventado) para las pruebas.
- Pruebas: `app/scripts/oe2/primitives.spec.ts`, `product-parity.spec.ts`, `sample.spec.ts`, `pool.spec.ts`, `score.spec.ts`, `support-compare-dumps.spec.ts`, `dumps.spec.ts`, `cli.spec.ts`.

Modificados:

- `app/scripts/evidence-extractor/queries.mjs`: 4 consultas OE2 nuevas (`OE2_CODE_CHUNKS`, `OE2_COMPARISONS_BY_RUN`, `OE2_COMPARISON_BY_ID`, `OE2_COMPARISON_RESULTS`) añadidas a `allDataQueries()`, por lo que entran en la lista blanca de la sesión. Es el único cambio al extractor (+32 líneas, sin modificar nada existente).
- `app/scripts/README.md`: fila en la tabla y sección «Evaluación OE2 de retrieval».

## 2. Comandos y resultados

Desde `app/`, con `export PATH=/Users/cjcarlosgc/.local/node22/bin:$PATH`:

| Comprobación | Comando | Resultado |
|---|---|---|
| Pruebas OE2 | `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run scripts/oe2` | 8 archivos, **149 pruebas en verde** |
| Pruebas de `scripts` (incluye extractor y OE2) | `... exec vitest run scripts` | 24 archivos, **541 en verde** |
| Suite completa | `... exec vitest run` | 209 archivos y **3797 en verde**; 11 archivos y 125 pruebas omitidas (las de Postgres, sin base) |
| Lint | `corepack pnpm@12.14.0 lint` | Sin errores (`oxlint src/ test/`) |
| Build | `corepack pnpm@12.14.0 build` | Correcto (`prisma generate` y `nest build`) |
| Harness | `node harness/validate-harness.mjs` | Passed |
| Work items | `node harness/validate-work-items.mjs` | Passed (106 WI) |
| SDD | `node scripts/sdd-check.mjs` | OK |
| Sin dependencias nuevas | revisión de `package.json` | Sin cambios |

No se ejecutó ninguna prueba contra Postgres ni contra la base de desarrollo. Los volcados se verifican con un doble del driver que registra la secuencia de sentencias.

Comprobación manual de punta a punta (carpeta temporal fuera del repositorio, datos sintéticos): `sample` → `support-files` → `pool` → `score` → `compare-dumps`. Todos salen con el código esperado; `score` rechaza un GT que no es JSON y `dump-chunks` sin `DATABASE_URL` sale con 1 sin mostrar valores.

## 3. Qué cubren las pruebas

- **Argumentos (`primitives.spec.ts`):** los siete subcomandos, obligatorios, `dump-results` con exactamente una forma de selección, enteros y SHA-256 válidos, opciones repetidas o desconocidas, valores por defecto.
- **CSV, PRNG y rutas:** lectura inversa de `toCsv` (comillas, comas, saltos, CRLF); semilla = SHA-256 big-endian; mulberry32 frente a referencia independiente; barajado determinista; rutas seguras; verificación de `contentSha256` al leer.
- **Escáner de firma (`hasBody`):** abstracto, interfaz, atributos `#[...]` con `;`/`{` y cadenas, cadenas en valores por defecto, retornos compuestos (unión, nullable, DNF), funciones libres, referencias `&`, comentarios con la palabra `function`.
- **Paridad con el producto (`product-parity.spec.ts`):** `computeRetrievalMetrics` (300 casos aleatorios, GT vacía y símbolos repetidos), `rankComparisonCandidates` en SE y SEM (200 conjuntos con empates), fórmula combinada frente a `ContextBuilder.scoreCandidate`, `symbolQualifiedNameOf`, `isTestFile` e `isIgnoredPath` frente a `indexing.constants`, y R-PHP3/R-PHP4 frente a `RetrievalService.classifyPhpRelation`.
- **Universo y cierre (`sample.spec.ts`):** motivo de cada símbolo del volcado sintético (11 símbolos, ver `EXPECTED_REASONS`), exclusión de CONSTRUCTOR y tipos, no-PHP, smoke excluido, identidad duplicada, cierre por import, por namespace y por FQCN, exclusión de la clase declarante, `\FQCN` seguido de identificador no cuenta, orden por unidades de código.
- **Sorteo y salidas (`sample.spec.ts`):** misma semilla igual, otra semilla distinta, roles por posición, aviso con pocos elegibles, primeras cinco salidas crudas, `readExclusions`, escritura completa con manifiesto y hashes, rechazo de `--out` no vacío o dentro del repo.
- **Pool (`pool.spec.ts`):** unión y deduplicación por símbolo, exclusión del target, cierre incluido, recuentos agregados, **ceguera** (ninguna hoja ni la plantilla contiene SE, SEM, rank, score, relación, origen ni valores numéricos de score; la clave sí), determinismo por semilla, formato de `candidate_id`, truncado con marcador, y fallos (configuración distinta, target o modo ausente, cierre que no coincide, comparación duplicada, target fuera del volcado).
- **Score (`score.spec.ts`):** P@k y R@k calculados a mano (incluye símbolo con dos partes contado una vez, menos de 10 candidatos y k fijo), deltas SE−SEM, NA con GT ausente o vacía, sensibilidad al desempate, hash de GT incorrecto (sin salida), target fuera del sample, incongruencia de re-ranking (código de error), y calibración separada como no reportable.
- **Support y compare (`support-compare-dumps.spec.ts`):** marca al final con salto de línea (LF, CRLF y archivo vacío), rechazo de `?>`, aviso de cierre, checkout intacto con hashes antes/después, `--out` dentro del checkout rechazado; iguales, solo en A, solo en B, distintos y ocurrencias repetidas; códigos de salida 0 y 1.
- **Volcados desde base (`dumps.spec.ts`):** secuencia exacta de solo lectura (BEGIN, `SET TRANSACTION READ ONLY`, consultas, `ROLLBACK`, liberación), orden determinista, manifiesto, ausencia de credenciales en las salidas, versión inexistente, configuración sin `DATABASE_URL`, forma exacta de la respuesta de comparación (claves, modos, candidatos), omitidas no COMPLETED, comparación por id inexistente, orden de modos. Las cuatro consultas nuevas pasan la guardia SQL y están en la lista blanca.
- **CLI (`cli.spec.ts`):** ayuda con 0, uso incorrecto con 2, diferencias con 1, error de ejecución sin pila, falta de `DATABASE_URL` sin valores, error de la base con la URL saneada (`[REDACTED]`), ejecución como proceso real.

## 4. Decisiones donde la especificación dejaba margen

1. **`compare-dumps`:** `--out` es opcional (la especificación no lo exigía). Sin `--out` solo imprime el resumen; con `--out` escribe `comparacion.json` y el manifiesto.
2. **Elegibilidad:** además de los motivos del alcance, se añadieron `no-php` (el cierre es PHP), `partes-incompletas` (un símbolo con partes faltantes no tiene contenido completo), `firma-no-encontrada` y `sin-nombre`. Cada uno aparece en `universe.csv`.
3. **Cierre, regla (c):** la lookahead acepta también el fin de texto, igual que R-PHP4 del producto (la paridad lo exige). Un FQCN al final del contenido cuenta.
4. **`sample --repo`:** opcional; sin él, la columna `repo` queda vacía.
5. **Roles:** `calibracion`, `oficial`, `reserva` (valores literales en `sample.csv`).
6. **Estructura de `pool`:** las hojas van en `ciego/hojas/T<nn>.md` (Markdown, una por target), la plantilla en `ciego/annotation-template.csv`, la clave en `clave/key.json` y el resumen en `pool-summary.csv` (fuera de `ciego/`). Solo se entrega `ciego/` a los anotadores.
7. **`candidate_id`:** `<targetId>-<k:02d>`, con `targetId = <archivo>::<nombre>` (el mismo formato de la GT), según el alcance.
8. **Identidad de candidatos del pool:** `(filePath, symbolQualifiedName)`. Los candidatos sin nombre calificado se excluyen y se cuentan en `nSinIdentidad`. Si un mismo par tiene varios tipos de chunk, la hoja usa el de mayor precedencia (METHOD, FUNCTION, tipos, CONSTRUCTOR) y se cuenta en `ambiguousKinds`.
9. **Configuración de SEM:** además de la de SE, se verifica que SEM tenga `semanticTopK 20`, `finalTopK 10` y pesos `null`. `embeddingModel` solo debe ser texto.
10. **Congruencia de re-ranking:** `score` la comprueba en todas las comparaciones cargadas, no solo en las puntuadas. Compara `rank`, `chunkId`, `selected` y `combinedScore`.
11. **Sensibilidad:** el re-orden usa `combinedScore` desc, luego `semanticScore` desc, luego `(filePath, symbolQualifiedName)` asc, y `rank` original como último criterio. Solo cambia el desempate; no toca el producto.
12. **Sorteo y muestra de salidas crudas:** las cinco primeras salidas de `sample.json` se toman de un generador fresco con la misma semilla, para que la documentación no dependa de cuántas salidas consuma el barajado.
13. **Salida de paquetes:** se reutiliza `PackagePlan`, de modo que los nombres de archivo siguen la restricción `[A-Za-z0-9._-]`. Esto afecta a `support-files` si una ruta del checkout tiene otros caracteres.
14. **Error en `dump-results` si falta un modo:** una comparación COMPLETED sin exactamente SE y SEM aborta. No se escribe una respuesta parcial.
15. **Salidas de `dump-chunks`:** `chunks.jsonl` no incluye `chunkId`. La identidad de comparación es la de la especificación, así que `pool` resuelve los candidatos por `(filePath, symbolQualifiedName)`.

## 5. Límites conocidos

- El escáner de firma no interpreta heredocs ni nowdocs. Un heredoc con `{` o `;` dentro de un atributo o de un valor por defecto puede dar un `hasBody` erróneo; el caso queda fuera de las pruebas.
- Solo PHP. Los símbolos TypeScript no son elegibles (`no-php`).
- `score` no calcula κ, bootstrap ni Wilcoxon (queda para cross).
- La ceguera se verifica sobre texto (tokens y valores numéricos concretos); no sustituye una revisión humana de las hojas.
- `pool` escribe el código de cada candidato completo hasta `--max-chars`. Un candidato largo llega truncado con marcador; el anotador no ve el resto.
- No se probó contra la base real ni contra repositorios de piloto. Las cifras de las pruebas son las de fixtures sintéticos.

## 6. Pendiente (fuera de este corte)

- Commit y push en `feature/jean` (no solicitado).
- Actualizar `spec/features/004-rag-retrieval-context/` y `CHANGELOG.md` (lo hace el leader, según el alcance).
- La revisión independiente del `reviewer`, con foco en ceguera, determinismo y solo lectura.

## 7. Ciclo 1 de revisión independiente (cambios tras CHANGES_REQUESTED)

Fuente: `harness/reports/wi-core-107-independent-review.md` (no editado). Modelo de trabajo: Haiku 5.5 (`claude-haiku-5-5`). Sin commit, push, stash, checkout ni reset; sin cambios en `app/src`, contratos, esquemas, migraciones, dependencias ni `harness/` (salvo este informe).

| Hallazgo | Estado | Cambio |
|---|---|---|
| A-1 (ALTA) `pool` aborta con CONSTRUCTOR | Corregido | `pool.mjs` `indexGroups` indexa también CONSTRUCTOR (precedencia METHOD, FUNCTION, tipos, CONSTRUCTOR y `ambiguousKinds` sin cambios). CONSTRUCTOR sigue fuera del universo de `sample`. |
| M-1 orden de hojas y `candidate_id` independientes de la procedencia | Corregido | Prueba: mismo conjunto con procedencias distintas ⇒ hojas y plantilla idénticas, clave distinta. Prueba: `candidate_id` con regex anclada `^<targetId>-(\\d{2})$` y numeración 01..N consecutiva sin huecos. Prueba golden: el orden de la hoja es `shuffleForTarget` del pool ordenado por `(filePath, qualifiedName)`. |
| M-2 golden de la permutación y orden por unidades de código | Corregido | Órdenes esperados fijados a mano y calculados con una implementación independiente en Python (mulberry32 sobre SHA-256 big-endian, Fisher–Yates descendente). Cubren barajado puro, sorteo de `sample` y pool. Prueba que el barajado ascendente da otro orden y que `localeCompare` ordena distinto con mayúsculas, minúsculas y acentos. Mutación comprobada: barajado ascendente ⇒ 4 pruebas fallan; restaurado con el mismo SHA-256. |
| M-3 paridad de constantes | Corregido | `product-parity.spec.ts`: `SEMANTIC_TOP_K` y `COMPARISON_FINAL_TOP_K` importados del producto (exportados); top-K vectorial congelado igual a `DEFAULT_VECTOR_TOP_K` (exportado); pesos por defecto observados con `ContextBuilder.resolveWeights` (no exportados) y la configuración que persiste `computeResults` del handler (con retriever simulado) comparada con la congelada; `INDEXING_IGNORED_DIRS` comparado como conjunto. |
| M-4 truncado de candidatos de tipo | Atendido (decisión de cross) | `--max-chars` sigue en 6000. El manifiesto de `pool` cuenta `truncatedBlocks` y `truncatedTypeCandidates`. README documenta que el truncado afecta sobre todo a clases y que la hoja marca el truncado. |
| B-1 `scores.json` con calibración | Corregido | `scores.json` solo lleva oficiales; la calibración y la reserva van únicamente a `metrics-calibracion-reserva-NO-REPORTABLE.csv`. Prueba: `scores.json` no tiene `noReportable` ni el id de una no reportable. |
| B-6 README sobre `manifest.json` | Corregido | Redacción: toda salida escrita lleva manifiesto; `compare-dumps` sin `--out` no escribe nada. |

Cambios adicionales derivados: la congruencia de re-ranking de `score` se comprueba en todas las comparaciones cargadas (ya estaba en el ciclo anterior, sin cambios en este ciclo); `scoreTarget` ya no devuelve incongruencias.

Pruebas nuevas (18): `pool.spec.ts` +7 (constructor solo en SE, solo en SEM, en ambos, homónimo METHOD/CONSTRUCTOR, fuera del universo de `sample`, independencia de procedencia, golden de la hoja; `candidate_id` exacto reescrito), `sample.spec.ts` +3 (golden del sorteo, orden por unidades de código, barajado ascendente distinto), `primitives.spec.ts` +3 (golden del barajado puro y semilla), `product-parity.spec.ts` +5 (constantes y `computeResults`). `score.spec.ts` sin pruebas nuevas, con una aserción más (B-1).

Resultados tras el ciclo (desde `app/`, PATH node22):

| Comprobación | Resultado |
|---|---|
| `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run scripts` | 24 archivos, **541 en verde** |
| `... exec vitest run` (completa) | 209 archivos y **3797 en verde**; 11 archivos y 125 omitidas (Postgres) |
| `corepack pnpm@12.14.0 lint` | Sin errores |
| `corepack pnpm@12.14.0 build` | Correcto |
| `node harness/validate-harness.mjs` | Passed |
| `node harness/validate-work-items.mjs` | Passed (106 WI) |
| `node scripts/sdd-check.mjs` | OK |

Nota: la tabla de la sección 2 refleja el ciclo 1 (149 OE2, 541 scripts, 3797 completa).
