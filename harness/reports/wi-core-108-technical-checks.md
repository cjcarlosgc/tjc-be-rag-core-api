# WI-CORE-108 — comprobaciones técnicas

Modelo con el que se trabajó: claude-haiku-5-5 (Haiku 5.5), implementer, subagente invocado por cross/leader. Rama `feature/jean`. Sin commit, push, PR, `git stash`, `git checkout` ni `git reset`. Sin base de datos, sin Render, sin GitHub y sin red: todas las pruebas usan fixtures sintéticos. No se tocaron `app/src`, contratos, esquemas, migraciones, dependencias ni `harness/` (salvo este informe). Spec 004 y CHANGELOG quedan para el leader (alcance, punto 4).

## Archivos

| Archivo | Cambio |
|---|---|
| `app/scripts/oe2/args.mjs` | Nuevo subcomando `build-gt`; `--guide` obligatorio en `pool`; `--roles` en `pool`, `score` y `build-gt`; `parseRoles` (orden canónico, sin duplicados, errores de uso sin repetir el valor); ayuda. |
| `app/scripts/oe2.mjs` | Registra `build-gt` en `HANDLERS` y su importación. |
| `app/scripts/oe2/pool.mjs` | `--guide` copia los bytes a `ciego/GUIA.md` (SHA-256 y tamaño en el manifiesto); la hoja usa el puntero neutro; `--roles` filtra filas; numeración T<nn> sobre las filas filtradas; aviso `guideBlindTerms` (solo stdout). |
| `app/scripts/oe2/score.mjs` | `--roles` restringe las filas puntuadas; reglas de oficiales y `--include-calibration` sin cambios; aviso si no hay oficiales puntuables. |
| `app/scripts/oe2/build-gt.mjs` | Nuevo. Validación estricta, `gt.json`, `gt.sha256`, `gt-summary.csv` y `manifest.json`. |
| `app/scripts/oe2/pool.spec.ts` | Solo `poolOptions` añade `guide` (fixture de guía) y `roles: null`. Sin cambios en las aserciones. |
| `app/scripts/oe2/primitives.spec.ts` | Dos ajustes: lista de subcomandos (ocho) y `pool` con `--guide`. |
| `app/scripts/oe2/cli.spec.ts` | La ayuda contiene `build-gt` y `--guide`. |
| `app/scripts/oe2/guide-roles.spec.ts` | Nuevo (43 pruebas entre este archivo, `build-gt.spec.ts` y `e2e-gt.spec.ts`). |
| `app/scripts/oe2/build-gt.spec.ts` | Nuevo. |
| `app/scripts/oe2/e2e-gt.spec.ts` | Nuevo. Extremo a extremo `pool` → plantilla adjudicada → `build-gt` → `score`. |
| `app/scripts/oe2/wi108-fixtures.mjs` | Nuevo. Pipeline sintético compartido por las pruebas nuevas. |
| `app/scripts/README.md` | Tabla de subcomandos, sección WI-CORE-108 (guía, vocabulario, `--roles`, `build-gt`, flujo, limitaciones), pruebas. |
| `harness/reports/wi-core-108-technical-checks.md` | Este informe. |

## Comandos y resultados

Entorno: `export PATH=/Users/cjcarlosgc/.local/node22/bin:$PATH`; desde `app/`.

| Comando | Resultado |
|---|---|
| `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run scripts/oe2` | 11 archivos, 192 pruebas en verde (eran 8 archivos y 149). |
| `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run scripts` | 27 archivos, 584 pruebas en verde. La revisión de WI-CORE-107 citaba 541 (no volví a medir al inicio); la diferencia son las 43 pruebas nuevas. |
| `corepack pnpm@12.14.0 test` (suite completa) | 212 archivos pasan, 11 omitidos; 3840 pruebas pasan, 125 omitidas (Postgres). La revisión de WI-107 citaba 3797 en verde; +43. |
| `corepack pnpm@12.14.0 lint` | Salida 0. Nota: `oxlint src/ test/` no cubre `app/scripts/` (ya lo señaló WI-107, B-3); los archivos nuevos no pasan por el linter. |
| `corepack pnpm@12.14.0 build` (`prisma generate && nest build`) | Salida 0. No aparecen archivos rastreados modificados por el build. |
| `node harness/validate-harness.mjs` (raíz) | Harness V3 validation passed. |
| `node harness/validate-work-items.mjs` (raíz) | Work item validation passed (CORE, 107 WI). |
| `node scripts/sdd-check.mjs` (raíz) | SDD check OK. |

### Comprobación manual por proceso (`node scripts/oe2.mjs`, fixtures en el scratchpad)

