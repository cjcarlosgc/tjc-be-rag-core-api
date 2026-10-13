Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-054 — revisión contractual previa a editar INTEROP

**status:** APPROVED (con ajustes de redacción obligatorios, sin decisión pendiente)

## 1. Definición frente al código actual
- `technicallyValid = compiled === true ∧ executed === true ∧ failureType ∈ {NONE, TEST_ASSERTION}` es coherente con `mapSandboxResult` (`app/src/sandbox/map-sandbox-result.ts`): `NONE` solo se emite con `passed` (compiled y executed `true`, `valid: true`); `TEST_ASSERTION` solo se emite cuando `facts.compiled && facts.executed` y ningún caso fallido es `failureKind: ERROR` (DEC-PHP-GEN-002). La conjunción con compiled/executed es redundante hoy, pero válida como defensa; se conserva.
- Relación: `valid ⇒ technicallyValid`, luego `validRate ≤ technicallyValidRate`, y `technicallyValidRate = validRate + assertionFailureCount / evaluableRepetitions`. `assertionFailureCount` coincide con `failures.TEST_ASSERTION` (mismo conjunto de filas; `failures` ya excluye no evaluables).
- Repeticiones sin invocación al Sandbox (no pueden dar verdadero por error):
  - `CONFIGURATION`: compiled/executed/passed/valid `null` (framework no determinado).
  - Contenido PHP no válido (`sanitizeGeneratedPhp === null`): `compiled: false, executed: false, failureType: COMPILATION`.
  - Excepción del cliente Sandbox / fallo externo: compiled/executed `null`, `failureType: INFRASTRUCTURE`; si hay reintento agotado, el slot es `technicallyEvaluable: false` y no entra.
  - Catch genérico: `INFRASTRUCTURE` o `UNKNOWN`, flags `null`.
  - TIMED_OUT: `failureType: INFRASTRUCTURE`, flags de `facts` o `null`.
  Ninguno produce `NONE`/`TEST_ASSERTION` con compiled y executed `true`. Estas repeticiones cuentan en el denominador y suman 0 al numerador (igual que `validRate`/`executionRate`).
- Observación (no bloqueante, documentar): una fila legacy con `failureType NONE` pero `compiled`/`executed` `null` cuenta como no válida técnica, igual que ya cuenta en `compilationRate`. Es la razón de exigir la conjunción; el implementer debe usar `=== true`, no truthiness de `failureType`.
- DEC-EVID-001: mismo denominador (`technicallyEvaluable !== false`), `null` solo con `evaluableRepetitions = 0`; `0` es cero real. Conforme.
- SYSTEM «Calidad, métricas y evidencia»: ubica compilación/ejecución/aprobación/tipo de fallo como diagnóstico técnico y distingue conceptualmente «técnicamente válido». La nueva tasa es diagnóstico técnico y no deriva CF/CO. Debe quedar explícito en la semántica (ya propuesto).

## 2. Aditividad y retrocompatibilidad
- Solo se agregan dos campos de respuesta; §1 ya obliga a ignorar campos desconocidos; no cambian rutas, requests, códigos ni campos existentes. `breaking: false`.
- Console puede ignorarlos hasta adoptarlos; debe tolerar ausencia de ambos en un Core anterior (tipos opcionales/`undefined` en su cliente).
- §6.16: la exportación de evidencia no contiene tasas agregadas (los `*Rate` solo existen en `StrategyMetricsResponse`); `experimental[]` es por repetición. No se afecta y `schemaVersion` permanece `'1'`. No incluir las nuevas métricas en la evidencia (reabriría `schemaVersion`); derivables de `experimental[]` (compiled/executed/failureType) por el consumidor.
- `assertionFailureCount: number` no nulo: correcto. Es un conteo, `0` sin evaluables (a diferencia de las tasas, un conteo sobre cero filas es 0 real; `failures` queda `{}` sin evaluables pero el contador siempre existe).

## 3. Versionado y Contract Sync
- `INTEROP-2.13`, aditiva, `breaking: false`. Cabecera: `Versión: INTEROP-2.13`, `Compatible con: SYSTEM-2.12` (sin cambio), fecha de corte `2026-10-13`.
- SYSTEM: sin cambio (la jerarquía ya cubre diagnóstico técnico). No agregar línea; evita SYSTEM-2.13 y re-sincronizar Sandbox.
- Contract Sync: `targets: ["console"]` únicamente. `github-integration` no (no consume métricas de experimento). `sandbox` no (no cambia ningún contrato Core→Sandbox).
- `scopePaths` (mirror byte a byte hacia Console): `spec/contracts/interoperability-contract.md`. Coincide con `syncScopePaths` del WI. SYSTEM no entra.
- `changed`: «`StrategyMetricsResponse` (§6.5.1) agrega `technicallyValidRate: number | null` y `assertionFailureCount: number`; aditivo, sin cambio de rutas ni campos existentes».
- `requiredAction`: «Console: sincronizar el espejo byte a byte de INTEROP-2.13; opcionalmente mostrar ambas métricas en la comparación OE5, tolerando ausencia (Core anterior) y `null` como "sin datos" (no `0 %`). No derivar CF/CO ni ganador de estas métricas».
- Documentos a alinear al editar: `spec/README.md` línea base («INTEROP-2.12» → `INTEROP-2.13` en la frase de Core/Console), `CHANGELOG.md` y spec/plan/tasks de la feature 008 si citan `StrategyMetricsResponse`.

