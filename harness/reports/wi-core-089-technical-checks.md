# WI-CORE-089 — verificaciones técnicas
Modelo: implementer-high · configurado claude-sonnet-5-5 · atendido claude-haiku-5-5 · esfuerzo high

Fecha: 2026-10-24. Rama `feature/jean`, HEAD base `a23e0ef`. Sin commit ni push. No se leyó ningún `.env`. No se tocaron `harness/state.json`, `harness/work-items.json`, `harness/contract-sync/**`, `tasks.md`, `referencias/`, `AGENTS.md`, tesis ni otros repos. Node: `/Users/cjcarlosgc/.local/node22/bin` en el PATH.

## Comandos y resultados

| Comando (desde) | Resultado |
|---|---|
| `npm run lint` (`app/`) | Sin diagnósticos; exit 0 (`oxlint src/ test/`). |
| `npx vitest run` (`app/`), suite completa | **161 archivos pasan, 7 omitidos; 2782 tests pasan, 104 omitidos.** Línea base: 2735 pasan, 104 omitidos. Delta +47 = 32 (suite de contrato, 2 adaptadores × 16) + 12 (`parseEffectiveConfig`) + 1 (sanitize, regresión `sk-ant-`) + 2 (arquitectura). Frente a la ejecución anterior (2781): −1 prueba de `key-` retirada y +2 de la configuración efectiva de `generateWithTools`. |
| `npm run build` (`app/`, `nest build`) | Compila sin errores. |
| `npm run contracts:check` (`app/`) | Exit 0 (los tipos generados coinciden con `spec/contracts/schemas`). |
| `node scripts/sdd-check.mjs` (raíz) | `SDD check OK`. |
| `npx tsc --noEmit -p tsconfig.json` (`app/`) | Los errores existentes están en specs ajenos (`analysis-runs`, `publications`, `repository-bindings`, etc.; ya existían). Ningún error en los archivos tocados ni en los nuevos. Build de producción limpio. |
| `git diff --name-only HEAD -- spec/contracts/schemas` | Vacío (M2 = 0 cambios en esquemas). |
| `git diff --name-only HEAD -- app/src/contracts` | Vacío. |

Archivos modificados o nuevos (`git status`): ver lista en el informe de cierre. Ningún archivo fuera de la lista permitida.

## Conteos de las suites nuevas

- `app/src/providers/llm-provider.contract.spec.ts` (CT-09-A3): 16 tests por adaptador × 2 adaptadores (`OpenAiLLMProvider` con cliente simulado, `FakeLLMProvider`) = 32. Incluye la configuración efectiva de `generateWithTools` (modelo, esfuerzo y `maxOutputTokens` enviados). Cubre contenido y tokens (incluido `null`), bucle de herramientas, configuración efectiva, `resolveEffectiveConfig` y `MODEL_UNAVAILABLE`, fallos externos (429/500/503, conexión → externo; 400 → no externo), configuración no soportada (sin llamada al proveedor), y ausencia de la clave en errores y logs.
- `app/src/providers/provider-boundary.architecture.spec.ts` (CT-09-A4): 2 tests. El primero escanea `src/` y `test/` reales (0 violaciones). El segundo ejecuta el detector sobre un árbol temporal con importaciones prohibidas (`from`, subrutas, `import()`, `require`, `export … from`) y comprueba que las de `src/providers/` y los nombres parecidos (`openai-helpers`) no se marcan.
- `app/src/experiments/experiment-job.helpers.spec.ts`: 12 tests de `parseEffectiveConfig` (datos existentes idénticos, provider no OpenAI conservado, endpoint textual, rechazos).
- `app/src/common/sanitize-failure-message.util.spec.ts`: +1 test (regresión de `sk-ant-`).

## Decisiones de diseño tomadas

