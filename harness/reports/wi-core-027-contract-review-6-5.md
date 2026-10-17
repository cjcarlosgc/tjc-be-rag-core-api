# WI-CORE-027 · Revisión contractual de INTEROP-2.7 §6.5/§6.5.1 (DEC-EVID-001, opción A)
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

## Veredicto

**APPROVED**, con una precisión de redacción que el leader debe aceptar al consolidar (ver «Punto a confirmar»). No requiere nueva decisión del usuario: está dentro de DEC-EVID-001 por analogía con la regla ya vigente de WI-CORE-025 («nunca 0 inventado»). Es un cambio de tipo en respuesta, por tanto **breaking en compilación para Console (TS estricto) aunque aditivo en runtime para valores no nulos**; no justifica bump de versión (ver más abajo).

## Estado actual verificado

- `spec/contracts/interoperability-contract.md` líneas 279-298: `validRate`, `compilationRate`, `executionRate`, `passedRate`, `generationDurationMs`, `executionDurationMs`, `totalDurationMs` son `number`. `inputTokens`, `outputTokens`, `totalTokens`, `estimatedCost`, `retrievedChunks`, `selectedChunks`, `contextTokens`, `toolCalls`, `filesInspected` ya son `number | null` (no cambian).
- Línea 326: «Un valor no observable se representa con `null`, nunca con cero» — la regla general ya existe y hoy la contradice la línea 342 («0 = sin datos evaluables»). El cambio la hace coherente.
- Línea 342 contiene la frase a reemplazar y ya documenta `ExperimentRepetitionResponse.executionDurationMs: number | null` y que `StrategyMetricsResponse.executionDurationMs` «sigue siendo `number`» (esto último queda obsoleto).
- Código: `rate()` (service L86-88) devuelve `0` con lista vacía; `aggregateStrategy` (L312-343) usa `Math.round(mean(...) ?? 0)` para las tres duraciones; tokens/costo/chunks ya usan `roundOrNull`/`mean` con `null`.

## Texto propuesto exacto

### 1. Bloque `StrategyMetricsResponse` (§6.5, líneas ~279-298)

```ts
interface StrategyMetricsResponse {
  strategy: ExperimentStrategy
  evaluableRepetitions: number // INTEROP-2.7: repeticiones vigentes con technicallyEvaluable !== false; 0..3
  nonEvaluableRepetitions: number // INTEROP-2.7: repeticiones vigentes con technicallyEvaluable === false; evaluable + noEvaluable = repeticiones vigentes de la estrategia
  validRate: number | null // null si evaluableRepetitions = 0
  compilationRate: number | null
  executionRate: number | null
  passedRate: number | null
  generationDurationMs: number | null // media; null si evaluableRepetitions = 0
  executionDurationMs: number | null // media de los valores no nulos; null si ninguna repetición evaluable invocó el Sandbox
  totalDurationMs: number | null // media; null si evaluableRepetitions = 0
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCost: number | null
  retrievedChunks: number | null
  selectedChunks: number | null
  contextTokens: number | null
  toolCalls: number | null
  filesInspected: number | null
  failures: Partial<Record<FailureType, number>>
}
```

### 2. Reemplazo de la viñeta «Semántica observable de las métricas agregadas» (§6.5.1, línea ~342)

> - Semántica observable de las métricas agregadas: `StrategyMetricsResponse` calcula `validRate`, `compilationRate`, `executionRate`, `passedRate`, los promedios y `failures` únicamente sobre las repeticiones vigentes con `technicallyEvaluable !== false` (ese es el denominador; los slots no evaluables no entran). `evaluableRepetitions` es el número de esas repeticiones y `nonEvaluableRepetitions` el de las vigentes con `technicallyEvaluable: false`; su suma es el número de repeticiones vigentes de la estrategia (una por slot, su último intento; 3 en un experimento completo) y no cuenta intentos superados. Cuando `evaluableRepetitions` vale `0`, las tasas y las medias de duración (`generationDurationMs`, `executionDurationMs`, `totalDurationMs`) valen `null` y los promedios de tokens, costo, chunks, herramientas y archivos siguen siendo `null`; `failures` queda vacío. Un `0` en una tasa o duración significa cero real sobre al menos una repetición evaluable (por ejemplo `passedRate: 0` = ninguna pasó). Los consumidores deben tolerar `null` y mostrar «sin datos» en lugar de `0 %`; `evaluableRepetitions` y `nonEvaluableRepetitions` distinguen «sin datos» de un valor real sin recurrir a `repetitions[]`. `ExperimentRepetitionResponse.executionDurationMs` es `null` si el Sandbox nunca se invocó y en corridas previas (antes se emitía `0`); si la llamada al Sandbox se hizo y falló (p. ej. `SandboxUnavailableError`), registra el tiempo transcurrido de esa llamada. `StrategyMetricsResponse.executionDurationMs` es la media de los valores no nulos de las repeticiones evaluables y es `null` si no hay ninguno. En experimentos anteriores a OE5 todas las repeticiones son evaluables (`technicallyEvaluable` ausente o `true`) y los contadores resultan `evaluableRepetitions = n`, `nonEvaluableRepetitions = 0`.