## 4. Redacción exacta

**4.1 Cabecera**
```
**Versión:** INTEROP-2.13
**Compatible con:** SYSTEM-2.12
**Fecha de corte:** 2026-10-13
```

**4.2 §1 (anteponer a la nota de 2.12 y cambiar «vigente»)**
`INTEROP-2.13` es la versión documental vigente (`WI-CORE-054`, aditiva): `StrategyMetricsResponse` (§6.5.1) agrega `technicallyValidRate` y `assertionFailureCount`; no cambia rutas, campos existentes, códigos, estados, transporte ni la exportación de evidencia (§6.16, `schemaVersion` `'1'`). `INTEROP-2.12` (`WI-CORE-049`, documental): …  (resto sin cambio; quitar «es la versión documental vigente» de 2.12 y dejar «INTEROP-2.12 (WI-CORE-049, documental): …»).

**4.3 Interfaz (tras `passedRate`)**
```ts
  technicallyValidRate: number | null // INTEROP-2.13: fracción de repeticiones evaluables con compiled === true ∧ executed === true ∧ failureType ∈ {NONE, TEST_ASSERTION}; null si evaluableRepetitions = 0
```
y tras `failures`:
```ts
  assertionFailureCount: number // INTEROP-2.13: repeticiones evaluables con failureType = TEST_ASSERTION; 0 si no hay evaluables; igual a failures.TEST_ASSERTION ?? 0
```

**4.4 Semántica (nueva viñeta tras «Semántica observable de las métricas agregadas»)**
- `technicallyValidRate` y `assertionFailureCount` (`INTEROP-2.13`, `WI-CORE-054`): diagnóstico técnico, no declaran ganador ni derivan CF/CO. Se calculan sobre las repeticiones vigentes con `technicallyEvaluable !== false` (mismo denominador que `validRate`). `technicallyValidRate` es la fracción cuya prueba generada se compiló y se ejecutó y cuyo único fallo posible fue una aserción: `compiled === true`, `executed === true` y `failureType` `NONE` o `TEST_ASSERTION`. Una prueba que compila y se ejecuta pero cuya aserción falla es técnicamente válida aquí aunque `valid`/`passed` sean `false`; por tanto `validRate ≤ technicallyValidRate`. Los errores de ejecución (`TEST_RUNTIME`), compilación, dependencias, configuración, infraestructura y `UNKNOWN`, y las repeticiones en que el Sandbox no se invocó, no cuentan como válidas. Es `null` solo si `evaluableRepetitions = 0` (`DEC-EVID-001`); `0` es cero real sobre al menos una evaluable. `assertionFailureCount` es un conteo, nunca `null`, vale `0` sin evaluables y coincide con `failures.TEST_ASSERTION` (ausente = 0). `validRate`, `passedRate`, `failures` y el resto de métricas no cambian. Los consumidores deben tolerar la ausencia de ambos campos en un Core anterior a `INTEROP-2.13`.

**4.5 Comentarios del DTO (`experiment.response.ts`)**
```ts
  /** INTEROP-2.13: evaluables con compiled ∧ executed ∧ failureType ∈ {NONE, TEST_ASSERTION}; null si evaluableRepetitions = 0. */
  technicallyValidRate: number | null;
  ...
  /** INTEROP-2.13: evaluables con failureType = TEST_ASSERTION; 0 sin evaluables; coincide con failures.TEST_ASSERTION. */
  assertionFailureCount: number;
```
Implementación sugerida (solo guía): `rate(repetitions, r => r.compiled === true && r.executed === true && (r.failureType === 'NONE' || r.failureType === 'TEST_ASSERTION'))` y `repetitions.filter(r => r.failureType === 'TEST_ASSERTION').length`. Pruebas mínimas: `null` sin evaluables; `TEST_ASSERTION` sube la tasa sin tocar `validRate`; `TEST_RUNTIME`/`COMPILATION`/`INFRASTRUCTURE` no; fila legacy `NONE` con compiled `null` no cuenta; no evaluables excluidos.

## blockers
Ninguno.

## filesAffected
`spec/contracts/interoperability-contract.md`, `spec/README.md`, `CHANGELOG.md`, `app/src/experiments/experiments.service.ts`, `app/src/experiments/dto/experiment.response.ts` (y sus pruebas).

## recommendedNextStep
Editar INTEROP-2.13 con el texto de §4, implementar y emitir `CONTRACT_SYNC` a console tras verificar espejo; github-integration y sandbox no.