1. **Puerto neutral.** `LLMEffectiveConfig.provider` y `endpoint` pasan a `string`. El adaptador de OpenAI sigue fijando `'openai'` y `'responses'`. Ningún spec existente necesitó cambios (los `provider: 'openai'` siguen siendo válidos como `string`).
2. **`parseEffectiveConfig`.** Acepta cualquier `provider` no vacío y lo conserva sin reescribir. `endpoint` se conserva si es texto; antes solo se conservaba `'responses'`. Con datos de OpenAI el resultado es idéntico (verificado con `toStrictEqual`).
3. **Redacción de credenciales.** No cambia la redacción de `sanitizeFailureMessage`: el patrón `sk-[\w-]{8,}` (ya existente, renombrado a `SK_PREFIXED_KEY`) cubre también `sk-ant-…` por prefijo; el formato real de las claves de Anthropic no está verificado y no se da por supuesto. No se añadió ninguna regla nueva (ni `key-` ni una genérica de cadenas largas, que redactaría identificadores y hashes normales); la regla `key-` de una versión anterior de este WI se retiró tras la revisión independiente (R-1).
4. **Adaptador falso.** `app/src/providers/testing/fake-llm.provider.ts`: determinista, sin SDK ni red, no registrado en `ProvidersModule`. Tokens fijos 10/5 (o `null` si se pide), fallos inyectables (`http`, `connection`, `configuration`) clasificados igual que OpenAI, y `setModelAvailable(false)` para `MODEL_UNAVAILABLE`. Registra las llamadas enviadas en `requests`. Nota: `nest build` compila esta carpeta porque está bajo `src/` (no es un spec).
5. **Suite de contrato.** `describe.each` sobre dos arneses. El de OpenAI reutiliza el patrón de `vi.mock('openai')` del spec existente. La prueba de credenciales comprueba el mensaje, la respuesta HTTP y los logs de `warn`/`error`. El adaptador de OpenAI pasa el mensaje crudo del SDK a `details` (comportamiento existente, no modificado).
6. **Frontera (CT-09-A4).** El detector cuenta `from`, `export … from`, `import '…'`, `import()` y `require()`. **No** cuenta `vi.mock('…')`: no carga el SDK. Por eso `experiments.model-config.spec.ts:12` no necesita excepción (verificado: su import real es `../providers/openai-llm.provider.js`, no el SDK). `package.json` no cambia.
7. **Documentos.** `interoperability-contract.md` pasa a INTEROP-2.21 (compatible con SYSTEM-2.16). `system-contract.md` pasa a SYSTEM-2.16. La prosa de §6.5/§6.5.1 y DEC-EXP-004/005 queda como comportamiento del adaptador configurado (rutas, DTO, enums, códigos y esquemas sin cambio). `spec/README.md` y `CHANGELOG.md` actualizados. `providers/spec.md` sustituye «no se inventa un segundo proveedor» por el escenario controlado de ESC-MOD-01. `plan.md` corrige el código a `TEMPERATURE_UNSUPPORTED_WITH_REASONING`.
8. **Propuesta de aserciones.** D-14 añadida (aprobaciones del usuario; D-10 revisada). CT-09-A3 y CT-09-A4 pasan a cubiertas; CT-09-A5 sigue pendiente (WI-B, adaptador real). Totales: 52 aserciones = 23 cubiertas + 14 parciales + 15 sin cobertura (antes 21 + 14 + 17).

## Pendiente fuera de este WI

- **Espejos desfasados (Contract Sync vía cross).** Integration, Console y Sandbox siguen en SYSTEM-2.15 e INTEROP-2.20 hasta el re-espejo byte a byte. No se tocó `harness/contract-sync/**`.
- **Mutación del detector.** Se comprobó con el árbol temporal del propio test de arquitectura (no en el repositorio).
- **Mutaciones de la suite de contrato (R-2, en copia fuera del repositorio).** Modelo fijo en `generateWithTools` del adaptador de OpenAI: falla 1 de 32. Quitar `reasoningParams` en `generateWithTools`: falla 1 de 32.
- **Pendiente del usuario.** La creación del tag `arch-v1.0` y `feature/esc-mod-01` (WI-B) quedan fuera de este WI.
- No se han ejecutado E2E (`npm run test:e2e`): no los afecta el cambio, pero no se verificaron.

## Re-ejecución del leader (2026-10-24)

Desde `app/` con Node 22: `npm run lint` (exit 0), `npm run build` (exit 0), `npm run contracts:check` (limpio) y `npm test`: 161 archivos pasan y 7 omitidos; 2781 tests pasan y 104 omitidos (2735 previos + 46 nuevos). `git diff --name-only HEAD -- spec/contracts/schemas app/src/contracts` vacío (M2 sin cambios en esquemas). `package.json`, `harness/state.json`, `work-items.json` y `contract-sync` sin tocar por el implementer. Las trazas de error de la salida completa vienen de pruebas de `AllExceptionsFilter` ajenas a este cambio.
