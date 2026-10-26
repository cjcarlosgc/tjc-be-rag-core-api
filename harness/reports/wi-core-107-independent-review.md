# WI-CORE-107 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

## Veredicto: CHANGES_REQUESTED

Un hallazgo ALTO que bloquea el uso real de `pool` (aborta si algún candidato seleccionado es un `CONSTRUCTOR`, algo que ocurrirá con datos reales). Ceguera, determinismo, solo lectura y alcance están bien en lo esencial; el resto son huecos de pruebas (MEDIA) y notas (BAJA). Sin cambios en `app/src`, contratos, esquemas, migraciones ni dependencias.

## Verificaciones ejecutadas

| Comprobación | Resultado |
|---|---|
| `vitest run scripts` | 24 archivos, 523 pruebas en verde |
| Suite completa | 209 archivos y 3779 pruebas en verde; 11 archivos y 125 omitidas (Postgres) |
| `pnpm lint` | sin errores. Nota: `oxlint src/ test/` no cubre `scripts/` (ver B-3) |
| `pnpm build` | correcto |
| `validate-harness`, `validate-work-items` (106 WI), `sdd-check` | pasan |
| `git diff --stat` y `git status --short` antes y después | idénticos; los archivos mutados se restauraron y su SHA-256 coincide con la copia previa |
| Cambios en `app/src`, `package.json`, lockfile, `prisma`, `spec/contracts` | ninguno |
| Extractor | solo `queries.mjs` +32 líneas (4 consultas `SELECT`, añadidas a `allDataQueries()`); sin otras modificaciones |

## Hallazgos

### ALTA

**A-1. `pool` aborta cuando un candidato seleccionado de SE o SEM es un `CONSTRUCTOR`.**
- `app/scripts/oe2/pool.mjs:176-184` (`indexGroups`) agrupa solo `[...SYMBOL_KINDS, ...TYPE_KINDS]`, es decir METHOD, FUNCTION y tipos. Los chunks `CONSTRUCTOR` no se indexan, aunque `KIND_PRECEDENCE` (`pool.mjs:47`) los contempla. Entonces `buildTargetPool` lanza en `pool.mjs:236-238`: «candidato sin chunks en el volcado».
- El retriever puede devolver cualquier chunk con embedding. `findSimilarByEmbedding` (`app/src/project-versions/persistence/code-chunks.repository.ts:306-335`) no filtra por `symbolKind`. El parser emite `CONSTRUCTOR` con nombre `constructor` (`php-parser.service.ts:175-180`), así que su identidad es `Clase.constructor`.
- Reproducción (script propio en el scratchpad, con los fixtures del WI): se añadió a la comparación de un target un candidato `src/Domain/Money.php` / `App\Domain\Money.constructor`, que sí existe en el volcado sintético como `CONSTRUCTOR`. Resultado: `ERROR: candidato sin chunks en el volcado: src/Domain/Money.php::App\Domain\Money.constructor`. Sin ese candidato el pool se genera bien.
- Las pruebas no lo detectan porque ningún caso de `pool.spec.ts` tiene un `CONSTRUCTOR` entre los candidatos.
- Impacto: con repos reales (constructores en el top-10 de SE o SEM), `pool` no produce hojas. No es silencioso (falla fuerte), pero bloquea la evaluación OE2.
- Corrección: indexar también `CONSTRUCTOR` en `indexGroups` y añadir una prueba con un constructor entre los candidatos. Cuando se incorpore la identidad `Clase.constructor`, comprobar que ese chunk aparece en la hoja con `Tipo: CONSTRUCTOR`.

### MEDIA (huecos de pruebas que dejan pasar regresiones del protocolo)

**M-1. No hay prueba de que el orden de candidatos en las hojas sea independiente de la procedencia.**
- Mutación M3b (barajado con semilla y luego orden estable por «está en SE»; fuga de procedencia por posición): las 17 pruebas de `pool` pasan.
- Mutación M2 (el `candidate_id` añade un dígito según SE o no): pasa, porque la regex `^\d{2,}$` de `pool.spec.ts` admite cualquier número de dígitos.
- Sí se detectan: mostrar «Origen» en la hoja (M1, falla), ordenar por rank de SE sin barajar (M3, falla), clave sin origen (M5, falla) y deduplicar por archivo (M6, falla).
- Corrección sugerida: un golden del orden (el resultado de `shuffleForTarget` sobre el pool ordenado por `(filePath, qualifiedName)` con una semilla fija debe coincidir con el orden de la hoja) y exigir `\d{2}` exacto (o la longitud de `pad2(n)`) en el `candidate_id`.