| Caso | Salida | Código |
|---|---|---|
| `pool` sin `--guide` | `Error de uso: falta --guide` | 2 |
| `pool --roles foo` | `Error de uso: --roles tiene un rol desconocido …` | 2 |
| `pool --roles oficial` (1 de 3 targets) | Targets 1 de 3; guía copiada con su SHA-256; 8 archivos | 0 |
| `build-gt` sin `--key` | `Error de uso: falta --key` | 2 |
| `build-gt` con plantilla sin adjudicar | `build-gt: 7 problema(s) …` con los 7 `candidate_id` listados; no se crea la carpeta | 1 |
| `build-gt` con plantilla adjudicada | GT de 1 target, 1 relevante, 6 no relevantes; SHA-256 impreso | 0 |
| `score` con el SHA de `gt.sha256` | Puntuado 1/1; congruencia 0 incongruencias | 0 |
| `score` con un SHA incorrecto | `el SHA-256 de la GT no coincide …`; no puntúa | 1 |

## Qué prueban las pruebas nuevas

- **`--guide`:** copia byte a byte de una guía con CRLF y bytes no UTF-8; `manifest.guide` y la entrada de `ciego/GUIA.md` con SHA-256 y tamaño; la hoja tiene el puntero exacto y no contiene «necesario para entender», «sí o no» ni «protocolo que aplique»; ceguera de hojas y plantilla con guía neutra; sin `--guide`, código 2 (parseo y CLI); guía vacía aborta sin escribir; aviso de términos de procedencia sin modificar la guía; `guideBlindTerms` marca SEM/rank/IMPORTS y no marca «se» ni «relación».
- **`--roles`:** parseo (orden canónico, deduplicación, rol desconocido, lista vacía, elemento vacío, sin repetir el valor en el error; `build-gt` con `oficial` por defecto); `pool` con y sin el flag (numeración T01 sobre el filtro, `key`, plantilla y resumen coherentes, manifiesto con `rolesSelected` y `targets`/`targetsInSample`); numeración en el orden del sample tras filtrar; reserva sin comparación excluida y comparación exigida si se incluye; selección sin filas → código 2. `score`: sin flag (solo oficiales, sin CSV no reportable), `calibracion` sin `--include-calibration` (aviso, `scores.json` vacío), `calibracion` con `--include-calibration` (solo al CSV no reportable), `oficial,reserva` con `--include-calibration` (reserva al no reportable, oficial a `scores.json`).
- **`build-gt`:** forma exacta de `gt.json` (solo relevantes, orden por unidades de código, 2 espacios, salto final); target sin relevantes con `[]` y resumen; bytes deterministas, también con la plantilla en otro orden; BOM tolerado; filas de targets no seleccionados validadas en identidad y contadas, sin exigir adjudicación; normalización de decisiones y criterios; criterio obligatorio para relevante y validado si se rellena en no relevante; duplicados; candidato desconocido; `target_id` que no coincide; candidato sin adjudicar; target sin filas; target ausente de la llave; decisiones inválidas con lista completa de ids (tres problemas en un mismo error, con su recuento) y criterios inválidos en relevantes y no relevantes en otro error; selección vacía → código 2; salidas en disco con `gt.sha256` = SHA-256 de `gt.json`, `gt-summary.csv`, `manifest.json` con entradas; mismas entradas, mismos bytes; con error no se escribe nada; salida dentro del repo → código 2.
- **Extremo a extremo:** `pool` con guía → plantilla rellenada con variantes de escritura (`  RELEVANTE `) → `build-gt` → `score` con el `--gt-sha256` del fichero; comprueba que la GT coincide con los relevantes y que `score` acepta el hash, puntúa el target con GT y marca `NA` el target sin relevantes; un `gt.json` alterado tras construirlo se rechaza.

## Ambigüedades resueltas (donde la especificación dejaba margen)

