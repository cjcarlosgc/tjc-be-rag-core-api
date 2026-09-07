# 005-test-generation — Tareas

- [x] DTO/modes y target resolver (`CreateTestRunDto`, `GapAnalyzer`: TARGET/CLASS_ALL/CLASS_MISSING/PROJECT_MISSING/PROJECT_ALL).
- [x] LLMProvider + PromptBuilder (`LLM_PROVIDER`/`OpenAiLLMProvider`, `PromptBuilder` determinístico sobre `GenerationContext`).
- [x] Orquestador por target (`TestGenerationJobHandler`: resolución → retrieval/context → prompt → generate → CREATE/MERGE → validación Sandbox → registro de resultado, por target, sin abortar el run).
- [x] CREATE/MERGE seguro (`TestFileMergeService`: CREATE usa el contenido generado tal cual; MERGE parsea con ts-morph y agrega imports/statements nuevos al final, preservando el archivo existente intacto — sin editar pruebas ya presentes).
- [x] Estados y continuidad ante fallos por target (PENDING→RESOLVING_TARGETS→PROCESSING_TARGETS→FINALIZING→COMPLETED|PARTIAL|FAILED; un fallo de retrieval/LLM/merge/sandbox en un target no aborta los demás).
- [x] Casos zero-target/PARTIAL/FAILED (`completeAsNoMissingTargets`; PARTIAL cuando hay mezcla de válidos/inválidos; FAILED cuando ningún target obtuvo veredicto).
- [x] Aplicar `DEC-IDEMP-001` en `POST /test-runs`: exigir UUID, persistir key + huella canónica bajo unicidad, devolver el run original en replay equivalente, responder `409` ante conflicto y crear run + job de manera atómica/recuperable.

## Calidad

- [x] Agregar/actualizar pruebas (`gap-analyzer.service.spec.ts`, `prompt-builder.service.spec.ts`, `test-file-merge.service.spec.ts`, `test-generation-job.handler.spec.ts`, `workspace-file-tracker.spec.ts`, `openai-llm.provider.spec.ts`, e2e `test-generation.e2e-spec.ts`).
- [x] Verificar manejo de errores (`INVALID_GENERATION_TARGET`, `UNRESOLVABLE_TARGET`, `LLM_PROVIDER_UNAVAILABLE`, `PROJECT_NOT_READY`, `PROJECT_INDEXING_IN_PROGRESS`, `ANALYSIS_NOT_FINISHED`, `TEST_RUN_NOT_FOUND`, `TEST_RUN_NOT_FINISHED`).
- [x] Verificar observabilidad mínima (logging de fallos de Sandbox/LLM vía Logger existente; hereda correlación del pipeline).
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/` (`005-006-007-generation-pipeline.md`).

## Simplificaciones deliberadas de V1 (documentadas, no son bugs)

- MERGE es "safe append": agrega los statements no-import del contenido generado al final del archivo existente (y los imports nuevos), en vez de intentar fusionar semánticamente dentro de un `describe` existente. Nunca pierde contenido; puede producir un archivo menos prolijo que una fusión "inteligente".
- La convención de ruta para un archivo de test nuevo es co-localizado `<archivo>.spec.ts`; si ese archivo ya existe (aunque el target puntual no tuviera test propio), se hace MERGE sobre él en vez de CREATE — verificado en el e2e.
