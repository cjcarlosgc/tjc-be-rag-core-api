# WI-CORE-075 — revisión independiente (ciclo 1)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto: APPROVED.** Sin hallazgos bloqueantes.

## Verificaciones
1. **Exactitud contra el código:** `DEFAULT_LLM_MODEL = 'gpt-6-luna'` (`app/src/providers/llm-settings.ts`); `LLM_REASONING_EFFORT` obligatorio y dentro de la escala (`env.validation.ts` `validateLlmSettings`, `reasoning-effort.scale.ts`); `modelConfig` se resuelve una vez y se persiste en `ExperimentRun` (`experiments.service.ts` líneas 150-168) y se expone `model`/`reasoningEffort` (`experiment-status.presenter.ts`); el esfuerzo rechazado no impide crear el experimento y las repeticiones quedan `UNKNOWN` (`wi-core-076-closure.md` líneas 7 y 26; DEC-EXP-005 punto 3). Coincide con ambos textos.
2. **Sin afirmaciones inexistentes:** grep de `evidenceEligible|isEvidence|evidenceMark` en `app/src` sin resultados; los textos dicen explícitamente que no hay marca, aviso ni bloqueo ni prometen salvaguardas. Tesis 3.3 y Anexo K solo por referencia. `07b20829` y `924e38ab` presentados como antecedente histórico con `gpt-5.4-nano`/`none`, no comparable y sin sustituir evidencia.
3. **Coherencia:** consistente con la sección «WI-CORE-076» de providers, con `app/.env.example` (low en pruebas, medium en evidencia; esfuerzo congelado por corrida en `modelConfig`) y con DEC-EXP-005 (`spec/contracts/system-contract.md:465`). Sin contradicciones.
4. **Alcance del commit:** `git show --stat HEAD` toca solo dos specs, `tasks.md` de 008, harness y reportes; `git diff 0adff7d..HEAD --stat -- app` vacío; sin cambios en `spec/contracts`.
5. **Redacción:** clara y en español neutro; el operador sabe qué verificar (entorno `medium` antes, `modelConfig.reasoningEffort` del Run después, corrida corta tras cambiar el esfuerzo).

## Validadores (raíz)
sdd-check OK; validate-work-items OK (76 WI); validate-harness OK; validate-completions OK (73). No se corrió pnpm (sin cambios en `app/`).

## Hallazgos menores (no bloqueantes)
- BAJA — `spec/transversal/providers/spec.md` (sección WI-CORE-075, viñeta «Sin salvaguarda automática»): no indica dónde leer `modelConfig` del Run (campo `model.reasoningEffort` de la respuesta de estado del experimento). Mejora opcional de precisión operativa.
- BAJA — `spec/features/008-experimental-comparison/tasks.md` ST-CORE-082: el texto sigue diciendo «WI en cola» con estado T-IN_PROGRESS; se actualizará al cierre.
