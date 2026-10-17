# WI-CORE-016 — Verificación de especificación

## Alcance

Corregir la clasificación del Run cuando Validation no encuentra targets `METHOD`/`FUNCTION` directamente cambiados. El resumen `NO_ADDITIONAL_TESTS_REQUIRED` solo es válido cuando uno o más targets elegibles se omitieron porque ya tenían tests existentes.

## Evidencia del caso observado

- Console muestra el Run actual de `feat(receipts): require receipt number` en `ACTION_REQUIRED`, con una pregunta pendiente para `AuthService.login` y sin intentos de validación.
- GitHub tiene un check reciente del mismo PR/HEAD, del 29 de septiembre, con `action_required` y título `Falta contexto funcional`.
- El historial del mismo SHA conserva un check del 27 de septiembre con `NO_ADDITIONAL_TESTS_REQUIRED`, cero propuestas y cero símbolos cubiertos. GitHub muestra el check reciente como el estado vigente; el anterior es histórico.
- `AnalysisRunValidationJobHandler.classifyRun([])` devuelve `NO_ADDITIONAL_TESTS_REQUIRED`. La prueba existente para cero candidatos codifica ese resultado, aunque `spec/features/013-pr-driven-analysis/spec.md` reserva el estado para targets cubiertos por tests existentes.

## Decisiones y contratos

- La clasificación canónica ya distingue `NO_TEST_RELEVANT_CHANGES` de `NO_ADDITIONAL_TESTS_REQUIRED`; este corte implementa esa distinción y no añade estados ni cambia DTOs.
- `DEC-VAL-001` no bloquea: este WI corrige código local y no procesa ni publica evidencia empresarial.
- No hay impacto contractual, migración de base de datos ni cambio de Sandbox o GitHub Integration.
- El pedido explícito del usuario de revisar los detalles y solucionarlo autoriza este corte acotado.

## Validación de selección

- `node scripts/sdd-check.mjs`: pasó.
- `node harness/validate-harness.mjs`: pasó.
- `node harness/validate-work-items.mjs`: pasó.
- Contract Sync `start`: sin eventos relevantes pendientes.

## Implementación y evidencia

- `classifyRun([])` ahora devuelve `NO_TEST_RELEVANT_CHANGES`; el estado `NO_ADDITIONAL_TESTS_REQUIRED` queda reservado para uno o más targets que se omitieron por tests existentes.
- El resumen del caso vacío declara explícitamente que no hubo candidatos `METHOD`/`FUNCTION` y que la cobertura existente no se evaluó.
- La regresión del conjunto vacío comprueba también `functionalBehaviorValidated: false`. La prueba existente del target cubierto conserva `NO_ADDITIONAL_TESTS_REQUIRED`.
- `pnpm exec vitest run src/validation/analysis-run-validation-job.handler.spec.ts`: 16/16 pruebas.
- `pnpm run lint`: pasó.
- `pnpm test`: 1.159 aprobadas, 36 omitidas; 103 archivos aprobados y 1 omitido.
- `pnpm run build`: pasó.
- `node harness/validate-harness.mjs`, `node harness/validate-work-items.mjs`, `node scripts/sdd-check.mjs` y `git diff --check`: pasaron.
- Contract Sync `implementation-delivery`: cero eventos relevantes pendientes; los dos eventos históricos se clasificaron `NOT_RELEVANT` para este WI en `wi-core-016-contract-sync-scope-review.md`.
- Contract Sync `before-review`: cero eventos relevantes pendientes; el checkpoint está registrado en `wi-core-016-contract-sync-checkpoints.md`.
- No se modificó el check histórico ni se llamó a servicios desplegados. La corrección solo afecta Runs futuros.
