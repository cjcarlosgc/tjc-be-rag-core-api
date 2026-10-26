# WI-CORE-108 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

## Veredicto: APPROVED (con una recomendación MEDIA que decide el leader/usuario antes del uso oficial)

Ceguera, `--roles`, `build-gt`, solo lectura y alcance cumplen lo aprobado. `build-gt` no descartó nada en silencio en ninguno de los intentos de ruptura (lista completa de ids, nada escrito) y su `gt.json` coincide con lo que lee `score`. No hay hallazgo ALTA. Hay un modo de fallo silencioso fuera de la validación pedida (M-1: emparejamiento plantilla–llave) y un hueco de pruebas (M-2).

## Verificaciones ejecutadas

| Comprobación | Resultado |
|---|---|
| `vitest run scripts` | 27 archivos, 584 pruebas en verde (`scripts/oe2`: 192) |
| Suite completa | 212 archivos pasan, 11 omitidos; 3840 pruebas pasan, 125 omitidas (Postgres) |
| `pnpm lint` / `pnpm build` | salida correcta (lint no cubre `scripts/`, B-7) |
| `validate-harness`, `validate-work-items` (107 WI), `sdd-check` | pasan |
| Cambios en `app/src`, `app/package.json`, lockfile, `prisma`, `spec/contracts` | ninguno (`git diff --stat` vacío para esas rutas) |
| Diff de pruebas de WI-107 | `pool.spec.ts`: solo `guide` y `roles: null` en `poolOptions` y la constante de guía; `primitives.spec.ts`: lista de ocho subcomandos y `--guide` en dos llamadas a `pool`; `cli.spec.ts`: dos aserciones añadidas. Ninguna aserción debilitada. El golden `GOLDEN_POOL_*` no se tocó |
| `git status --short` y `git diff` antes y después | SHA-256 idénticos (`a4f7def8…`, `12fd0beb…`); `build-gt.mjs`, `pool.mjs`, `score.mjs` restaurados y verificados con `shasum -c` |

## 1. Ceguera (hoja, plantilla, guía)

- Ejecutado `pool` por proceso con guía de 17 bytes (`# G\r\nlinea\r\n` + `ff fe 80 0d 0a`): `cmp` con el original = iguales; sin `--guide` sale con 2. `grep` de `SEM|rank|score|IMPORTS|estructural|inClosure|calibr|reserva|oficial` sobre `ciego/` completo (con y sin `--roles`): sin coincidencias.
- Puntero (`pool.mjs:143-147`): «registra tu decisión y el criterio según la guía `GUIA.md` (SHA-256 …). Usa solo esta hoja y la guía.» No define relevancia ni conserva la frase antigua. El hash es el mismo en todas las hojas: no es procedencia.
- Copia byte a byte: `plan.addBytes('ciego/GUIA.md', guideBytes)` (`pool.mjs:315`); mutación M6 (normaliza CRLF y decodifica a UTF-8) → falla `copia la guía byte a byte (CRLF y bytes no UTF-8)`.
- Mutación M7 (la hoja vuelve a «necesario para entender o probar… (sí o no)») → falla la prueba del puntero.
- Aviso heurístico (`pool.mjs:277-285`, `:422-424`): solo añade una línea a stdout (`lines`); no entra en `plan`, manifiesto ni hojas. La guía se copia igual con y sin aviso (prueba `guide-roles.spec.ts:134-140`).
- Orden con `--roles` (comprobado por proceso con 3 targets: todos, `oficial`, `oficial,reserva`): el orden de `candidate_id` y de candidatos del target oficial es idéntico en las tres corridas; la numeración cambia (T02 → T01) y hoja, plantilla (8 y 11 líneas frente a 13), `pool-summary.csv` y `key.json` (`sheet`, `order`) coinciden entre sí en cada corrida. Golden de `pool` en verde.

## 2. `--roles`

