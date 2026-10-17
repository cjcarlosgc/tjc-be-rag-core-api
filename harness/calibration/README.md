# Replay de calibración offline del RAG (WI-CORE-063)

Herramienta de calibración **offline**: evalúa, sin LLM y sin tocar `app/`, configuraciones candidatas de selección (pesos, topK, mínimo) sobre casos ya persistidos, y las compara con la línea base. Origen: `harness/reports/fase3-calibracion-rag-diagnostico.md` §4 (métricas M1–M6) y `harness/reports/wi-core-063-scope-approval.md`.

No cambia el ranking, las relaciones R-PHP, los pesos del producto ni la base de datos. No es una evaluación de calidad del LLM.

## Qué contiene

| Archivo | Función |
|---|---|
| `lib.mjs` | Funciones puras: carga de casos, `baselineTopK`, `recompute`, métricas M1, M3, M4, M5, M6, tokenizador. |
| `calibrate.mjs` | CLI: calcula métricas para la línea base y los candidatos, verifica la línea base y escribe informes. |
| `extract-experiments.sh` | Extractor de solo lectura desde la base hacia un directorio **externo** al repo. |
| `candidate.example.json` | Ejemplo de candidatos (config por defecto y topK 8). |
| `fixtures/` | Caso sintético `SYN-1` (clases inventadas) para las pruebas. |
| `calibration.test.mjs` | Pruebas. |

## Formato de datos (fuera del repositorio)

Directorio `--data <dir>`, un conjunto de archivos por caso `<CASO>`:

- `<CASO>.meta.json`: `{ id, pv, filePath, symbolName, methodName }`. `symbolName` es el FQCN de la clase declarante.
- `<CASO>.chunks.json`: lista de `{ id, filePath, symbolKind, symbolName, parentSymbolName, importsUsed, content, tokenCount }`.
- `<CASO>.cands.json`: lista de `{ chunkId, sem, struct, combined, decision, rank }`. `decision: "SELECTED"` marca la línea base persistida.
- `<CASO>.trials.json` (opcional): lista de `{ strategy, repetition, valid, failureType, errorSummary, testContent|null, testContentSha256, promptSha256 }`. Sin este archivo, M6 es `n/a`.
- `deps.json` (opcional, una sola lista para todos los casos): `[{ caso, entries: [{ typeName, fqcn, origin, resolvedBy, final?, signature? }], sectionTokens, baselineContextTokens, sectionTokensSinFirmas?, signatureExtraTokens?, signatures?: [{ fqcn, signature }], truncated? }]`. Sin él, la comprobación de la sección de M1 y los tokens de sección de M4 son `n/a`. WI-CORE-065: `signatures` (firmas que constan en la sección) lo usa R-SIG; si falta, la firma se deriva del chunk `CONSTRUCTOR` del tipo (único).

Candidatos (`--candidate <json>`): un objeto de configuración o un array. Campos: `semanticWeight` (0.7), `structuralWeight` (0.3), `topK` (10), `minimumScore` (0) y `name` opcional.

## Cómo extraer (lo ejecuta el leader, no el harness)

```bash
harness/calibration/extract-experiments.sh --out <dir-externo> 951a7bb2 656140e5 cad591d6 5852aeb4 c9948c77 9a905b5a
```

- Lee `DATABASE_URL` de `app/.env` sin imprimirla. Descarta la query de la URL y fuerza `PGSSLMODE=require` salvo que ya esté definido.
- `PGOPTIONS` activa `default_transaction_read_only=on` y `statement_timeout=60000`. El script no contiene sentencias de escritura.
- Por prefijo escribe `EXP-<p>.meta.json`, `.chunks.json`, `.cands.json`, `.trials.json` y fusiona `deps.json`.
- Aborta (código 65) si `--out` resuelve dentro del repositorio, antes de conectar.
- Limitación: la URL pasa como argumento a `psql` y puede ser visible en la lista de procesos durante la ejecución.

## Cómo ejecutar

```bash
node harness/calibration/calibrate.mjs --data <dir> [--candidate harness/calibration/candidate.example.json] [--out <dir-externo>] [--cases A,B] [--no-verify]
node --test harness/calibration/*.test.mjs
```

- Verifica que la línea base recalculada (0.7/0.3, topK 10, mínimo 0) reproduce el SELECTED persistido. Si falla, sale con código 1 (salvo `--no-verify`, solo para diagnóstico).
- Escribe `report.json`, `report.md` y `m2-template.md` en `--out` (por defecto `--data`). Nunca escribe en el repo salvo que `--out` lo indique.
- `m2-template.md` es una plantilla manual R1–R5: **no puntúa nada**.

