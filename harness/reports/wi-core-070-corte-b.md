# WI-CORE-070 — corte B: pipeline compartido de generación
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido claude-haiku-5-5 · esfuerzo high

Informe del implementer (el leader lo transcribe; el implementer no escribe en `harness/reports/`).

## Qué quedó

Módulo nuevo `app/src/generation/test-generation-pipeline.ts` (208 líneas; funciones puras o inyectadas, sin estado, sin cambios en módulos Nest):
- `acquireGenerationContext(sources, input)`: retrieve → reglas funcionales → deps PHP → `contextBuilder.build`; devuelve `{retrieval, generationContext}`. Las opciones del contexto las inyecta el caller (`{}` en validación, `{maxContextTokens}` en experimentos).
- `buildTestPrompt(promptBuilder, ctx, placement|null)`: el caller normaliza `testNamespace` (validación conserva `?? undefined`).
- `mergeGeneratedTest(merge, {language, generatedContent, existingContent})`: `MERGED{content, artifactType}` o `INVALID_PHP` (PHP sanea y añade `\n`; TS aplica `applyCreate` o `applyMerge`).
- `buildSandboxExecuteRequest(input)`: scope TARGET, artefacto único, `projectRoot` solo en PHP; la clave `executionProfile` se incluye solo si el caller la pasa (experimentos siempre, validación nunca), con el mismo orden de claves.

Adoptado en ambos handlers: validación 809 → 797 líneas (−12); experimentos 1433 → 1415 (−18; 1433 es el estado tras el corte A); módulo nuevo +208.

## Qué NO se unificó (cada handler lo conserva)

Llamada al LLM (config, `withTimeout`), manejo de errores y catch externo, persistencia (`persistProposal`, `recordExecution`), trazas (`updateDetail` en experimentos, `persistTraceEvidence` en validación, mismo orden), `existingContent` y ruta (en experimentos `readFile` ocurre tras generar y antes del chequeo de framework), `maxContextTokens`, namespace null/undefined, `executionProfile`, `requestId`, `promptDigest`, hash y `safeBuildArtifact`, clasificación DEC-VAL-002.

## Pruebas añadidas (11, caracterización sobre el código sin refactorizar)

- Validación (7): orden TS completo; argumentos del contexto (`{}`), del prompt (1 argumento) y del LLM (solo prompt); request TS exacto sin `projectRoot` ni `executionProfile`; test co-ubicado leído tras generar (MODIFIED); orden PHP con prompt `{testNamespace, testPath}`; request PHP exacto con `projectRoot` y sin `executionProfile`; PHP sin `<?php` = HELD tras LLM, sin fusión, sin Sandbox.
- Experimentos (4): RAG con `maxContextTokens`, 1 argumento al prompt, LLM con `(prompt, config)`; PHP con prompt de 2 argumentos y request exacto; PHP con el mismo orden de efectos que TS; test existente leído tras generar (MODIFIED).

## Evidencia (desde `app/`, Node 22.23.3)

| Comando | Resultado |
|---|---|
| specs de los dos handlers | antes 185; con pruebas nuevas sin refactor 196; tras refactor 196 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm contracts:check` | exit 0 |
| `pnpm test` | 155 archivos pasan, 7 omitidos; 2507 tests pasan, 104 omitidos (baseline 2496, +11) |

Mutación de control: cambiar `artifactType` MODIFIED → CREATED y quitar `projectRoot` en PHP en el módulo compartido hizo fallar 7 tests (5 existentes y 2 de caracterización); restaurado y verificado con diff.

## Desvíos y notas

- La rama PHP en experimentos se decide ahora por `context.language` en vez de `phpPlacement`; son equivalentes porque `phpPlacement` solo existe si el lenguaje es PHP.
- `executionProfile` se decide por presencia de clave (`'executionProfile' in input`) para no cambiar el objeto que recibe el cliente del Sandbox.
- No cubierto por pruebas: en experimentos la lectura de `existingContent` antes del chequeo de framework no es observable sin espiar `fs`; el orden se preserva en código.
- En experimentos `acquireGenerationContext` devuelve también `retrieval`, que el brazo RAG no usa.