- Sin flag, comportamiento anterior (`pool.mjs:296-299`, `score.mjs:189-191`). `parseRoles` (`args.mjs:20-33`): vacío, elemento vacío o rol desconocido → `UsageError`; selección sin filas → 2 (comprobado por CLI en pool y en pruebas).
- Las filas excluidas no exigen comparación: el bucle de `pool` itera `selectedRows`; `loadComparisons` carga y valida todas las comparaciones existentes (configuración congelada y duplicados) y `score` sigue comprobando la congruencia en todas (`score.mjs:197-199`).
- `score`: la regla `isOfficial`/`--include-calibration` (`score.mjs:201-202`) no cambió; la calibración y la reserva solo van al CSV no reportable. Manifiestos de `pool` y `score` registran `rolesSelected`.
- Mutaciones M8 (`pool` ignora roles) y M9 (`score` ignora roles) → fallan 4 y 3 pruebas respectivamente.

## 3. `build-gt` (ruptura intentada con `buildGroundTruth` y por CLI)

Probado con plantilla LF, CRLF y BOM+CRLF, IDs con espacios y coma entre comillas, y resultados idénticos en los tres formatos.

| Caso | Resultado |
|---|---|
| `Relevante ` con criterio / sin criterio, `NO  relevante`, ` RELEVANTE ` | normalizados; sin criterio en relevante → error con el id |
| `sí`, `x`, vacío, `relevante.`, `no-relevante`, `irrelevante` | error, id listado, nada escrito |
| criterio ausente, `R6`, `R10`, `R1R2` en relevante | error con el id |
| candidato desconocido (también en target no seleccionado) | error «no existe en la llave» |
| `target_id` que no coincide (también no seleccionado) | error con el target declarado |
| duplicado (también no seleccionado) | error |
| candidato de la llave sin fila | error con la lista de ids |
| plantilla sin filas de un target seleccionado | error `sin filas en la plantilla` (lista todos los targets) |
| fila en blanco final | error CSV (ruidoso; B-4) |
| target sin relevantes | `[]` y resumen (score lo trata como `NA`; probado por la suite e2e) |

- Acumulación: los errores se acumulan y se lanzan juntos (`build-gt.mjs:208-210`); `runBuildGt` construye todo antes de `writeOe2Package`, y la prueba de «no escribe nada» pasa.
- Forma: `stableStringify` (2 espacios, salto final); claves `targetId` = `<filePath>::<qualifiedName>`; elementos `{filePath, symbolQualifiedName}` ordenados por unidades de código (`build-gt.mjs:168`); `score` acepta el archivo con el hash de `gt.sha256`, que coincide con `shasum -a 256 gt.json`.
- Determinismo: la prueba con plantilla en orden inverso da los mismos bytes; dos ejecuciones dan los mismos bytes.
- Cálculo a mano: target `Converter.convert` del fixture con relevantes `Money` (`R1;R3`) y `Rate.apply` (`r2`, escrito ` RELEVANTE `): GT esperada de 2 elementos, ordenados por archivo; `score` dio P@5 0.4, R@5 1, P@10 0.2, R@10 1 en SE y SEM, y mi recálculo independiente en Python desde el volcado de comparación coincide. Segundo caso (target con `A, B.php` en la ruta y dos relevantes de nombres `X.one`/`X.one2` mismo archivo) → orden correcto por unidades de código, target sin relevantes con `[]`.
- Mutaciones (todas restauradas) y pruebas que las detectan:

| Mutación | Resultado |
|---|---|
| M1 ignora fila de decisión inválida | 3 pruebas fallan |
| M2 acepta decisión vacía | 2 fallan |
| M3 omite la comprobación «candidato sin adjudicar» | 1 falla |
| M4 desordena la salida (`reverse`) | 1 falla |
| M5 cambia el formato de la clave (`:` en lugar de `::`) | 15 fallan |
| M10 sin comprobación de `target_id` | 1 falla |
| M11 criterio no obligatorio en relevantes | 2 fallan |
| M12 duplicados no detectados | 1 falla |
| M13 candidato desconocido ignorado | 2 fallan |
| M14 criterios fuera de R1–R5 aceptados | 2 fallan |
| M15 filas de targets no seleccionados dejan de validarse | 10 fallan |

