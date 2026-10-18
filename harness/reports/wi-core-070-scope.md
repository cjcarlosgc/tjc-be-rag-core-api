# WI-CORE-070 — refactor de `runAttempt` y pipeline compartido (propuesta de alcance)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Origen: pedido de la sesión cross como «WI-B» (informe `cross-fase3-estabilidad-2026-10-18.md`, sección «No se hizo»).

## Alcance propuesto

1. Descomponer `ExperimentJobHandler.runAttempt` (`app/src/experiments/experiment-job.handler.ts`, ~350 líneas con estado compartido) en pasos con responsabilidad única, sin cambiar el orden de efectos, los errores ni las escrituras en base de datos.
2. Extraer el pipeline común entre `experiment-job.handler.ts` y `app/src/validation/analysis-run-validation-job.handler.ts` (retrieval → contexto → prompt → merge → sandbox) a un servicio o conjunto de funciones compartido que ambos usen.
3. **Fuera de alcance (decisión del leader tras la verificación SDD):** F3 de WI-CORE-069 (`sandboxHttpBoundMs` ignora los reintentos de GET). Sumarlos cambia el valor por defecto de `heartbeatStaleMs` (hasta ~4x) y cuándo se relanza un intento vencido (`attempt-recovery.spec.ts` fija 1_220_000), por lo que no es un refactor sin cambio de comportamiento; requiere WI y decisión propios.
4. Dos cortes: **A** pruebas de caracterización + descomposición de `runAttempt` (sin tocar el handler de validación); **B** extracción del pipeline compartido en `app/src/generation/test-generation-pipeline.ts` y adopción en ambos handlers. Revisión de hunks entre cortes.

5. **Corte C (pedido de cross, pendiente de aprobación del usuario):** los reintentos de GET por transporte al Sandbox (`withTransientRetries`) dejan de ser silenciosos: se registran en log (sin payload ni secretos) y se cuentan con un contador, para que la inestabilidad quede visible (tesis 3.3.8). Es el **único cambio observable** de este WI (logs y contador); no cambia reintentos, tiempos, DTO ni contratos ni repite el trial.

## Reglas

- **Sin cambio de comportamiento**: los tests existentes son la red de seguridad. No se tocan DTO, contratos, migraciones, prompts, versiones de prompt, ranking, pesos ni R-PHP.
- Sin cambios en `spec/contracts/`; `contractImpact=false`, `publishesContract=false`.
- Un solo WI activo; sin push, PR ni merge.

## Criterios de aceptación

- Existe un pipeline compartido usado por ambos handlers y `runAttempt` queda descompuesto; ningún método del handler de experimentos supera ~120 líneas salvo justificación.
- `pnpm lint`, `pnpm build`, `pnpm contracts:check`, `pnpm test` en verde con el mismo conteo de tests o superior; se añaden pruebas de caracterización donde la red de seguridad sea débil.
- El reviewer compara los hunks movidos y confirma que no cambia la lógica ni el orden de efectos; los 4 validadores en verde.
