Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-047 — revisión contractual previa a editar SYSTEM-2.10

**Veredicto: CHANGES_REQUESTED** (fondo aceptable; 3 ajustes de texto antes de editar). Sin DECISION_REQUIRED: la decisión y la condición del usuario están registradas en `wi-core-047-scope-approval.md`.

## 1. Fidelidad a la decisión aprobada
- OK: precedencia, definición de fallo de plataforma, razón, consecuencias (Check `neutral`, `409 TEST_PUBLICATION_INVALID_RUN_STATUS`, existe en INTEROP §6.12) y la condición del usuario (confinado al análisis de PR, 008/OE2/OE5/métricas, `map-sandbox-result.ts` con no regresión o no se toca, `DECISION_REQUIRED` si afecta métricas) son fieles. La redacción directa descartada solo aparece como «descartada y sin efecto»; correcto, no se reintroduce.
- Ajuste 1: la propuesta añade una definición de «Símbolo elegible» (METHOD/FUNCTION DIRECTLY_CHANGED, excluidos cubiertos y archivos de test) que NO está en la propuesta publicada en `30b9acd` ni en la aprobación. Quitarla (la elegibilidad ya vive en feature 013/SYSTEM) o citarla como remisión («símbolo elegible según 013») sin redefinirla. No introducir normativa nueva bajo una decisión ya aprobada.
- Ajuste 2: «Blocks: NONE» es aceptable, pero debe decir que el WI de código de OC08 hereda la condición; ya lo hace. Mantener.
- Retirar A2/A3 «como no elegidas» con una línea (no borrar la mención de que cambiarían el Check), consistente con el criterio de aceptación.

## 2. SYSTEM-2.10 e INTEROP
- Pasar PROPOSED→APROBADA con precedencia es cambio normativo observable (alcance de la regla de clasificación y de publicabilidad del Run): exige **SYSTEM-2.10**, como 2.9 por DEC-INF-001. Sí.
- INTEROP: **mantener INTEROP-2.9, sin editar.** El enum `AnalysisRunStatus` (§6.10), la regla de publicación (§6.12: Run `SUCCESS`) y el mapeo Check no cambian; §6.10/§6.12 no citan la precedencia ni la clasificación por símbolo. Editarlo cambiaría el espejo byte por byte de Console por una cabecera. «Compatible con: SYSTEM-2.9» queda un paso atrás: aceptable porque 2.10 es no-breaking y aún no implementada; declararlo en la nota de estado de SYSTEM («INTEROP-2.9 es compatible con SYSTEM-2.10; sin cambio de INTEROP»). Si el usuario prefiere cabecera exacta, el costo es INTEROP-2.10 y re-espejo; no lo recomiendo.
- Esto es una desviación respecto de mi nota de 045 («probablemente INTEROP-2.10 si cambia §6.10»): verificado que §6.10 no cambia.

## 3. Exactitud frente al código
- `classifyRun` (handler l.584) hoy: BEHAVIORAL_MISMATCH > TECHNICAL_GENERATION_FAILURE > SUCCESS (hay AVAILABLE) > NO_TEST_RELEVANT_CHANGES (outcomes vacío) > NO_ADDITIONAL_TESTS_REQUIRED. `classifySymbolFailure` envía todo lo que no es `TEST_ASSERTION` a técnico, y un framework no soportado es técnico. `INFRASTRUCTURE_FAILURE` solo lo fija el job (l.203, 226, 342) por binding/versión/materializado/compare/job completo. `mapRunStatusToCheckConclusion`: INFRASTRUCTURE_FAILURE y BASELINE_FAILED → `neutral`; BEHAVIORAL/TECHNICAL → `failure`. El texto «Estado vigente» y las consecuencias coinciden.
- Ajuste 3: la lista de precedencia omite `BASELINE_FAILED` y el `INFRASTRUCTURE_FAILURE` de nivel job. Añadir: «`BASELINE_FAILED` y los `INFRASTRUCTURE_FAILURE` de nivel job (binding, versión, materializado, compare, job completo) terminan el Run antes de la clasificación por símbolo y no entran en esta precedencia». Sin esto un lector infiere que INFRASTRUCTURE por símbolo y por job son lo mismo.
- Precisión: escribir «NO_ADDITIONAL_TESTS_REQUIRED > NO_TEST_RELEVANT_CHANGES» solo si se aclara que son mutuamente excluyentes hoy (outcomes vacío vs. todos cubiertos); la aprobación los agrupa. Preferir «`NO_ADDITIONAL_TESTS_REQUIRED` / `NO_TEST_RELEVANT_CHANGES` (excluyentes)», igual que la aprobación y los criterios del WI.
- Coherencia con «Baseline»: la sub-línea pasa a «rige `DEC-VAL-002` (APROBADA; implementación pendiente)»; correcto, el cuerpo de la lista sigue describiendo lo vigente. Con INTEROP sin cambios no hay contradicción con su tabla de estados.