Las 15 mutaciones pedidas o adyacentes fueron detectadas. Una mutación adicional (el barajado depende de `--roles`, M16) NO fue detectada (ver M-2).

## 4. Solo lectura y alcance

- `build-gt.mjs` no importa BD ni red; solo `readFile` de tres entradas y `writeOe2Package` en `--out` con las reglas de `resolveOutputDir` (vacía o inexistente, fuera del repo salvo flag; prueba de uso incorrecto dentro del repo). Sin cambios en `app/src`, contratos, esquemas, migraciones ni dependencias.
- README fiel: vocabulario `relevante`/`no relevante`, R1–R5 con significado «en la guía del equipo», la tool solo copia la guía y avisa, `--roles` y `build-gt`. Cinco datos con matices en B-1, B-2 y B-5.

## 5. Riesgos para la evaluación OE2

No hay ningún camino por el que un anotador infiera modo, rank, score, relación estructural u origen desde `ciego/` generado por la tool, ni `score` usa roles incorrectos. El único modo silencioso es M-1.

## Hallazgos

### MEDIA

**M-1. `build-gt` no puede verificar que la plantilla y la llave pertenecen a la misma ejecución de `pool`.**
- `app/scripts/oe2/build-gt.mjs:98-126` une por `candidate_id` (`<targetId>-NN`). El `NN` es la posición tras un barajado que depende de la semilla; el conjunto de ids de un target no depende de ella (el pool es el mismo). Una `key.json` de otra semilla (p. ej. de una corrida de calibración con otra semilla o de un `pool` repetido) tiene exactamente los mismos ids, pasa todas las validaciones y produce una GT distinta de la adjudicada, sin error. `key.json` lleva `seedSha256`, pero la plantilla no lleva nada con lo que contrastarlo.
- Escenario: el operador re-ejecuta `pool` con otra semilla para otra tanda y usa la llave equivocada para el `build-gt` de la primera.
- Mitigación sugerida (decisión del leader/usuario, es un cambio de columnas o del manifiesto): que `build-gt` reciba el `manifest.json` del `pool` y lo contraste con `key.json` (`seedSha256`), o que la plantilla incluya una columna de identificador de ejecución (p. ej. los primeros 12 hex de `seedSha256`; no es procedencia). Como mínimo, una línea en el runbook: usar el `key.json` del mismo paquete que se distribuyó, y registrar `sha256` de `key.json` junto con la guía.
- No bloquea (no estaba en el alcance aprobado ni es descarte silencioso de filas), pero conviene resolverlo antes del uso oficial.

**M-2. Hueco de pruebas: el orden de candidatos de un target no se comprueba con y sin `--roles`.**
- Mutación M16 (en `pool.mjs`, `shuffleForTarget(built.pool, roles === null ? seed : \`${seed}x\`, targetId)`): las 192 pruebas de `scripts/oe2` pasan. El golden solo cubre el caso sin filtro. Se verificó a mano que hoy el orden coincide (sección 1), pero nada lo protege.
- Corregir: una prueba que compare `candidate_id` y orden de candidatos por target de `pool` sin `--roles` frente a `--roles oficial` (y el contenido de la hoja salvo el número `T<nn>`).

### BAJA