### 3. Frase de la línea 326 (sin cambio de reglas)

Añadir al final: «Las tasas y las medias de duración de `StrategyMetricsResponse` siguen esta regla (INTEROP-2.7, WI-CORE-027).» Opcional; la viñeta anterior ya basta.

### 4. Nota de estado (§6.5.1, párrafo «Implementado en …»)

Cuando WI-CORE-027 corte D esté implementado, añadir `WI-CORE-027` a la lista y la frase: «Desde WI-CORE-027 las tasas y las medias de duración de `StrategyMetricsResponse` son `number | null` y se añaden `evaluableRepetitions` y `nonEvaluableRepetitions`.» No tocar la cabecera de versión (línea 3) ni la línea 14, salvo agregar `WI-CORE-027` donde ya aparece la lista de WI de §6.5.1.

### 5. Relación con otros DTO

- `ExperimentRepetitionResponse` no cambia de forma. `technicallyEvaluable` (opcional/boolean ya expuesto) sigue siendo el hecho por slot; los contadores son su agregado por estrategia. Invariante verificable: `evaluableRepetitions` = `count(repetitions where strategy = s and technicallyEvaluable !== false)`.
- Bundle de evidencia §6.16: no lleva tasas ni medias (solo `experimental[]` con `attempt`, `pairId`, etc.; líneas ~1185-1193). No se modifica; se recomienda NO duplicar los contadores allí (DEC-EVID-004 define su contenido). Si el bundle debe indicar slots no evaluables, hacerlo por repetición, no con los agregados.
- `ExperimentResultsResponse` no cambia.

## Punto a confirmar (única precisión no literal de la decisión)

DEC-EVID-001 habla de «sin slots evaluables». Hay un caso adyacente: slots evaluables pero ninguno invocó el Sandbox (p. ej. 3 generaciones inválidas), donde hoy `Math.round(mean(...) ?? 0)` emite `0` para `executionDurationMs` aunque las repeticiones tienen `executionDurationMs: null`. Se propone, en coherencia con WI-CORE-025 («nunca 0 inventado») y con cómo ya se calculan tokens/costo (`mean` de no nulos, `null` si ninguno), que `StrategyMetricsResponse.executionDurationMs` sea `null` también en ese caso (la viñeta propuesta ya lo dice). Si el usuario prefiere el alcance literal (solo `evaluableRepetitions = 0`), cambiar en la viñeta la frase «null si ninguna repetición evaluable invocó el Sandbox» por «null solo si `evaluableRepetitions = 0`»; en ese caso el servicio conservaría `0`. Recomendado: mantener `null`; el leader lo registra como interpretación dentro de DEC-EVID-001 y lo menciona al reviewer humano. No requiere ampliar la decisión.

## Impacto en consumidores internos de Core (verificado)

- Archivos que mencionan `StrategyMetricsResponse`/tasas: `app/src/experiments/experiments.service.ts`, `app/src/experiments/dto/experiment.response.ts`, `app/src/experiments/experiments.service.spec.ts`. Ningún otro módulo (comparación OE2/retrieval-comparison, ranking, evidencia/trace, controller más allá de re-exportar) lee `validRate`, `passedRate` ni las duraciones medias; no hay consumidor interno que haga aritmética con ellos.
- Cambios de código necesarios (corte D): `StrategyMetricsResponse` en el DTO (tasas y 3 duraciones a `number | null`, dos contadores); `rate()` debe devolver `null` con lista vacía (hoy `0`, L86-88); quitar `?? 0` y el `Math.round` directo en `generationDurationMs`/`executionDurationMs`/`totalDurationMs` (usar `roundOrNull`); calcular `evaluableRepetitions = repetitions.length` (ya filtrado) y `nonEvaluableRepetitions = allRepetitions.length - repetitions.length`.
- Pruebas: actualizar expectativas de `experiments.service.spec.ts` que asuman `0` para slots no evaluables (cualquier caso «todos no evaluables» o sin repeticiones) y agregar casos: 0 evaluables → nulls y contadores `0`/`3`; mezcla 2/1; `passedRate: 0` con evaluables → `0` real; experimento pre-OE5 → `n`/`0`; `executionDurationMs` null con evaluables sin Sandbox.
- Riesgo de ruptura interna: ninguno detectado. Riesgo de persistencia: ninguno (son agregados calculados, no columnas).