## 4. Contract Sync
- targets: `console` y `github-integration`. **Sandbox: no.** No cambia su request/response ni su categoría `INFRASTRUCTURE` (ya la emite); el consumidor de la regla es Core. Sandbox conserva SYSTEM-2.2.
- scopePaths: solo `spec/contracts/system-contract.md` (coincide con `syncScopePaths` del WI). No incluir INTEROP.
- breaking: `false`.
- changed: «SYSTEM-2.10: DEC-VAL-002 APROBADA (fallo de plataforma por símbolo y precedencia BEHAVIORAL_MISMATCH > TECHNICAL_GENERATION_FAILURE > INFRASTRUCTURE_FAILURE > SUCCESS > NO_ADDITIONAL_TESTS_REQUIRED/NO_TEST_RELEVANT_CHANGES) con la condición de no afectar experimentos ni métricas; implementación pendiente (hoy una excepción o timeout del Sandbox por símbolo sigue siendo TECHNICAL_GENERATION_FAILURE). Sin cambio de INTEROP-2.9, rutas, campos ni códigos.»
- requiredAction console: «Espejar SYSTEM-2.10 byte por byte. Sin cambio de DTO ni de código: INTEROP-2.9 se mantiene. Cuando Core implemente OC08, un Run con INFRASTRUCTURE_FAILURE conservará propuestas AVAILABLE y no será publicable (409 TEST_PUBLICATION_INVALID_RUN_STATUS); no asumir propuesta publicable por tener AVAILABLE.»
- requiredAction github-integration: «Espejar SYSTEM-2.10 si mantiene copia; sin cambio de código ni de GH-INTEROP: el Check `neutral` por INFRASTRUCTURE_FAILURE ya es el mapeo vigente.»
- `sourceWorkItem: WI-CORE-047`; `sourceRevision`: SHA completo del commit contractual.

## 5. Otras menciones que actualizar en el mismo corte
- `spec/contracts/system-contract.md`: cabecera l.3 y fecha; l.68 `INTEROP-2.8` → `INTEROP-2.9`; **l.71 también cita `INTEROP-2.8` §6.13** → `INTEROP-2.9` (omitida en la propuesta); l.155 «Ver DEC-VAL-002 (PROPOSED)…»; nota histórica al final (junto a `SYSTEM-2.9` l.441) con una entrada `SYSTEM-2.10`.
- `spec/README.md` l.5: «SYSTEM-2.9» → 2.10 y la mención «espejos SYSTEM-2.9 e INTEROP-2.8» solo como historia de WI-CONSOLE-025 (no reescribirla).
- `spec/features/013-pr-driven-analysis/spec.md`: cabecera l.5 (SYSTEM-2.10), l.79 y l.212 («PROPOSED» → APROBADA, implementación pendiente). l.115 es una cita datada de WI-CORE-004: no tocar.
- `spec/features/013-pr-driven-analysis/tasks.md` ST-CORE-054; `CHANGELOG.md` (entrada WI-CORE-047, `breaking: false`).
- No tocar: `github-integration-contract.md` l.9 (`INTEROP-2.8`, contrato ajeno, versión de otro documento; observación no bloqueante), feature 008/019/018 (citas históricas de 2.8).