**M-2. No hay golden de la permutación del sorteo ni del barajado.**
- Mutación: Fisher–Yates ascendente en vez de descendente (`io-primitives.mjs:110`): las 131 pruebas de `scripts/oe2` pasan. El algoritmo está documentado en `sample.json` y es parte del protocolo reproducible, y las pruebas solo comprueban permutación y determinismo, no la secuencia concreta.
- Mutación: ordenar el universo con `localeCompare` en vez de unidades de código (`universe.mjs:109`): pasa. La prueba compara con `.sort()` pero los datos sintéticos no distinguen ambas ordenaciones.
- Se detectan bien: quitar la ordenación, cambiar el endianness de la semilla, la constante de mulberry32, el orden de roles, la clase declarante, el límite de palabra de (b) y el chequeo de cuerpo.
- Corrección: una prueba con una semilla fija y una lista con mayúsculas, minúsculas y acentos que fije la permutación esperada (calculada de forma independiente) y el orden por unidades de código.

**M-3. Las constantes congeladas no tienen paridad con el producto.**
- `SEMANTIC_TOP_K` (20, `retrieval-comparison-job.handler.ts:20`) y los pesos por defecto (0.7/0.3, `context-builder.service.ts:53-54`): al cambiar el producto (25, 0.6) las pruebas de `scripts/oe2` siguen en verde. La copia de `isIgnoredPath` con un directorio de más tampoco falla.
- Se detectan en cambio: `COMPARISON_FINAL_TOP_K`, `computeRetrievalMetrics`, `symbolQualifiedNameOf`, `rankComparisonCandidates` (incluido el desempate por `chunkId`) e `isTestFile`; los cambios en la copia local también los detectan las pruebas.
- Mitigación real: `verifyFrozenConfig` compara la configuración persistida en la base con la congelada, así que un cambio de pesos o de k aparece como fallo en `pool` o `score` al cargar los resultados. Es por tanto un hueco de pruebas, no un riesgo de resultados sesgados.
- Corrección sugerida: pruebas de paridad de esas constantes (importando las del producto).

**M-4. Truncado de los candidatos de tipo.**
- `pool.mjs:119-122`: el código de cada candidato se corta a `--max-chars` (6000 por defecto). Los candidatos de tipo (la declaración completa de la clase, tanto del cierre como los chunks CLASS de SE o SEM) serán casi siempre más largos que los de método, de modo que el anotador juzga las clases con su cabecera. No es un sesgo por modo (el corte no depende de la procedencia), pero afecta la validez de la GT de los candidatos tipo. Está declarado en el README y en las limitaciones; se recomienda que cross decida un `--max-chars` mayor o revise cuántos candidatos tipo se truncan (el manifiesto no lo cuenta).

### BAJA

- **B-1.** `scores.json` incluye también la lista `noReportable` cuando se usa `--include-calibration` (`score.mjs:240`), además del CSV aparte marcado «NO REPORTABLE». Las filas llevan `uso`, pero el alcance pedía un archivo aparte; conviene sacar esa lista de `scores.json` para evitar agregaciones accidentales.
- **B-2.** Fuga mínima en `ciego/`: el campo «Tipo» (`pool.mjs:155-157`) no es ciego respecto del cierre, porque los candidatos solo del cierre son siempre tipos, de modo que un METHOD o CONSTRUCTOR nunca es «cierre»; y el número de hoja `T<nn>` sigue el orden del sample, es decir calibración, oficiales y reserva por posición. No revela modo, rank, score ni relación SE. El alcance incluye explícitamente símbolo, archivo y tipo, así que se deja como nota.
- **B-3.** `pnpm lint` ejecuta `oxlint src/ test/` y no cubre `app/scripts/`; los archivos nuevos no pasan por el linter.
- **B-4.** Los nombres de archivo del paquete siguen `^[A-Za-z0-9][A-Za-z0-9._-]*$` (`util.mjs:112-117`); un archivo del checkout con `_`, espacio o `+` en un segmento aborta `support-files` (falla fuerte, está declarado en el README).
- **B-5.** `CHANGELOG.md` no está actualizado (el alcance lo asigna al leader) y `ST-CORE-129` sigue `[ ]` / `T-IN_PROGRESS`; se cierra al aprobar.
- **B-6.** El README dice «Todas las salidas llevan `manifest.json`»; `compare-dumps` sin `--out` no escribe nada. Detalle menor.
- **B-7 (informativa para cross).** El cierre estático usa exactamente las regex R-PHP3 y R-PHP4 de la relación estructural de SE y entra siempre en el pool. Es decisión aprobada (D-OE2-5 y el pool del alcance); para la tesis conviene declarar que la procedencia estructural y el cierre no son independientes.

