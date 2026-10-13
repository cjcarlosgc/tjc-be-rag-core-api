Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-052 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**Veredicto: APPROVED** (con 2 hallazgos menores no bloqueantes).
Rango: `379e16d^..379e16d` (3 archivos: `snapshot-analysis-job.handler.ts`, `snapshot-analysis-job.handler.spec.ts`, `symbol-behavior-constructs.service.spec.ts`). Independiente del implementer (claude-haiku-5-5). Worktrees desechables eliminados; no se editó código ni specs.

## Evidencia ejecutada

1. **compute() corre para PHP y persiste.** El diff solo quita el condicional `!isPhp` y mapea `behaviorConstructs[index]` para todos los símbolos. TypeScript queda funcionalmente igual (antes ya entraba). Sonda con `PhpParserService` real + `SymbolBehaviorConstructsService` real y fuentes PHP reales (GitHub simulado):
   - método con `if` nuevo → `BOUNDARY` (1); `if (null) throw` → `EXPECTED_RESULT` + `EXCEPTION`; `$this->count = $x` → `STATE_TRANSITION`; `return $x >= 10` sin `if` (base `> 10`) → 0 construcciones (`[]`); función global con `if` → `BOUNDARY`; método nuevo en base → `BOUNDARY`.
   - archivo `added` → sin llamada a GitHub, construcciones contra base vacía (`BOUNDARY`).
   - archivo `renamed` → GitHub recibe `previousFilename` (`src/Old.php`) con `baseSha`; resultado `BOUNDARY`.
   - parse error en HEAD → `[]` (no lanza); símbolo ausente en base → solo cuenta HEAD; clases en `namespace A\B { }` con llaves → `A\B\C.m` correcto, `D\E.m` sin cambio → `[]`.
   - el `qualifiedName` que produce el handler (`Ns\Clase.metodo`, `Ns\funcion`) coincide con lo que espera `extractPhpBehaviorConstructs`, salvo el constructor (hallazgo F1).
2. **Monorepo `projectRoot: 'backend'`**: `filePath` `backend/src/Svc.php` lee el archivo correcto del workspace y GitHub recibe exactamente `backend/src/Svc.php` + `baseSha`. En `projectRoot '.'` (casos de la matriz) la ruta es la del repo. Mismos resultados que en raíz.
3. **Riesgo de regresión**:
   - `readFile` de un símbolo de archivo ausente del workspace no es posible: los símbolos PHP provienen de chunks parseados leyendo ese mismo archivo del workspace; `vendor` está excluido de la descubierta (`indexing.constants.ts`).
   - Archivos PHP de test sí entran en `compute` (método de test con `if` → `BOUNDARY` persistido, más una lectura GitHub); el evaluador los excluye con `isTestSourcePath` (WI-CORE-044 corte 5), que para PHP cubre `tests/` y `*Test.php` sensibles a `projectRoot`. No hay conflicto: la fila persiste, no genera pregunta. Costo: una llamada a GitHub extra por archivo de test cambiado.
   - Fallo de GitHub al leer la base se propaga (`INFRASTRUCTURE_FAILURE`), igual que TypeScript; documentado en OC04.
   - PRs PHP existentes con construcciones nuevas pasan a `ACTION_REQUIRED`: esperado por DEC-FK-003/004 y aprobado en el scope-approval.
4. **Mutantes** (sobre HEAD, vitest handler + servicio), todos detectados:
   - M1 restaurar condicional PHP/no llamar `compute` → 2 pruebas fallan.
   - M2 `baseSha: run.headSha` → 2 pruebas fallan.
   - M3 no mapear `behaviorConstructs` → 2 fallan (PHP y TS).
   - M4 mapear `null` → 2 fallan (PHP y TS).
5. **Alcance**: solo los 3 archivos de `app/src/{functional-knowledge,snapshot-intelligence}` más reportes/estado del harness y OC04 de la feature 013. Sin cambios en experimentos, OE2/OE5, evidencia, métricas, validation/, sandbox/, contratos ni migraciones. Sin cambios de extractor ni evaluador.
6. **Gates** (en worktree desechable de `379e16d`): `npx vitest run` 140 archivos pasan / 6 omitidos, 2204 pruebas pasan / 104 omitidas; `oxlint` exit 0 sin hallazgos; `tsc --noEmit` delta 0 por archivo contra `379e16d^` (24 líneas idénticas por archivo/código); `node harness/validate-harness.mjs` pasa; `node --test harness/*.test.mjs` 31/31. Sin build (según lo pedido).

## Hallazgos

| ID | Severidad | Hallazgo | recommendedNextStep |
|----|-----------|----------|---------------------|
| F1 | LOW (no bloqueante) | El parser PHP nombra el constructor `Clase.constructor` (`php-parser.service.ts`), pero `extractPhpBehaviorConstructs.findSymbol` busca un método llamado `constructor` y no `__construct`; el extractor TS sí maneja `constructor`. Sonda: `__construct` que añade un `if` produce `[]` (0 construcciones), así que un constructor PHP nunca genera `ACTION_REQUIRED`. Falso negativo silencioso, no regresión (antes `null`), y el scope-approval excluye cambiar el extractor. | Registrar como idea/WI aparte (mapear `constructor` → `__construct` en `findSymbol` del extractor PHP, con prueba). No bloquea el cierre de WI-CORE-052. |
| F2 | LOW (documental) | `CHANGELOG.md` no registra WI-CORE-052 aunque OC04 de la spec canónica cambió (AGENTS.md: un cambio funcional aprobado se registra en CHANGELOG). `tasks.md` mantiene ST-CORE-059 en `T-IN_PROGRESS` con casilla sin marcar. | El leader agrega la entrada de CHANGELOG y cierra ST-CORE-059 al cerrar el WI. |

Nota informativa (preexistente, no del WI): métodos PHP grandes se parten en varios chunks con el mismo `qualifiedName`, por lo que generarían símbolos duplicados con construcciones repetidas; igual que TypeScript, sin restricción única en `analysis_symbols`.

## Resumen del contrato de salida

- status: APPROVED
- blockers: ninguno
- decisiones abiertas / DECISION_REQUIRED: ninguna (`POTENTIALLY_IMPACTED` PHP sigue fuera de alcance y sin aprobar)
- filesAffected: los 3 de `app/src` del rango; reportes y estado del harness
- recommendedNextStep: el leader atiende F2 (CHANGELOG/tasks) al cerrar; F1 como idea/WI posterior; el cierre `W-DONE` queda a cargo del leader (sin push).