1. **Puntero de la hoja:** se usa el texto del ejemplo del alcance, sin valores ni criterios. Los valores (`relevante`, `no relevante`) y los criterios (`R1`…`R5`) se documentan en el README; la plantilla solo tiene columnas. Así la hoja no define relevancia.
2. **Términos de procedencia en la guía:** `pool` avisa por stdout si la guía contiene SE/SEM, rank, score, estructural, IMPORTS, seleccionado u origen. No avisa por «relación», que es habitual en español; no bloquea ni modifica la guía. Es heurístico: la revisión de la guía sigue siendo responsabilidad del equipo.
3. **`--roles`:** valores en orden canónico y sin duplicados; se recortan espacios; el error no repite el valor recibido. Una selección válida sin filas en el sample es un uso incorrecto (código 2), igual que una selección vacía.
4. **`pool` y comparaciones:** las filas excluidas no exigen comparación. Las comparaciones cargadas sí se validan (configuración congelada) aunque su target esté excluido: un fallo de configuración no se oculta por el filtro.
5. **Orden por target:** el barajado depende de la semilla y del `targetId`, no de los demás targets. Un mismo target tiene el mismo orden de candidatos con o sin `--roles`. La numeración `T<nn>` sí cambia con el filtro, y está declarado: para cruzar corridas hay que usar `targetId` de la llave, no el número de hoja.
6. **`score` con `--roles`:** la congruencia de re-ranking sigue comprobándose en todas las comparaciones cargadas; `--roles` solo restringe las filas puntuadas.
7. **`build-gt`:**
   - `--roles` por defecto `oficial`.
   - Se recortan espacios de `candidate_id` y `target_id`; se tolera un BOM al inicio.
   - El criterio es opcional en «no relevante», pero si se rellena se valida.
   - Las filas de targets no seleccionados se validan en identidad y se cuentan en el manifiesto (`templateRowsOfUnselectedTargets`).
   - `gt.sha256` tiene el formato `sha256sum` (`<hex>  gt.json`); `score` recibe solo el hex, que es el primer campo.
   - El paquete incluye además `hashes.txt` y `manifest.sha256`, como el resto de subcomandos de `oe2`.
   - El campo `workItem` de la herramienta sigue en `WI-CORE-107` (`OE2_TOOL` sin cambios); el alcance no pedía cambiarlo.
8. **Pruebas de WI-107 ajustadas:** solo las que llamaban a `pool` sin `--guide` y la lista de subcomandos. Ninguna prueba dependía del texto antiguo de la hoja. El golden de orden de `pool` (`GOLDEN_POOL_*`) queda sin cambios y sigue en verde.

## Límites

- La guía no es verificable por la tool más allá del aviso heurístico de términos de procedencia.
- `build-gt` valida el vocabulario de la decisión y del criterio, no su coherencia con la guía.
- Sin acuerdo entre anotadores ni κ (fuera de alcance).
- `--max-chars` (6000) sigue siendo una decisión de cross, como en WI-107 (M-4).
- Los archivos nuevos no pasan por `oxlint` (`lint` solo cubre `src/` y `test/`, B-3 de WI-107).
- No se ejecutó nada contra base de datos, Render, GitHub ni red.

## Ciclo de correcciones (revisión independiente, `wi-core-108-independent-review.md`)

Los conteos de las secciones anteriores son del primer ciclo. Este ciclo añade pruebas: `scripts/oe2` pasa de 192 a 211 y `scripts` de 584 a 603. Suite completa: 3840 a 3859 pruebas pasan (125 omitidas por Postgres, sin cambio).

### M-1: emparejamiento plantilla–llave (`--sheets`)

Problema: los `candidate_id` son posicionales (dependen de la semilla). Una llave de otra ejecución de `pool` tiene los mismos ids y pasaba todas las validaciones de la plantilla.

Solución aplicada (sin cambiar columnas de la plantilla ni el manifiesto de `pool`):
- `build-gt` exige `--sheets <carpeta ciego/hojas>` (sin él, código 2).
- `oe2/sheets.mjs` (nuevo, `parseSheet`): lee el formato de `renderSheet` y solo interpreta líneas fuera de bloques de código (un `###` o un «- Archivo:» dentro del código no cuenta; las cercas se cierran con una longitud igual o mayor a la de apertura). Acepta CRLF. Detecta bloque sin cerrar, candidate_id repetido y falta de «Target:».
- `build-gt.mjs` (`checkSheets`): para cada target seleccionado, comprueba que cada `candidate_id` de la llave aparece en su hoja con el mismo `filePath` y `qualifiedName`, que no sobra ni falta ningún candidato, que la hoja del target se llama como indica la llave, y que las hojas de targets que no están en la llave se rechazan. Todo se acumula en la lista de problemas; no se escribe nada si hay alguno.
- Manifiesto: `sheets` con el SHA-256 y el tamaño de cada hoja leída, y `sheetsVerified`.

Pruebas nuevas (en `build-gt.spec.ts`, `e2e-gt.spec.ts`): llave de otra semilla (mismos ids, orden distinto) ⇒ error con «la hoja muestra»; hoja y llave coherentes ⇒ pasa, con bloques de código que contienen `###`, «- Archivo:» falsos y cercas de tres comillas; CRLF ⇒ pasa; candidato extra en la hoja ⇒ error con su id; candidato faltante ⇒ error con su id; target sin hoja ⇒ error; hoja de target fuera de la llave ⇒ error; hoja sin «Target:» o con bloque sin cerrar ⇒ error con el nombre de la hoja; candidate_id repetido en la hoja ⇒ error; sin `--sheets` ⇒ código 2. El extremo a extremo usa `--sheets` y añade un caso con `pool` de otra semilla real.