## Evidencia
Leídos: system-contract DEC-VAL-002 y «Baseline»; INTEROP cabecera/§1/§6.10/§6.12; `analysis-run-validation-job.handler.ts` l.200-345 y 575-600; `app/src/checks/check-conclusion.util.ts`; `work-items.json` WI-CORE-047.

## Confirmación (tras aplicar los ajustes y OC11)

**Veredicto: APPROVED.** Verificado con `git diff -- spec CHANGELOG.md`:
- DEC-VAL-002 APROBADA; precedencia `BEHAVIORAL_MISMATCH` > `TECHNICAL_GENERATION_FAILURE` > `INFRASTRUCTURE_FAILURE` > `SUCCESS` > `NO_ADDITIONAL_TESTS_REQUIRED` / `NO_TEST_RELEVANT_CHANGES` (excluyentes); `BASELINE_FAILED` e `INFRASTRUCTURE_FAILURE` de nivel job fuera de la precedencia; sin definición nueva de «símbolo elegible»; A2/A3 retiradas como no elegidas; condición del usuario presente; «Baseline» remite a DEC-VAL-002 (APROBADA, implementación pendiente); citas SYSTEM l.68 y l.71 a INTEROP-2.10; cabecera SYSTEM-2.10.
- INTEROP-2.10 (aclaratoria, Compatible con SYSTEM-2.10): §6.10 usa el mensaje genérico veraz, no afirma 300 archivos como causa única (enumera permiso, 403, 429, 5xx, red), mantiene el mensaje como objetivo de WI-CORE-046 pendiente y deja «PR excede 300 archivos» diferido a la deuda; §1 coherente. README y feature 013 alineados.
- No bloqueante: ST-CORE-053 en tasks.md aún dice «texto exacto pendiente de aprobación»; actualizar al abrir WI-CORE-046.

### Contract Sync final
- scopePaths: `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`; targets: `console`, `github-integration`; Sandbox no; breaking: false.
- changed: «SYSTEM-2.10: DEC-VAL-002 APROBADA (fallo de plataforma por símbolo y precedencia BEHAVIORAL_MISMATCH > TECHNICAL_GENERATION_FAILURE > INFRASTRUCTURE_FAILURE > SUCCESS > NO_ADDITIONAL_TESTS_REQUIRED/NO_TEST_RELEVANT_CHANGES) con la condición de no afectar experimentos, evidencia ni métricas; implementación pendiente. INTEROP-2.10 (aclaratoria): cabecera alineada y mensaje objetivo de OC11 en §6.10 reemplazado por un resultSummary genérico veraz para compare UNVERIFIABLE (pendiente en WI-CORE-046). Sin cambio de rutas, campos, códigos ni estados.»
- requiredAction console: «Espejar SYSTEM-2.10 e INTEROP-2.10 byte por byte. Sin cambio de DTO. Cuando Core implemente OC08, un Run con INFRASTRUCTURE_FAILURE conservará propuestas AVAILABLE y no será publicable (409 TEST_PUBLICATION_INVALID_RUN_STATUS). Para un compare UNVERIFIABLE, mostrar resultSummary como texto libre; no depender de «300 archivos».»
- requiredAction github-integration: «Espejar SYSTEM-2.10 e INTEROP-2.10 si mantiene copia; sin cambio de código ni de GH-INTEROP: el Check neutral por INFRASTRUCTURE_FAILURE ya es el mapeo vigente y el límite de 300 archivos sigue siendo suyo.»
- sourceWorkItem: WI-CORE-047; sourceRevision: SHA completo del commit contractual.
