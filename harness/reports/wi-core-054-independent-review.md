Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-054 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**status:** APPROVED
**Rango:** contrato `3fc6b22^..3fc6b22`; código `15f03e5^..15f03e5`; registro `0eff6d2`. Sin cambios en `spec/` ni `app/` entre `15f03e5` y `HEAD`.
**Independencia:** implementer `claude-haiku-5-5`, contract-reviewer previo distinto; se revisó el texto final del contrato.

## 1. Cálculo frente a la definición aprobada
- Implementación: `rate(repetitions, r => compiled === true && executed === true && failureType ∈ {NONE, TEST_ASSERTION})` y `assertionFailureCount = repetitions.filter(failureType === 'TEST_ASSERTION').length`, ambos sobre `technicallyEvaluable !== false`. Conforme a la definición.
- Prueba diferencial ejecutada (spec desechable, worktrees `15f03e5^` y `15f03e5`): 2.588 respuestas de `getResults` (2.187 filas individuales = producto de failureType×compiled×executed×valid×passed×technicallyEvaluable{true,false,null}, y 400 tríos más el caso vacío). Quitando los dos campos nuevos, la respuesta es idéntica a la base en 2.588/2.588 (`valid`, `passed`, `failures`, contadores, `repetitions[]`).
- Oráculo independiente sobre las 2.187 filas individuales: 0 discrepancias (TIMED_OUT/INFRASTRUCTURE, CONFIGURATION, flags null legacy, no evaluables, sin Sandbox). `null` solo con `evaluableRepetitions = 0` (0 casos de `null` con evaluables); `assertionFailureCount` = `failures.TEST_ASSERTION ?? 0` en todos los casos y `0` sin evaluables.
- `validRate ≤ technicallyValidRate`: se incumple solo en fixtures sintéticas inconsistentes (valid=true sin compiled/executed). En producción `mapSandboxResult` solo emite `valid: true` con compiled/executed `true` y `NONE`, por lo que la invariante documentada se cumple.

## 2. Contrato y Contract Sync
- Cabecera INTEROP-2.13 / compatible SYSTEM-2.12 / corte 2026-10-13; §1, interfaz (§6.5.1) y viñeta de semántica coinciden con los comentarios del DTO y con el código; aditivo; §6.16 y `schemaVersion '1'` sin cambio; `spec/README.md`, feature 013 y CHANGELOG alineados.
- `CS-CORE-20261013-001`: `targets: [console]`, `scopePaths: [spec/contracts/interoperability-contract.md]`, `breaking: false`, `sourceRevision 15f03e5355b39821fcf98d5e5e45bbdcf8cf47ce` (commit que contiene el contrato final), `status C-PENDING`; `requiredAction` correcta (tolerar ausencia y `null`).

## 3. Mutantes (contra `experiments.service.spec.ts`)
Matados: contar TEST_RUNTIME como válido; no excluir no evaluables; null→0 sin evaluables; `assertionFailureCount` contando NONE; contarlo sobre todas las repeticiones; ignorar compiled/executed (solo failureType); truthiness `!== false`.
Sobrevivientes (ver hallazgos): usar `valid || TEST_ASSERTION` en vez de compiled/executed; eliminar `executed === true`.

## 4. Alcance y seguridad
Solo 3 archivos en `app/` (DTO, servicio, spec); sin persistencia, Prisma, `evidence/`, `sandbox/`, ranking/contexto RAG ni clasificación. Sin secretos en los diffs.

## 5. Gates (ejecutados por el reviewer)
- `vitest run` completo: 140 archivos pasan, 6 omitidos; 2216 pruebas pasan, 104 omitidas.
- `oxlint src/experiments`: exit 0, sin hallazgos.
- `tsc --noEmit` en worktrees desechables `15f03e5^` vs `15f03e5`: 24 firmas de error por archivo idénticas, delta 0.
- `node harness/validate-harness.mjs`: pasa. `node --test harness/*.test.mjs`: 31 pass, 0 fail. Sin build (aprobado). Worktrees propios eliminados.

## Hallazgos
| # | Severidad | Hallazgo | recommendedNextStep |
|---|---|---|---|
| F1 | Baja | Las pruebas no distinguen `compiled/executed === true` de `valid` ni exigen `executed`: dos mutantes sobreviven. Equivalentes en producción hoy (mapper), pero la conjunción defensiva exigida por el contrato queda sin cobertura. | Opcional, en un WI posterior: agregar filas con `compiled: true, executed: false/null` y `failureType TEST_ASSERTION`/`NONE`, y `valid: true` con flags null; no bloquea. |
| F2 | Informativa | `spec/contracts/system-contract.md:68` cita «INTEROP-2.12 §6.13/§6.14» como contrato vigente; es una referencia a un detalle no modificado y SYSTEM no cambia por diseño. | Ninguna ahora; alinear en la siguiente edición de SYSTEM. |

## blockers
Ninguno. No hay decisión `DEC` ni cambio de alcance/contrato no aprobado.

## filesAffected
`app/src/experiments/experiments.service.ts`, `app/src/experiments/dto/experiment.response.ts`, `app/src/experiments/experiments.service.spec.ts`, `spec/contracts/interoperability-contract.md`, `spec/README.md`, `spec/features/013-pr-driven-analysis/spec.md`, `CHANGELOG.md`, `harness/contract-sync/outbox/CS-CORE-20261013-001.yaml`.

## recommendedNextStep
El leader puede cerrar WI-CORE-054 (`W-DONE`, revisión delegada por el Modo fuera de casa) y publicar CS-CORE-20261013-001; no autoriza push ni PR.