## Definición de las métricas

**M1: colaboradores.** Colaboradores = tipos del constructor de la clase declarante, tipos de la firma del método objetivo y `new X` del cuerpo (misma regex que `fase2-01-replay-colaboradores.py`, FQCN resueltos por `use`, mismo namespace o nombre literal). Para cada uno:
- `inTop`: hay un chunk de tipo con ese FQCN entre los seleccionados.
- `inSection`: el FQCN aparece en `deps.json` (si existe).
- `missingAnywhere`: ni en el top-K ni en la sección.
- `pctInTop`: `inTop / total`.

**M2: relevancia (manual).** Solo plantilla. R1–R5 los rellena una persona.

**M3: ruido.** Sobre los tokens (`tokenCount`) de los seleccionados:
- `testNoisePct`: tokens de chunks de prueba (ruta con `tests/` o sufijo `Test.php`) cuyo contenido **no** contiene `\bmétodo\b`.
- `memberNoisePct`: tokens de chunks miembro (con `parentSymbolName`) cuya clase **no** es la declarante, que no son prueba, y cuyo nombre **no** aparece en el fragmento objetivo (`__construct` para constructores).

**M4: tokens.**
- `sectionTokensSinFirmas` y `signatureExtraTokens` (WI-CORE-065, si están en `deps.json`): tokens de la sección sin firmas y tokens que añaden las firmas del constructor.
- `selectedTokensPersisted`: suma de `tokenCount` de los seleccionados.
- `sectionTokens`: `sectionTokens` de `deps.json`.
- `sectionTokensCounted` y `selectedTokensCounted`: contados con `cl100k_base` de `app/node_modules/gpt-tokenizer`. Si no carga, se usa `ceil(chars/4)` y se marca `tokenizer: 'estimate'`.
- `deltaVsBaselinePct`: variación de `selectedTokensPersisted` frente a la línea base. Criterio: ≤ +15 %.

**M5: estabilidad.** Solape del top-K candidato con la línea base: `n/K`, Jaccard, `sameSet`, `sameOrder`. `tenOfTen` = mismo conjunto y mismo orden con K = 10.

**M6: reglas estáticas sobre `testContent` de cada trial** (no depende de la configuración). Las reglas R-ANON-FINAL, R-STATIC-THIS y R-SIG son de WI-CORE-065; R-NEW-ENUM y la rama `implements` de R-ANON-FINAL son de WI-CORE-067; se miden sobre los casos V1 y sus trials.
- `R-FINAL`: `createMock|createStub|getMockBuilder|prophesize|Mockery::mock( X::class )` donde X resuelve a un tipo `final` del caso (chunks de tipo; `final` antes de `class`, sin `abstract`; enum implícito como final). Solo marca tipos presentes en `chunks.json`; un tipo desconocido o una interfaz no se marca.
- `R-SAME` (heurística acotada desde WI-CORE-063 corte B): se marca un `assertSame(` si un argumento cumple una de estas condiciones:
  - (a) Es directamente `new X(` inline con X `DateTime`, `DateTimeImmutable` o una clase `final readonly` del caso.
  - (b) Es una variable `$v` asignada **en el mismo método de test** con `new X(` (X `DateTime`/`DateTimeImmutable` o `final readonly` del caso) o con `DateTimeImmutable::createFromFormat(`, y `$v` **no aparece en ninguna otra sentencia de ese método** salvo su asignación y ese `assertSame`. Si se pasa a un constructor, setter, método o cualquier otra expresión, se asume posible identidad y **no** se marca.
  - Se analiza por segmentos `function nombre(` (de una declaración a la siguiente). Líneas fuera de métodos no se analizan. Una reasignación de `$v` cuenta como otra sentencia.
  - Motivación: una identidad legítima (mismo objeto pasado al sujeto, p. ej. `$plan` en `new Sub($plan)`) no es un fallo; solo es sospechosa cuando el objeto se crea en el test y no tiene otro uso.
