# 008 — Subtareas vigentes

- [x] **ST-CORE-007 · T-DONE · WI-CORE-007 · HU12, HU17:** persistir el detalle diagnóstico de `SandboxFailureFact` como JSONB nulo `failure` en `ExperimentRepetition` (solo experimentos; `TargetRunResult` intacto), con migración aditiva sin backfill, mensaje saneado de secretos y sin cambio de contrato (`ExperimentRepetitionResponse` no cambia; lo expone solo la evidencia de `WI-CORE-027`); probar lecturas sin exponer secretos. Detalle verificado en `plan.md`.
- [x] **ST-CORE-031 · T-DONE · WI-CORE-024 · HU17:** exploración del agente generalista con `list_files`, `read_file`, `search_text` e `inspect_symbol`, pruebas existentes visibles (`DEC-EXP-003`), tope de tool calls y presupuesto de contexto persistidos; sin shell, runners, escritura ni red. Detalle verificado en `plan.md` («Detalle técnico verificado (WI-CORE-024)»).
- [x] **ST-CORE-032 · T-DONE · WI-CORE-025 · HU17:** pareado OE5 con `pairId`, `pairPosition`, `attempt`, `randomizationSeed`, presupuesto y configuración de modelo comunes (la persistencia de `modelConfig` vive en `WI-CORE-023`; aquí solo se consume), política de reintentos y `technicallyEvaluable`, según INTEROP-2.7 §6.5.1; sin ganador automático. Detalle verificado en `plan.md` («Detalle técnico verificado (WI-CORE-025)»).
- [x] **ST-CORE-036 · T-DONE · WI-CORE-029 · HU17:** OE5 con PHP/PHPUnit; diferida hasta cerrar `WI-CORE-013`, `WI-CORE-025` y `WI-CORE-028`.

No se modifica almacenamiento persistido antes de inventario y revisión contractual.
