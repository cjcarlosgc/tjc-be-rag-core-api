# Experimentos 1 y 2 (RAG vs Generalist Agent): observaciones para las Tablas V y VI

Fecha: 2026-10-13. Solo lectura sobre la base real (consultas `SELECT`, sesión `default_transaction_read_only=on`) y sobre el código de `app/`. No se ejecutó ni se modificó nada. Sin secretos.

Convención: **[DB]** = dato leído de la base real; **[CÓDIGO]** = leído del código; **[NO VERIFICABLE]** = no está persistido o no se pudo comprobar.

## 0. Resumen ejecutivo

1. **Exp. 2 (`Voucher::redeem`)**: RAG 0/3 y Agente 3/3. No es un fallo de recuperación: RAG recibió las 2 reglas funcionales ACTIVE («lanza `InvalidArgumentException` si el monto supera el saldo») y generó pruebas que las respetan; el código real devuelve `0.0`. El Agente solo leyó el código y caracterizó su comportamiento real, por eso pasó. Las pruebas de RAG fallan porque **el código viola una regla ACTIVE**, que es justo lo que el sistema debe detectar.
2. **Exp. 1 (`OrderLine::hasStock`)**: 2/3 y 2/3, empate. `hasStock()` devuelve `$this->quantity === 0` (condición invertida). No hay reglas funcionales. Pasan las pruebas que caracterizan el comportamiento real; falla la que asume la semántica del nombre («sin cantidad → false»), tanto en RAG (rep. 3) como en el Agente (rep. 1).
3. **`valid` y `passed` son idénticos** en experimentos (`valid = passed`); no hay una columna «VT» separada. Una aserción fallida contra una regla ACTIVE cuenta como `valid=false` y entra en el denominador (sigue siendo evaluable). Eso es lo que hace «peor» a RAG en la Tabla V.
4. RAG usó menos tokens (3 755 vs 7 249 en exp. 2) porque **no hay bucle de herramientas**: una sola llamada con ~1 000–1 300 tokens de entrada; no hubo truncamiento por presupuesto (contexto 569–756 tokens de 8 000).
5. **tjc-piloto-reservas y tjc-piloto-suscripciones NO existen en Core**: no hay Project, binding, versión ni targets (solo `PilotoDeVentas` y `tjc-fe-ts-repo-test`).

## 1. Datos por ensayo

Configuración común [DB]: modelo `gpt-5.4-nano`, endpoint `responses`, `reasoningEffort=none`, temperatura `null`; presupuesto `{toolCallCap: 20, maxDurationMs: 120000, contextTokenBudget: 8000}`; perfil `PHP_LARAVEL_PHPUNIT`, runner `PHPUNIT`; 6 repeticiones (3 pares); todas `COMPLETED`, `technicallyEvaluable=true`, sin timeout.

El **código fuente de la prueba generada no está persistido** [NO VERIFICABLE]: `experiment_repetitions` solo guarda `artifactHash` (sha256 truncado abajo a 12 hex) y `errorSummary` con el nombre de la prueba fallida y la aserción. Lo que sigue son hechos del Sandbox.

### Experimento 1 — `89a16229-76e9-4dcf-a181-b81dc73efa5f` — `OrderLine::hasStock` (versión `3b5035a1`)

| Estrategia | Rep | valid | passed | failureType | tests (total/fallidos) | tokens in/out/total | gen ms | exec ms | tool calls | archivos | artifactHash |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RAG | 1 | t | t | NONE | 2/0 | 1295/145/1440 | 3127 | 25606 | – | – | aa02c7820184 |
| RAG | 2 | t | t | NONE | 2/0 | 1295/145/1440 | 2012 | 23307 | – | – | aa02c7820184 |
| RAG | 3 | f | f | TEST_ASSERTION | 2/2 | 1295/125/1420 | 1934 | 23260 | – | – | cd44a4620be0 |
| Agente | 1 | f | f | TEST_ASSERTION | 3/3 | 2265/286/2551 | 5034 | 23271 | 4 | 1 | 247850fabd96 |
| Agente | 2 | t | t | NONE | 2/0 | 2971/248/3219 | 5998 | 25063 | 5 | 1 | 92f265fb8f0f |
| Agente | 3 | t | t | NONE | 2/0 | 2645/282/2927 | 7368 | 25131 | 5 | 1 | aebb2eef55b6 |