- `R-ANON-FINAL` (WI-CORE-065, ampliada en WI-CORE-067): `new class extends X` o `new class(...) extends X` con X resuelto (por `use`, mismo namespace o FQCN) a un tipo `final` (o enum) del caso. WI-CORE-067: también `new class [(...)] implements A[, B]` (con o sin `extends` previo) cuando algún tipo de la lista resuelve a un tipo `final` del caso. Interfaces y tipos no final no se marcan. Limitación: solo cabeceras en una línea.
- `R-STATIC-THIS` (WI-CORE-065): `$this->` en el cuerpo de un closure `static function (` (balance de llaves) o `static fn (` (hasta el fin de la expresión simple). Un método `static function nombre(` no es un closure y no se analiza.
- `R-SIG` (WI-CORE-065): `new X(` con X cuya firma consta (`deps.json` `signatures`, o derivada del constructor del chunk) y con un parámetro obligatorio sin argumento posicional ni nombrado (`missing-required`), o con un argumento nombrado inexistente (`unknown-named`). Parámetros con valor por defecto o variádicos no son obligatorios; una llamada con splat `...` no se evalúa. Solo tipos del proyecto con firma conocida.
- `R-NS`: `use` de nivel superior cuyo FQCN no está en {FQCN de tipos del caso, `importsUsed` de los chunks, FQCN de `deps.json`}, ni es `PHPUnit\Framework\*`, ni es una clase global de PHP sin barra.
- `R-NEW-ENUM` (WI-CORE-067): `new X(` donde X resuelve a un tipo de `kind` `ENUM` presente en `chunks.json`. Un enum no se instancia; el uso correcto es `X::Caso`.
- Cada regla devuelve `{ rule, count, evidence: [{ line, snippet ≤ 80, strategy, repetition }] }` con un máximo de 20 evidencias, y `precision` (contadores por regla, ver abajo). Las siete reglas: `R-FINAL`, `R-SAME`, `R-NS`, `R-ANON-FINAL`, `R-STATIC-THIS`, `R-SIG`, `R-NEW-ENUM`.
- Limitación: solo analiza líneas. Las llamadas `assertSame` multilínea no se detectan. R-SIG y R-STATIC-THIS sí siguen llamadas y closures multilínea (balance de paréntesis y llaves), pero no cadenas con llaves desbalanceadas. La heurística de R-SAME no resuelve alias ni asignaciones indirectas (`$a = $b`) ni identidad a través de arrays o propiedades.

**Precisión observada (M6).** Por regla y por trial analizado (con `testContent`), se cuenta:
- `hitTrials`: trials con al menos un hit de la regla (no hits de línea).
- `hitValid`: de ellos, los de `valid=true` (posibles falsos positivos).
- `hitFailed`: de ellos, los de `valid=false`.
- `failedWithEvidence`: trials fallidos (cualquiera, analizado o no) cuyo `errorSummary` contiene evidencia de la clase de fallo de la regla. Evidencia: R-FINAL `ClassIsFinal` o «final» + «mock»; R-SAME «same object» o «reference the same»; R-NS «not found», `Class (or interface) "…" does not exist` o `UnknownType`; R-ANON-FINAL «cannot extend final», «final class» o «cannot implement … it is not an interface»; R-NEW-ENUM «Cannot instantiate enum»; R-STATIC-THIS «Using $this when not in object context»; R-SIG `ArgumentCountError`, «Too few arguments» o «Unknown named parameter». El formato real de PHPUnit para R-NS es `Class or interface "X" does not exist`, por eso la expresión es más amplia que la del diseño inicial.
- `hitFailedWithEvidence`: trials con hit, fallidos y con evidencia.
- `precisión` = `hitFailedWithEvidence / hitTrials`; `sensibilidad` = `hitFailedWithEvidence / failedWithEvidence`. `n/a` si el denominador es 0.
- Los contadores se agregan sumando casos (`aggregateM6Precision`) y los ratios se recalculan sobre la suma. Se informa en `report.json` (`m6Precision`, por caso en `cases[id].baseline.m6.precision`) y en `report.md` (sección «Precision observada (M6)»).
- Lectura: la precisión mide si los hits caen en fallos con la clase de error esperada, no si el hit es correcto. Un hit en trial `valid=true` no prueba que sea falso positivo, y un trial fallido sin evidencia no prueba que la regla esté equivocada. Son indicadores sobre una muestra pequeña, no una evaluación.

## Advertencias

- **Muestra pequeña**: 9 casos V1 y 6 verificaciones no oficiales. Son insumo de calibración, no de evaluación. Los pilotos nuevos deben usar cortes y protocolos distintos.
- **Proxies**: M1 mide presencia de tipos, no que el LLM los use. M3 y M6 son heurísticas. M6 no sustituye ejecutar la prueba.
- **Sin LLM**: no mide si el modelo genera pruebas válidas con un contexto distinto.
- **Versiones**: no comparar con el piloto sin declarar la versión del prompt PHP, del resolutor de dependencias (WI-057/058) y de `inspect_symbol` (WI-059). `METRIC_VERSION` del informe es `WI-CORE-063/v1`.
- **Datos de terceros**: los volcados de `--data` con código real de terceros **no van al repositorio**. Usa un directorio externo. Solo el fixture `SYN-1` (clases inventadas) está versionado.