## Foco 1: ceguera (resultado)

- Hojas y plantilla: nada de modo, rank, score, relación ni origen (`pool.mjs:136-163` solo emite target, archivo, símbolo, tipo y código; la plantilla solo tiene `candidate_id`, `target_id` y columnas vacías). Comprobé el contenido real generado con los fixtures (hoja T01, plantilla, `manifest.json`).
- La llave (`clave/key.json`) lleva SE, SEM (rank, scores, relación) y `inClosure`; `pool-summary.csv`, `manifest.json`, `hashes.txt` están fuera de `ciego/`.
- Orden: el pool se ordena por `(filePath, qualifiedName)` antes del barajado (`pool.mjs:246`), de modo que no depende del orden de los resultados ni de los rank; semilla `SHA-256(semilla|targetId)` con Fisher–Yates (verificado salida idéntica con volcado y resultados en otro orden).
- `candidate_id` = `<targetId>-<posición barajada>`: no codifica rank ni procedencia.
- Datos adversos probados: candidato en SE y SEM a la vez, solo en cierre, ambos solapados, dedupe por identidad, un símbolo con varias partes (se une el contenido; si faltan partes aborta), truncado (el marcador solo informa longitud). Nombres con «SE», «rank» o números parecidos a un score no se generan por la herramienta, solo aparecen si el código real los contiene.
- Mutaciones: ver M-1.

## Foco 2: determinismo (resultado)

- Misma entrada y semilla: salidas byte a byte idénticas (probado dos veces); con volcado invertido y archivos de resultados con nombres en otro orden, `sample.csv`, `universe.csv`, `eligible.csv`, hojas, plantilla, llave y resumen idénticos (solo cambia el hash de entrada del manifiesto, esperado porque el JSONL cambió de bytes). Otra semilla cambia el sorteo y el orden (test existente).
- PRNG y derivación de la semilla: mulberry32, SHA-256 big-endian y la referencia independiente están probados (mutaciones S4 y S5 fallan); Fisher–Yates y `localeCompare`: ver M-2.
- Roles por posición (S6 falla al alterarlos). Con pocos elegibles se usan todos y se advierte (test existente).

## Foco 3: solo lectura (resultado)

- Los dos subcomandos usan `runInReadOnlyTransaction` del extractor (READ ONLY, consultas registradas y guardia, `ROLLBACK`); las 4 consultas nuevas son `SELECT` y pasan el registro. No seleccionan `groundTruth`. No hay `dotenv`, `.env`, `fs` de escritura, red ni procesos hijos fuera del escritor del paquete (`writeFile` con `wx`).
- `--out` se valida con el extractor (vacía o inexistente, fuera del repo salvo `--allow-out-in-repo`).
- `support-files` probado a mano: un enlace simbólico dentro del checkout que apunta fuera, un directorio enlazado, `..`, ruta absoluta y archivo inexistente fallan sin escribir; el archivo normal se copia con `// oe2-support` y el checkout queda intacto.
- Sin `DATABASE_URL` el error no imprime valores.

## Foco 4: corrección (resultado)

- `hasBody`: 24 casos propios (abstracto, interfaz, atributos con `;`/`{`/cadenas, defaults con `;`/`{`, unión, nullable, DNF, por referencia, comentarios con `function`, función libre, método llamado `list`, heredoc en default) correctos.
- Elegibilidad, cierre (a/b/c, clase declarante excluida) y mutaciones: bien cubiertos (S7, S8, S9 fallan al mutar).
- Identidad `(filePath, symbolQualifiedName)` igual a la del producto (paridad). Dedupe correcto (M6).
- Configuración congelada: `verifyFrozenConfig`; target o modo ausente falla.
- Score: calculé a mano un caso con 12 candidatos y GT de 3 elementos (A con dos partes en rank 2 y 6, B en rank 1 y 8, C en rank 11): P@5 = 2/5 = 0.4, R@5 = 2/3, P@10 = 2/10 = 0.2, R@10 = 2/3; el CLI da exactamente esos valores para SE y SEM. Calibración separada y no reportable; hash de GT incorrecto aborta sin salida; `NA` con GT ausente o vacía.
- Paridad: las pruebas fallan al mutar el producto (`rank >= k`, separador del nombre calificado, k final, desempate por `chunkId`, `isTestFile`) y la copia (`rank >= k`); límites en M-3.