Mensajes de fallo [DB]: RAG rep. 3 y Agente rep. 1 fallan con `OrderLineHasStockTest::…returns_false_when_quantity_is_zero — Failed asserting that true is false` (`OrderLineHasStockTest.php:14`). Totales de tokens: RAG 4 300; Agente 8 697.

### Experimento 2 — `800689b9-2da9-47dc-9b1a-90befa39caba` — `Voucher::redeem` (versión `6bf36bfb`)

| Estrategia | Rep | valid | passed | failureType | tests (total/fallidos) | tokens in/out/total | gen ms | exec ms | tool calls | archivos | artifactHash |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RAG | 1 | f | f | TEST_ASSERTION | 3/1 | 996/257/1253 | 2596 | 23225 | – | – | 4236b9434956 |
| RAG | 2 | f | f | TEST_ASSERTION | 3/1 | 996/282/1278 | 2789 | 23457 | – | – | e8c308822d7f |
| RAG | 3 | f | f | TEST_ASSERTION | 3/1 | 996/228/1224 | 2323 | 25481 | – | – | 612990cb6250 |
| Agente | 1 | t | t | NONE | 3/0 | 2092/347/2439 | 6470 | 23127 | 5 | 1 | 28d84fb1efd1 |
| Agente | 2 | t | t | NONE | 4/0 | 1766/316/2082 | 5981 | 23088 | 2 | 1 | 73a638048699 |
| Agente | 3 | t | t | NONE | 3/0 | 2330/398/2728 | 6820 | 25231 | 6 | 1 | 8f350481d084 |

Mensajes de fallo [DB]: las 3 repeticiones RAG fallan con `Failed asserting that exception of type "InvalidArgumentException" is thrown` (2 de 3 en `testRedeemThrowsInvalidArgumentExceptionWhenAmountIsGreaterThanBalance`, 1 en `testRedeemReturnsZeroWhenAmountIsGreaterThanBalance`). Los otros 2 tests de cada archivo pasan (2 passed / 1 failed). Totales: RAG 3 755; Agente 7 249.

Todas las ejecuciones: `compiled=true`, `executed=true`, sin `failureCode`/`failureStage`; `executionDurationMs` ≈ 23–25 s es casi todo arranque/instalación del Sandbox (similar entre estrategias), así que la latencia diferencial real está en `generationDurationMs` (RAG ≈ 2–3 s vs Agente ≈ 5–7 s).

## 2. Contexto de RAG y exploración del Agente

### Exp. 1 (hasStock)
- Configuración [DB]: `topK=10`, `minimumScore=0`, `semanticWeight=0.7`, `structuralWeight=0.3`, `maxContextTokens=8000`.
- Recuperados 23, seleccionados 10, **756 tokens de contexto**; los 13 descartados lo fueron por `TOP_K_LIMIT`, ninguno por presupuesto.
- Seleccionados: `OrderLine` (clase, 326 tokens, `DECLARING_CLASS`), `OrderLine::isEmpty`, y 8 chunks de **pruebas** (`OrderLineTest`, `OrderLineIsSingleTest`; vía `IMPORTED_BY`). Es decir, ~70 % del contexto son pruebas existentes de otros métodos, no del target.
- **Reglas funcionales: 0 recuperadas, 0 seleccionadas** (no existe ninguna sobre `hasStock`).
- El target (`hasStock`, `return $this->quantity === 0;`) va aparte como `target.excerpt`; el nombre `hasStock` sugiere la semántica contraria al código, y el contexto no aporta ninguna regla que lo aclare. El ruido es moderado (tests de `total`/`isSingle`) y la omisión relevante es la ausencia de regla, no de código.

### Exp. 2 (redeem)
- Misma configuración. Recuperados 20, seleccionados 10, **569 tokens**; 10 descartados por `TOP_K_LIMIT`.
- Seleccionados: `Voucher` (clase), `TaxPolicy::calculate`, `DiscountCalculator::*`, `Promotion::percentage`, `OrderLine::total`, `DiscountPolicy::*`, `OrderLine::ensureNonNegativePrice`. **Mucho ruido semántico**: solo el primero es relevante; los otros 9 son vecinos por similitud con «descuento/porcentaje».
- **Reglas funcionales: 2 recuperadas y 2 seleccionadas**, ambas `ACTIVE`, `HUMAN_ANSWER`, confirmadas por ADMIN, `scenarioKind` BOUNDARY y EXCEPTION sobre `Voucher.redeem`:
  - `04e0239a…`: «si el monto a canjear es mayor que el saldo, el canje se rechaza lanzando `InvalidArgumentException`; si es igual o menor se descuenta y se devuelve el saldo restante».
  - `f71fc32c…`: «debe lanzar `InvalidArgumentException` cuando el monto a canjear es mayor que el saldo disponible».