Mutación (restaurada y verificada): se anuló la comparación de `filePath`/`qualifiedName` en `checkSheets` (`else if (false)`). Fallan 2 pruebas: el extremo a extremo y la llave de otra semilla. Archivo restaurado, idéntico al original (`cmp`).

Comprobación por CLI (fixtures en el scratchpad): llave de la semilla `otra` con hojas de la semilla `s` ⇒ código 1, lista de 5 ids con «la hoja muestra … y la llave …», ningún archivo escrito. Sin `--sheets` ⇒ código 2. Llave y hojas del mismo paquete ⇒ código 0.

### M-2: orden de candidatos con y sin `--roles`

Prueba nueva en `guide-roles.spec.ts` («no cambia el orden de candidatos ni sus candidate_id»): para cada target de la muestra, la hoja (salvo la primera línea, que lleva el número T<nn>) y las filas de su plantilla son idénticas con `--roles <su rol>` y sin `--roles`.

Mutación (restaurada y verificada): en `pool.mjs`, la semilla del barajado pasa a `roles === null ? seed : \`${seed}x\``. Falla la prueba nueva (1 fallo). `pool.mjs` restaurado; `cmp` idéntico al original.

### Menores

- **B-1 (README):** eliminado el encabezado duplicado `### Reglas que fija el CLI`.
- **B-5 (puntero):** la hoja cita `ciego/GUIA.md` (la hoja vive en `ciego/hojas/`). Se añade un golden de la cabecera de la hoja (siete primeras líneas, con el SHA-256 de la guía).
- **B-4 (filas en blanco):** `stripTrailingBlankRows` quita solo las filas totalmente en blanco o con solo comas al final de la plantilla y cuenta las que quita (`templateBlankRowsIgnored`, también en el manifiesto y en stdout). Una fila parcialmente rellena al final sigue fallando con su número de fila (`fila 8`, con target_id vacío); una fila con menos columnas sigue dando error de CSV.
- **B-3 (roles sin filas):** `pool`, `score` y `build-gt` avisan por stdout (`AVISO: --roles pide <rol> y el sample no tiene filas de ese rol`). El código de salida sigue siendo 0 mientras quede al menos una fila; la selección completa sin filas sigue siendo código 2.

### Notas no atendidas (decisión)

- **B-2:** se mantiene la validación del criterio en «no relevante» cuando viene relleno (más estricta que el alcance; documentada).
- **B-6:** `OE2_TOOL.workItem` sigue en `WI-CORE-107`; el reviewer lo marca como informativo y el cambio no estaba pedido.
- **B-7, B-8, B-9:** sin cambio (lint de `scripts/` heredado; prefijo de `toCsv` en ids que empiezan por `=`, `+`, `-`, `@` no ocurre con rutas reales; aviso de procedencia heurístico, declarado).

### Límites nuevos

- El cotejo prueba que la llave y las hojas describen los mismos candidatos por id; no prueba que las hojas sean las que se distribuyeron. Para eso, el runbook debe registrar el SHA-256 de las hojas (ya en el manifiesto de `build-gt`) frente al paquete entregado.
- Si una hoja se edita a mano y añade un `### <id>` fuera de bloques de código, se interpretará como candidato. El formato de `pool` no lo genera.

### Verificación del ciclo (desde `app/`, PATH node22)

| Comando | Resultado |
|---|---|
| `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run scripts` | 27 archivos, 603 pruebas en verde |
| `corepack pnpm@12.14.0 test` (suite completa) | 212 archivos pasan, 11 omitidos; 3859 pruebas pasan, 125 omitidas |
| `corepack pnpm@12.14.0 lint` | salida 0 (no cubre `scripts/`) |
| `corepack pnpm@12.14.0 build` | salida 0 |
| `node harness/validate-harness.mjs` (raíz) | passed |
| `node harness/validate-work-items.mjs` (raíz) | passed (107 WI) |
| `node scripts/sdd-check.mjs` (raíz) | SDD check OK |

Archivos tocados en este ciclo: `app/scripts/oe2/sheets.mjs` (nuevo), `app/scripts/oe2/build-gt.mjs`, `app/scripts/oe2/args.mjs`, `app/scripts/oe2/pool.mjs`, `app/scripts/oe2/score.mjs`, `app/scripts/oe2/build-gt.spec.ts`, `app/scripts/oe2/guide-roles.spec.ts`, `app/scripts/oe2/e2e-gt.spec.ts`, `app/scripts/README.md` y este informe. `wi108-fixtures.mjs` no cambió.