## Foco 5: alcance

Sin cambios en `app/src`, contratos, esquemas, migraciones ni dependencias; sin cambios no declarados en el extractor; pruebas con fixtures sintéticos y doble del driver; README fiel salvo B-6.

## Foco 6: lo que invalida la evaluación OE2

Nada invalida los resultados que la herramienta llega a producir: no hay fuga de procedencia en `ciego/`, el sorteo es reproducible y no depende del orden de archivos, y las métricas coinciden con la función del producto. Sí invalida el flujo el hallazgo A-1: sin corregirlo, `pool` no se puede ejecutar sobre resultados reales en cuanto un constructor entre en el top-10.

## Qué debe corregirse

1. A-1: indexar `CONSTRUCTOR` en `pool.mjs:indexGroups` y añadir prueba con un constructor candidato.
2. M-1 y M-2: pruebas golden del orden de las hojas, de la permutación del sorteo y de `candidate_id` (longitud exacta), y una prueba que distinga `localeCompare`.
3. M-3: paridad de `SEMANTIC_TOP_K` y los pesos por defecto (recomendado).
4. M-4 y B-1: decisión de cross sobre `--max-chars` y sacar `noReportable` de `scores.json` (recomendado).
5. Tras corregir, nueva revisión (ciclo 2 de 2) del cambio; B-3 a B-7 no bloquean.

## Re-revisión del delta (ciclo 2 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

### Veredicto: APPROVED

- **A-1 resuelto.** `pool.mjs:178-180` indexa `CONSTRUCTOR`; `sample` sigue sin incluirlo. Con datos tipo producto (script propio: `Money.constructor` solo en SE, solo en SEM y en ambos; homónimo METHOD `Rate.constructor` junto a un CONSTRUCTOR) el pool se genera, la hoja muestra `Tipo: CONSTRUCTOR`, la dedupe da una entrada y el homónimo usa METHOD con `ambiguousKinds=1`. Revertir el fix hace fallar 4 pruebas nuevas.
- **M-1 resuelto.** Orden por presencia en SE: falla el golden de la hoja. `candidate_id` con sufijo extra: falla.
- **M-2 resuelto.** Recalculé en Python (mulberry32 + Fisher–Yates descendente, semilla `golden-puro`) la permutación `g h e c d a b f`: coincide con el golden. Fisher–Yates ascendente y `localeCompare` en el universo hacen fallar las pruebas.
- **M-3 resuelto.** Cambiar en el producto `SEMANTIC_TOP_K`, el peso semántico por defecto, `COMPARISON_FINAL_TOP_K` o `INDEXING_IGNORED_DIRS`, o la copia de `SEMANTIC_TOP_K` o de los directorios ignorados, hace fallar la paridad.
- `scores.json` ya no incluye calibración; `truncatedBlocks` y `truncatedTypeCandidates` en el manifiesto.
- **Ceguera y determinismo intactos:** `ciego/` y `clave/` byte a byte idénticos a la primera revisión; con volcado y resultados en otro orden solo cambia el hash de entrada del manifiesto.
- **Verificaciones:** `vitest run scripts` 541 en verde; suite completa 3797 en verde (125 omitidas); lint, build, `validate-harness`, `validate-work-items` y `sdd-check` correctos. `git status` y `git diff --stat` idénticos antes y después; mutaciones restauradas (SHA-256 verificado).

### Observaciones restantes (no bloquean)
- **BAJA:** cambiar a `localeCompare` la ordenación del pool (`pool.mjs:246`) no hace fallar ninguna prueba (los datos del golden del pool no distinguen); el barajado posterior sí cambiaría de orden de entrada si difiere. Añadir mayúsculas/minúsculas al fixture del pool.
- **BAJA:** en el homónimo METHOD/CONSTRUCTOR el chunk CONSTRUCTOR no aparece en la hoja (queda contado en `ambiguousKinds`); caso extremo y declarado.
- M-4 (`--max-chars` 6000) sigue como decisión de cross. B-3 (lint no cubre `scripts/`), B-5 (CHANGELOG) y B-7 siguen vigentes.