- El código real del target: `if ($amount > $this->balance) { return 0.0; } return $this->balance - $amount;`. **Contradice las dos reglas.** (La pregunta de la regla EXCEPTION cita incluso `throw new \InvalidArgumentException('saldo insuficiente')`, que no existe en el head analizado; las reglas se generaron con `originHeadSha 4533de9e…`; que ese head tuviera el `throw` no está verificado).
- Conclusión: RAG hizo lo correcto según la especificación funcional vigente. El «fallo» es un **hallazgo** (código desalineado con regla ACTIVE), no un error de generación.

### Agente (ambos)
- Trayectoria típica [DB, `context_traces` AGENT/trajectory]: `list_files` (15–16 archivos, truncado por `CHAR_LIMIT`) → `inspect_symbol` con nombre calificado con `\` (devuelve «no se encontró el símbolo», 2 veces) → `read_file`/`search_text` del archivo del target. 2–6 llamadas, 1 archivo inspeccionado, nunca se acerca al tope de 20 ni a 8 000 tokens (≈ 500 entregados).
- El Agente **no recibe las reglas funcionales** por esta vía: lee el código y caracteriza lo que hace. Por eso en exp. 2 genera pruebas que pasan contra el código aunque este viole la regla.
- Observación de herramienta: `inspect_symbol` falla sistemáticamente con símbolos PHP calificados (`App\Domain\OrderLine\hasStock`) — el Agente gasta 2 llamadas inútiles por ensayo. Es una mejora de eficiencia, no de validez.

## 3. Por qué RAG usó menos tokens

- RAG es **una sola llamada** al LLM con el contexto ya armado (entrada 996–1 295 tokens); el Agente hace un bucle de 2–6 pasos y re-envía el historial (entrada 1 766–2 971, salida mayor).
- **No hubo truncamiento por presupuesto**: 756 y 569 tokens de 8 000 (`maxContextTokens`); el límite que actuó fue `topK=10`. Ni el Agente alcanzó su cap (`capReached=false`, 495 tokens entregados).
- La diferencia de costo es estructural (≈ 1.9–2.0× a favor de RAG), no un artefacto de truncar. Ojo: el truncamiento sí ocurrió en `list_files` del Agente (`CHAR_LIMIT`), irrelevante para el costo.

## 4. Mapeo a CF / CO / VT y definición exacta de `valid`/`passed`

[CÓDIGO] `app/src/sandbox/map-sandbox-result.ts` (`mapSandboxResult`):
- `TIMED_OUT` → `valid=false`, `failureType=INFRASTRUCTURE`.
- `FAILED` o sin `facts` → `valid=false`, `failureType` = categoría del Sandbox (o `UNKNOWN`).
- `facts.passed=true` → `valid=true`, `passed=true`, `failureType=NONE`.
- `facts.passed=false` → `valid=false`, `failureType`: `COMPILATION` si `!compiled`; `TEST_RUNTIME` si `!executed` o algún caso fallido con `failureKind=ERROR` (DEC-PHP-GEN-002); en otro caso **`TEST_ASSERTION`**.

Por tanto **`valid ≡ passed`** en `ExperimentRepetition`: «válida» = todas las pruebas generadas pasan en el Sandbox. `compiled` y `executed` se persisten aparte. `validRate`, `passedRate`, `compilationRate` y `executionRate` se calculan sobre repeticiones con `technicallyEvaluable !== false` (`experiments.service.ts`, `aggregateStrategy`); un `TEST_ASSERTION` **sí es evaluable** y cuenta en el denominador como no válida; solo se excluyen los slots que agotaron el reintento externo (`technicallyEvaluable=false`).

Qué clasifica y qué no Core hoy:
- Clasifica: compilación, ejecución, aserción, runtime, dependencia, configuración, infraestructura, desconocido.
- **No distingue** una aserción fallida porque el **código viola una regla ACTIVE** (hallazgo legítimo) de una aserción fallida porque **el LLM adivinó mal** (error de generación). Ambas son `TEST_ASSERTION` / `valid=false`. La causa solo puede inferirse comparando con las reglas del contexto.
- No hay un campo «prueba técnicamente válida» (VT) separado de `passed`.

Mapeo propuesto para el paper (con los datos actuales, sin tocar código):
- **CF (compila/ejecuta)** = `compiled ∧ executed` → RAG y Agente 3/3 en ambos experimentos.
- **CO (correcta/pasa)** = `passed` → exp. 1: RAG 2/3, Agente 2/3; exp. 2: RAG 0/3, Agente 3/3.
- **VT (válida técnicamente: se ejecuta y la prueba es coherente, falla solo por aserción)** = `compiled ∧ executed ∧ failureType ∈ {NONE, TEST_ASSERTION}` → 3/3 en todas las celdas. Es derivable hoy desde columnas ya persistidas.

### Propuesta (NO implementada, requiere decisión)
Exponer en `StrategyMetricsResponse` un contador/tasa separada, p. ej. `technicallyValidRate` (compiló y ejecutó, sin `COMPILATION/TEST_RUNTIME/DEPENDENCY/CONFIGURATION/INFRASTRUCTURE`) y, opcionalmente, `assertionFailureCount`, sin cambiar la semántica de `valid`/`passed` (retrocompatible, contrato aditivo con Contract Sync). Para discriminar «violación de regla» vs «error del modelo» haría falta cruzar el caso fallido con las reglas ACTIVE del contexto (equivalente a la precedencia de DEC-VAL-002 ya aprobada para el análisis de PR); eso es trabajo mayor y no se propone sin pedirlo.

## 5. Estado en Core de tjc-piloto-reservas y tjc-piloto-suscripciones

[DB] `projects` + `repository_bindings`: existen solo `PilotoDeVentas` (`rag-tesis-org/tjc-piloto-ventas`, ENABLED, rama `develop`) y `tjc-fe-ts-repo-test`. **No hay Project ni binding** para `tjc-piloto-reservas` ni `tjc-piloto-suscripciones`; por tanto tampoco `ProjectVersion`, `TestTarget` ni reglas. Los símbolos pedidos (`ReservationPeriod::durationMinutes`, `AvailabilityService::canReserve`, `CancellationPolicy::refundAmount`, `PlanPriceCalculator::monthlyAmount`, `RenewalService::renew`, `Subscription::handleFailedPayment`) **no están en Core**.

Para que existan: crear el Project y el binding (GitHub App instalada sobre esos repos, acción del usuario/Integration) y analizar una versión; Core generará los `TestTarget` en el análisis de snapshot.

Soporte del adaptador PHP [CÓDIGO]; lo que sigue es lectura de código, **no verificado con ejecución real**:
- Detección PHP por `composer.json` presente (`framework-detector.ts`); `resolveUniqueComposerRoot` elige el único `composer.json` (si hay varios → pausa a la espera de decisión de projectRoot). Un layout con `src/` sin `app/` es indexable.
- Ubicación del test (`php-test-path.ts`): bajo `app/` se descarta el prefijo; **fuera de `app/` se conserva la ruta completa** (`src/Domain/X.php` → `tests/Unit/src/Domain/XMetodoTest.php`, namespace `Tests\Unit\Src\Domain`). Funciona mientras PHPUnit descubra `tests/Unit` recursivamente y el autoload PSR-4 de `composer.json` resuelva la clase bajo prueba; si el namespace raíz no es `App\` el test debe importar el namespace real (lo decide el LLM con el contexto, no Core).
- `vendor/` se excluye del análisis (`indexing.constants.ts`). **Laravel sin `vendor`**: Core no instala dependencias; depende del Sandbox. El humo de 2026-10-12 solo ejercitó el fixture PHPUnit del propio Sandbox y los experimentos usaron `PilotoDeVentas`; **[NO VERIFICABLE]** desde Core que un proyecto Laravel completo sin `vendor` instale dependencias y arranque dentro del límite de tiempo (hay que preguntar al Sandbox).

## 6. Limitaciones del análisis

- No se recuperó el texto de las pruebas generadas (no se persiste); la causa de cada fallo se infiere del `errorSummary` y de las reglas/código del contexto.
- `n=3` por estrategia y caso, un solo modelo (`gpt-5.4-nano`, esfuerzo `none`); las diferencias no son estadísticamente concluyentes.
- Las reglas del exp. 2 fueron confirmadas por una persona (ADMIN); que el código actual las viole puede ser el escenario que el piloto buscaba, pero conviene dejarlo explícito en el paper para no leerlo como defecto de RAG.