- **B-1.** `app/scripts/README.md` duplica el encabezado `### Reglas que fija el CLI` (queda dos veces seguidas, tras la sección nueva).
- **B-2.** `build-gt` valida el criterio de un «no relevante» si viene relleno (`build-gt.mjs:131-139`), algo más estricto que el alcance (obligatorio solo en relevantes). Es ruidoso (error con el id), está documentado en README e informe, y evita datos basura; si un anotador pone «n/a», `build-gt` aborta. Aceptable; avisar al equipo.
- **B-3.** `--roles` con un rol válido sin filas, pero con otro con filas (p. ej. `oficial,reserva` sin reservas), se acepta sin aviso; solo falla si la selección completa queda vacía.
- **B-4.** Una fila en blanco al final de la plantilla (frecuente al guardar desde hoja de cálculo) da «CSV: la fila 7 tiene 1 columnas…». Es ruidoso, pero el mensaje es opaco; opcional: ignorar filas totalmente vacías o mejorar el mensaje.
- **B-5.** La hoja dice «la guía `GUIA.md`» pero está en `ciego/GUIA.md` y la hoja en `ciego/hojas/`; podría decir `../GUIA.md`. Cosmético.
- **B-6.** `OE2_TOOL.workItem` sigue en `WI-CORE-107` en los manifiestos de los paquetes nuevos (declarado por el implementer; no lo pedía el alcance).
- **B-7.** `oxlint src/ test/` no cubre `app/scripts/` (heredado de WI-107 B-3); los archivos nuevos no pasan por linter.
- **B-8.** Los candidatos con `candidate_id` que empiece por `=`, `+`, `-`, `@` recibirían un prefijo `'` en `toCsv` y `build-gt` fallaría (ruidoso). Los `filePath` reales empiezan por letra; solo mencionarlo.
- **B-9.** El aviso de términos de procedencia es heurístico (declarado): no detecta sinónimos ni inglés (`semantic` sí, pero no, p. ej., «puntuación»); la revisión de la guía queda en manos del equipo.

## Qué debe corregirse

1. M-1: decidir y aplicar una de las mitigaciones (comprobación `key.json`/manifiesto en `build-gt`, columna de identificador de ejecución, o al menos regla del runbook con el hash del `key.json`). Si cambia columnas de la plantilla o el manifiesto de `pool`, requiere aprobación del usuario.
2. M-2: añadir la prueba de orden con y sin `--roles`.
3. B-1: quitar el encabezado duplicado del README.
4. B-2 a B-6: opcionales; B-2, B-3 y B-4 conviene comunicarlas en el runbook.

Sin commit, push, `git stash`, checkout ni reset; solo este informe se añade al árbol de trabajo (archivos temporales y mutaciones en el scratchpad de la sesión).

---

## Re-revisión del delta

Veredicto: **APPROVED**. M-1 y M-2 quedan resueltos con evidencia; no hay hallazgos ALTA ni MEDIA.

### Verificaciones

| Comprobación | Resultado |
|---|---|
| `vitest run scripts` | 27 archivos, 603 pruebas en verde |
| Suite completa | 212 archivos pasan, 11 omitidos; 3859 pruebas pasan, 125 omitidas (Postgres) |
| lint, build, `validate-harness`, `validate-work-items` (107 WI), `sdd-check` | correctos |
| `app/src`, `package.json`, lockfile, `prisma`, `spec/contracts` | sin cambios (`git diff --stat` vacío) |
| `git status --short` y `git diff` antes y después de la re-revisión | SHA-256 idénticos (`47e0d550…`, `110b041c…`); `build-gt.mjs`, `sheets.mjs`, `pool.mjs`, `score.mjs` restaurados y verificados con `shasum -c` |

### (a) M-1 resuelto

- Por proceso: dos `pool --roles oficial` con semillas `s` y `t`; plantilla adjudicada de `s`.
  - Llave de `s` + hojas de `s`: pasa (exit 0, «Hojas verificadas: 1»).
  - Llave de `t` + hojas de `s`: exit 1, 7 problemas, uno por cada `candidate_id` («la hoja muestra X y la llave Y»); la carpeta de salida no se crea.
  - Sin `--sheets`: exit 2.
