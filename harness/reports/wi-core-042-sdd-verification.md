[sdd-analyst::GPT-6 Luna / high] · WI-CORE-042 · Verificación SDD de regresión PHP en el tool cap

Modelo: sdd-analyst · configurado gpt-6-luna · atendido gpt-6-luna · esfuerzo high

**status:** `SPEC_VERIFIED` recomendado.

**findings:**

- `ST-CORE-049` enlaza a `WI-CORE-042` y a HU17. El WI está seleccionado/activo, depende de `WI-CORE-029`, y esa dependencia está `W-DONE`. Su `contractImpact` y `publishesContract` son `false`.
- Es una corrección de conformidad no expansiva con la regla 4 de `WI-CORE-029`, no una nueva capacidad PHP: esa regla ya exige que GENERALIST_AGENT use instrucciones semánticamente equivalentes a TypeScript pero en PHP/PHPUnit 11, con archivo completo, `<?php`, namespace, ruta y reglas sobre el TestCase.
- Hecho comprobado en el código vigente: `ExperimentJobHandler.buildPhpAgentInstructions` ya pide el archivo PHP completo e incluye ruta/namespace. Al alcanzar el tope, `GeneralistAgentService` agrega una instrucción fija que exige TypeScript. Por eso el fallo queda localizado en el mensaje final de cierre y su contenido; no requiere alterar el prompt inicial PHP ni el mecanismo del tope.
- La regresión debe forzar `toolCallCap` para PHP/PHPUnit, comprobar que el historial conserva íntegro el mensaje inicial, que el cierre ya no contradice PHP ni impone TypeScript, que la llamada final no habilita herramientas y que se conserva una respuesta PHP. Debe mantener la regresión TypeScript para prompt/resultado. No cambiar conteo del cap, presupuesto, trayectoria ni configuración efectiva del proveedor.
- No cambia contrato, DTO, persistencia, migraciones, configuración pública, otro repositorio ni infraestructura. No encontré una DEC `PENDING`/`PROPOSED` cuyo `Blocks` alcance este trabajo. `DEC-PHP-ROOT-001` solo bloquea el subcaso de varios `composer.json` de la feature 019, fuera del cambio; las decisiones de generación PHP aplicables están aprobadas.
- El checkpoint Contract Sync `start` ya está registrado en `harness/state.json` a `2026-10-12T03:49:06.883Z`, con cero pendientes relevantes y los históricos CS-20260920-001/CS-20260921-003 reconocidos. Una comprobación actual sin `--record` volvió a dar `relevantPendingSyncIds: []`; no modifica el registro.

**blockers:** ninguno para `SPEC_VERIFIED`. El `activeWorkItem.approved` continúa `false`; el reporte analítico no cambia ese campo ni autoriza por sí mismo iniciar implementación.

**filesAffected:** solo este reporte.

**evidence:** `harness/work-items.json` (`WI-CORE-042`, `dependsOn: WI-CORE-029`, `contractImpact: false`, `publishesContract: false`); `harness/state.json` (WI-CORE-042 activo y Contract Sync `start` registrado); `spec/features/018-php-laravel-support/spec.md` §WI-CORE-029 regla 4; `spec/features/018-php-laravel-support/plan.md` §WI-CORE-042; `spec/features/018-php-laravel-support/tasks.md` ST-CORE-049; `app/src/experiments/experiment-job.handler.ts` (`buildPhpAgentInstructions`); `app/src/generation/agent/generalist-agent.service.ts` (`FINAL_INSTRUCTION` y camino de llamada final sin herramientas); regresiones existentes en `experiment-job.handler.spec.ts` y `generalist-agent.service.spec.ts`; `node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-042` (lectura actual, 2026-10-12T03:50:03.028Z, sin registrar).

**recommendedNextStep:** registrar el gate SDD como pasado. El Leader debe conservar `approved: false` hasta que la aprobación exigida por el flujo esté expresada y registrada; después puede iniciar la corrección acotada y las regresiones PHP-cap/TypeScript sin tocar contratos ni ampliar el alcance.

**executedBy:** `sdd-analyst` · `gpt-6-luna` · `high`.