## Evaluación de compatibilidad y versionado

- Breaking para Console: **sí en tiempo de compilación** con TS estricto (`number` → `number | null` rompe aritmética, `toFixed`, formateo, comparaciones sin guardia). En runtime los consumidores que leían `0` verán `null` solo cuando antes veían un `0` engañoso. Los dos campos nuevos son aditivos. Por tanto el CS debe declarar `breaking: true`.
- Versión de INTEROP: **no requiere `INTEROP-2.8`**. La sección ya está marcada `Implementado` bajo 2.7, el contrato vigente de §6.5.1 sigue sin consumidor productivo que dependa del `0` (Console aún no consume métricas de OE5 completas; WI-CONSOLE-017/020 pendientes) y el precedente WI-CORE-025 (`executionDurationMs` nullable, CS-CORE-20261009-008/-009) cambió un tipo en 2.7 con nota de estado y CS. Basta consolidar en la spec canónica + `CHANGELOG.md` + nota de estado + CS. Diferencia respecto de -008/-009: aquel cambio fue `breaking: false` por ser un campo que ya admitía `null` en uso real; este sí cambia el tipo de campos de agregados, por eso `breaking: true`, y debe emitirse antes de que Console cierre WI-CONSOLE-017/020. Si el leader prefiere tratar «versión no publicada a consumidores productivos» de otra forma, la alternativa es documentar la excepción en `CHANGELOG.md`; no es necesaria.
- Orden recomendado: consolidar el texto en INTEROP en el mismo commit documental que cambie `spec.md`/`tasks.md` de la 008 antes del corte D; emitir el CS al publicar la implementación (sourceRevision del commit del corte D), no antes.

## Texto del evento Contract Sync (CS-3 del WI; id sugerido CS-CORE-20261009-010 o el siguiente libre)

```yaml
type: CONTRACT_SYNC
id: CS-CORE-<AAAAMMDD>-<NNN>
source: core
sourceWorkItem: WI-CORE-027
targets: [console]
scopePaths: [spec/contracts/interoperability-contract.md]
breaking: true
changed:
  - "StrategyMetricsResponse (INTEROP-2.7 §6.5/§6.5.1, DEC-EVID-001 opcion A): validRate, compilationRate, executionRate, passedRate, generationDurationMs, executionDurationMs y totalDurationMs pasan de number a number | null. Son null cuando la estrategia no tiene repeticiones evaluables (technicallyEvaluable !== false); executionDurationMs es null tambien si ninguna repeticion evaluable invoco el Sandbox. 0 solo significa cero real. Se anaden evaluableRepetitions y nonEvaluableRepetitions (number; suman las repeticiones vigentes de la estrategia). ExperimentRepetitionResponse, ExperimentResultsResponse y el bundle de evidencia (§6.16) no cambian. Sin bump de version INTEROP-2.7."
requiredAction:
  - "Console (WI-CONSOLE-017/020): refrescar el contrato desde sourceRevision y acusar; tipar las tasas y las tres medias de duracion como number | null y los dos contadores como number; mostrar «sin datos» (no 0 % ni 0 ms) ante null, y usar evaluableRepetitions/nonEvaluableRepetitions para indicar cuantas repeticiones sustentan la metrica; no derivar ganadores ni formatear null como 0."
sourceRevision: <SHA del commit del corte D>
status: C-PENDING
```

## Resumen para el leader

1. Aprobado el cambio: 7 campos a `number | null`, 2 contadores nuevos, tokens/costo/chunks/herramientas/archivos sin cambio.
2. Reemplazar la viñeta de la línea ~342 y el bloque de la interfaz con el texto de arriba; no tocar la cabecera de versión.
3. `breaking: true` para Console; sin `INTEROP-2.8`.
4. Sin consumidores internos de Core afectados fuera del propio servicio, DTO y spec.
5. Confirmar la interpretación de `executionDurationMs` (punto a confirmar).
