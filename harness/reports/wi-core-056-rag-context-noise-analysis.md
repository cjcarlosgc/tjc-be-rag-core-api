# WI-CORE-056 — Análisis: reducir el ruido del contexto RAG
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Alcance:** solo análisis y simulación offline; no cambia código, ranking ni contexto RAG. **Datos:** `SELECT` de solo lectura (transacción `read-only`) sobre `experiment_runs`, `experiment_repetitions`, `context_traces`, `functional_knowledge` y `code_chunks` de los experimentos `89a16229…` (exp. 1, `OrderLine.hasStock`) y `800689b9…` (exp. 2, `Voucher.redeem`); sin LLM, sin escritura; la credencial se leyó de `app/.env` en el proceso y no se versiona.

## 1. Qué recibe hoy el brazo RAG
Configuración persistida en cada traza: `topK = 10`, `minimumScore = 0`, `semanticWeight = 0.7`, `structuralWeight = 0.3`, `maxContextTokens = 8000` (el `ContextBuilder` lo aplica tras el `topK` como `TOKEN_BUDGET`, pero no es vinculante en estas corridas: el contexto real es 569 y 756 tokens; hoy el corte efectivo es el `topK`). El corte es siempre por `topK`; los candidatos sobrantes quedan `DISCARDED/TOP_K_LIMIT`. El target (con sus tokens) y las reglas funcionales se entregan aparte. Las tres repeticiones de cada experimento comparten el mismo contexto (determinista): no son evidencia independiente del ruido.

| Experimento | Target | Recuperados | Seleccionados | Tokens de contexto | Reglas |
|---|---|---|---|---|---|
| exp. 1 `89a16229` | `OrderLine::hasStock` (17 tok) | 23 | 10 | 739 de candidatos (+17 target) | 0 |
| exp. 2 `800689b9` | `Voucher::redeem` (36 tok) | 20 | 10 | 348 de candidatos (+36 target) | 2 (BOUNDARY y EXCEPTION; ~185 tokens que explican 569 frente a 384 de target y candidatos) |

## 2. Diagnóstico del ruido (cifras recalculadas sobre las trazas)
- **Exp. 1:** 8 de 10 chunks seleccionados (80 % de chunks, 54 % de tokens) son pruebas de la clase `OrderLine` (`OrderLineTest`, `OrderLineIsSingleTest`), ninguna menciona `hasStock`; el proyecto no tiene ninguna prueba ni referencia a `hasStock` (`code_chunks`: solo el método y su clase). Entraron por `structuralMatch = IMPORTED_BY`: la relación es de clase, así que toda prueba que importa `OrderLine` recibe el bono estructural de 0.3 y gana a los vecinos semánticos. Los 2 restantes son la clase declarante (326 tok) y `isEmpty`.
- **Exp. 2:** 9 de 10 seleccionados (296 de 348 tokens, 85 %) son símbolos vecinos de otras clases (`TaxPolicy`, `DiscountCalculator`, `Promotion`, `OrderLine`…) que no son llamados por `redeem` ni aparecen en su fragmento; solo la clase `Voucher` es relevante. Entran solo por similitud semántica (0.50–0.71) sin señal estructural (el 0.77 corresponde a la clase `Voucher`). La prueba existente más cercana quedó fuera por `TOP_K_LIMIT`.
- Nota sobre las cifras citadas («70 % de tests ajenos» y «9/10 vecinos»): con este criterio resultan 80 % de chunks / 54 % de tokens en el exp. 1 y 9/10 chunks en el exp. 2; la diferencia viene de si el chunk de clase de pruebas y la clase declarante se cuentan en tokens o en chunks.
- **Lo que el ruido NO explica:** en el exp. 2 las tres repeticiones RAG terminaron `TEST_ASSERTION` porque las reglas ACTIVE exigen lanzar `InvalidArgumentException` cuando el monto excede el saldo y el código devuelve `0.0` (defecto real, receta de `Voucher.redeem`); el agente generalista, sin reglas, obtuvo pruebas «válidas» (`valid = true`) que describen el comportamiento actual. Es decir, RAG se comportó como debía y `validRate` no mide calidad (motivo de `technicallyValidRate`, `WI-CORE-054`). En el exp. 1 (`hasStock` devuelve `quantity === 0`, posible defecto) RAG fue 2/3 válido y el agente 2/3.

## 3. Propuesta (no aplicada): contexto anclado al target con presupuesto en tokens
En lugar de `topK` fijo sobre un puntaje mixto, construir el contexto por capas con presupuesto de tokens (`maxContextTokens` ya existe como tope posterior al `topK` y aquí pasaría a ser el criterio principal):
1. **Siempre:** target, reglas funcionales y el chunk de la clase declarante (`DECLARING_CLASS`) y constructor, con prioridad sobre cualquier candidato semántico.
2. **Evidencia explícita del target:** símbolos que el target referencia (identificadores del fragmento o relaciones estructurales) y pruebas que mencionan el símbolo objetivo o lo ejercitan.
3. **Pruebas sin mención del target:** a lo sumo 1 como ejemplo de estilo (la mejor), nunca el chunk de la clase de pruebas completa; evita que `IMPORTED_BY` de clase reemplace a la relevancia del método.
4. **Relleno semántico solo si supera un umbral** (absoluto, p. ej. 0.60, o relativo al mejor puntaje) y hasta el presupuesto; si no hay candidatos que lo superen, el contexto queda corto en lugar de rellenarse hasta 10.
5. Todo configurable y registrado en la traza (motivo de inclusión y descarte), conservando el modo actual como línea base comparable.