- Mutaciones (todas detectadas y restauradas): S1 sin comparar filePath/qualifiedName (2 fallos); S2 sin sobrantes (1); S3 sin faltantes (1); S4 hoja de otro target aceptada (1); S5 target seleccionado sin hoja (1); S8 ids repetidos en la hoja (1).

### (b) y (c) Parser de hojas

Usé `renderSheet` real con candidatos hostiles y `parseSheet`, en LF y CRLF, con `maxChars` 6000 y 200 (truncado). El código de los candidatos y del target contenía `### T-99`, `- Archivo:`, `- Símbolo:`, `Target: fake`, cercas de 3, 4 y 5 comillas invertidas, comillas invertidas PHP reales (`` `ls` ``, `"```"`), un bloque sin cerrar y código muy largo; los nombres de símbolo llevaban `"`, `` ` ``, `'`, `$`, `,`, `;` y acentos. En los 4 casos se leyeron exactamente los 5 candidatos y el target correctos, sin ids fantasma.
- La cerca de `renderSheet` es siempre más larga que cualquier tramo de comillas del código, así que el código no puede cerrarla ni imitar un `###`/`Target:`; el parser solo interpreta líneas fuera de bloques. Mutaciones S6 (parser sin cercas) y S7 (cualquier cerca cierra) → fallan varias pruebas.
- Errores: sin `Target:`, dos `Target:`, cerca sin cerrar y `candidate_id` repetido abortan.
- Observación BAJA, B-10: un nombre de símbolo con salto de línea inyectaría una línea `###` fuera del código (probado con un nombre artificial; da un candidato «fake»). Los nombres reales de PHP no contienen saltos de línea y el efecto sería ruidoso (id sobrante frente a la llave), no silencioso.
- No verifica el contenido del código de la hoja (solo ids, archivo y símbolo): coherente con el alcance; un cambio de volcado con mismos ids/símbolos no se detecta aquí.

### (d) Filas en blanco

Solo se ignoran las del final: líneas vacías, solo espacios, solo comas, también con CRLF (se cuentan en `templateBlankRowsIgnored`, con aviso en stdout). Una fila parcial al final (`,,,,,,,x`, `zzz,,,,,,,`), una fila de comas en medio, o una parcial tras filas de comas finales, siguen fallando con el número de fila. Mutación S9 (tolerar parciales) → fallan pruebas.

### (e) M-2 resuelto

La mutación M16 (barajado dependiente de `--roles`) ahora falla: `por target: hoja (salvo el número T<nn>) y filas de la plantilla idénticas con y sin --roles`.

### (f) Ceguera

`grep` sobre `ciego/` de los dos `pool` nuevos (`--roles oficial`): sin coincidencias de modo, rank, score, estructural, origen ni rol. El puntero cita `` `ciego/GUIA.md` `` con su SHA-256. README: el encabezado `### Reglas que fija el CLI` aparece una sola vez (B-1 resuelto); avisos de roles sin filas presentes en `pool`, `score` y `build-gt` (`pool.mjs:428`, `score.mjs:267`, `build-gt.mjs:362`, B-3 resuelto); filas en blanco finales (B-4 resuelto); puntero (B-5 resuelto).

### Hallazgos restantes (todos BAJA)

- B-10 (arriba): `app/scripts/oe2/sheets.mjs:44-50` interpreta cualquier línea `### ` fuera de bloque; un nombre de símbolo con salto de línea (inexistente en PHP) podría fabricar un id; fallaría con «sobrante».
- B-2, B-6, B-7, B-8, B-9 de la revisión anterior siguen como estaban (criterio de «no relevante» validado si se rellena; `workItem` del manifiesto en WI-CORE-107; lint no cubre `scripts/`; prefijo `'` de `toCsv`; aviso heurístico de la guía).
- `--sheets` es obligatorio, por lo que el flujo del runbook cambia (`build-gt` ahora necesita la carpeta `ciego/hojas` del mismo paquete que la llave); conviene que quede dicho en el runbook de cross.