## 4. Simulación offline (mismas entradas; sin LLM)
Entradas: los 20 y 23 candidatos que la traza conserva (no el índice completo). Proxy de relevancia (no es verdad funcional): clase declarante, constructor, símbolos citados en el fragmento del target y pruebas que mencionan el método objetivo.

| Política | Exp. 1: chunks / tokens / relevantes | Exp. 2: chunks / tokens / relevantes |
|---|---|---|
| Actual (`topK` 10) | 10 / 739 / 1 (326 tok) | 10 / 348 / 1 (52 tok) |
| P1: presupuesto 700, ≤1 test, umbral 0.60 | 8 / 497 / 2 (375 tok) | 7 / 215 / 2 (62 tok) |
| P2: presupuesto 400, 0 tests, umbral 0.70 | 2 / 375 / 2 (375 tok) | 3 / 85 / 2 (62 tok) |
| P3: presupuesto 1000, ≤2 tests, umbral 0.50 | 11 / 555 / 2 (375 tok) | 11 / 352 / 2 (62 tok) |

Lectura: P1 elimina las 7 pruebas ajenas del exp. 1 y 5 de los 9 vecinos del exp. 2 con 33 % y 38 % menos tokens; P2 deja solo evidencia (2 y 3 chunks) pero depende de que el target quepa en un contexto casi vacío. En el exp. 1 P1 completa con 6 métodos hermanos (`isSingle`, `hasPrice`…), señal semántica no verificable sin LLM: no se pueden afirmar mejoras de calidad.

### Definición exacta de la simulación (reproducible)
- Entradas: `detail.candidates` de la traza RAG de la repetición 1 (todas comparten contexto), con `combinedScore`, `semanticScore`, `structuralMatch`, `tokenCount`, `excerpt`; `detail.target.excerpt`. La tabla excluye los tokens del target y de las reglas; el presupuesto de cada política sí incluye los tokens del target (empieza en `target.tokenCount`).
- Rol: `declaring_class` (mismo archivo y `structuralMatch = DECLARING_CLASS`), `same_file_other` (mismo archivo), `test` (ruta con `tests/` o sufijo `Test.php`), `neighbor` (resto).
- Relevante (proxy): clase declarante; constructor del mismo archivo; símbolo cuyo nombre corto aparece como identificador en el fragmento del target; prueba cuyo fragmento contiene el nombre del método objetivo.
- Selección, en orden de `combinedScore` descendente: (1) entran siempre, si caben en el presupuesto, la clase declarante, los símbolos referidos por el target, el constructor del mismo archivo y las pruebas que mencionan el método objetivo; (2) relleno: como máximo `max_tests` pruebas (la de mejor puntaje, sin el chunk de la clase de pruebas completa; estas pruebas están exentas del umbral) y los demás candidatos no-prueba con `semanticScore ≥ umbral`, mientras quepan en el presupuesto.
- P1: presupuesto 700, `max_tests` 1, umbral 0.60; P2: 400, 0, 0.70; P3: 1000, 2, 0.50. El script no se conserva en el repositorio; el WI de replay propuesto abajo lo formalizaría.

## 5. Riesgos y límites
- **Sin medición de efecto:** la simulación mide composición y tokens, no la calidad ni la validez de las pruebas; requiere una ablación con LLM (OE2/OE5) con la misma semilla.
- **Muestra mínima:** 2 experimentos de juguete, un target cada uno, repeticiones con contexto idéntico; el proxy se ajusta a ellos (riesgo de sobreajuste).
- **Pool limitado:** solo los 20–23 candidatos conservados; el índice completo tiene 46 y 52 chunks (13 de pruebas): el análisis no cubre candidatos nunca recuperados.
- **Valor de estilo de las pruebas:** quitar pruebas de la clase puede perjudicar el estilo y las convenciones PHPUnit que hoy ayudan al modelo (no evaluado).
- **Decisión pendiente que bloquea la parte test-aware:** `DEC-RAG-001` (retrieval test-aware) sigue `PENDING` y define hoy la selección como los 10 primeros por puntaje; aplicar P1 la contradice y exige su resolución antes de cualquier cambio de producto.
- **Comparabilidad experimental:** cambiar ranking/contexto altera la línea base de OE2/OE5, `DEC-RAG-001` (retrieval test-aware) y las métricas comparadas con el agente; exige versionar la configuración (`configuration` ya se persiste) y no mezclar corridas.
- **Cambio mayor en retrieval:** la relación `IMPORTED_BY` y los pesos son de clase; refinarlos al método exige relaciones nuevas (`TEST_OF_TARGET` por mención o llamada) y pruebas por lenguaje (PHP/TypeScript).
- **Determinismo y trazabilidad:** el presupuesto y los umbrales deben registrarse por traza; los vecinos con empates de puntaje requieren orden estable.

## 6. Siguientes pasos que requieren decisión del usuario
1. ¿Autorizar un WI de **replay offline** que reproduzca la selección sobre `code_chunks` completos con las políticas candidatas (sin LLM) y un harness de composición?
2. ¿Autorizar una **ablación con LLM** (RAG actual vs RAG con presupuesto) con la misma semilla sobre varios targets, antes de tocar el ranking?
3. Decisión de producto/tesis: cuánto contexto de pruebas debe recibir RAG por defecto y si el modo actual se conserva como línea base.
