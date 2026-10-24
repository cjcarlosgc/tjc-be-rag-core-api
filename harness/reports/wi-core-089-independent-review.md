# WI-CORE-089 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto: CHANGES_REQUESTED** (1 hallazgo medio y 2 bajos; el resto del alcance está conforme). Revisado sobre el árbol sin commit, HEAD `a23e0ef`, rama `feature/jean`. No se leyó ningún `.env` ni se modificó el repositorio (las mutaciones se hicieron en una copia en el directorio temporal de la sesión).

## Hallazgos

### R-1 (media) — Revertir la regla `key-` de la redacción de credenciales
Ubicación: `app/src/common/sanitize-failure-message.util.ts` (`KEY_PREFIXED_KEY`, `redactKeyPrefixedToken`, el `return redacted.replace(KEY_PREFIXED_KEY, …)` de `redactSecretsInText`) y las dos pruebas nuevas de `sanitize-failure-message.util.spec.ts` (`key-` y la de `sk-ant-` puede quedarse).
Por qué: el alcance pedía una redacción genérica sin depender del prefijo de OpenAI; `sk-[\w-]{8,}` ya cubría `sk-ant-…` (la prueba `sk-ant-` pasa sin cambios de código). La regla `key-` es un cambio de comportamiento nuevo, no pedido, que afecta además a la salida del Sandbox persistida (`repetition-artifact.ts:139`). Evidencia (ejecutado en copia con `sanitizeFailureMessage` y `redactSecretsInText`, mismos resultados):
- Falsos positivos: `api-key-12345abcd rejected` → `api-[REDACTED] rejected`; `foreign-key-fk2024ab` → `foreign-[REDACTED]`; `primary-key-v2-schema9` → `primary-[REDACTED]`; `route key-9f3a-lookup-table` → `route [REDACTED]` (el `\b` casa tras un guion).
- Falsos negativos: `key-abcdefghijklmnop` y `key-123456789012` no se redactan.
- La cabecera del archivo declara lista cerrada y exige por cada familia nueva pruebas de regresión, idempotencia y rendimiento; la familia nueva no las trae.
Debe decir: `const SK_PREFIXED_KEY` (o conservar el nombre `OPENAI_STYLE_KEY`) con un comentario de que cubre también `sk-ant-` por prefijo; sin `KEY_PREFIXED_KEY` ni `redactKeyPrefixedToken`; `redactSecretsInText` vuelve a su forma original. Mantener la prueba de `sk-ant-` y quitar la de `key-`. Actualizar la nota del `CHANGELOG.md` (entrada WI-CORE-089, punto (1): «añade la familia `key-`») y `harness/reports/wi-core-089-technical-checks.md` decisión 3.

### R-2 (baja) — La suite de contrato A3 no verifica la configuración efectiva en `generateWithTools`
Ubicación: `app/src/providers/llm-provider.contract.spec.ts`, bloque «configuración efectiva» (solo usa `generate`).
Evidencia: mutación en la copia de `openai-llm.provider.ts` que fija `model: 'gpt-x'` en `generateWithTools` → la suite sigue pasando (32/32). Igual al quitar `...reasoningParams(config.reasoningEffort)` de `generateWithTools`. El puerto declara «nunca fuerza `none` ni cambia modelo o esfuerzo: usa exactamente `config`».
Debe decir: una prueba más en el `describe` «configuración efectiva» que llame a `generateWithTools` con `model: 'modelo-contrato'`, `reasoningEffort: 'high'` y compruebe `under.sent()[0]` con `toMatchObject({ model, reasoningEffort })`. Opcionalmente, aserción de `maxOutputTokens` (hoy se pasa 256 y no se comprueba).

### R-3 (baja) — `providers/spec.md` omite `package.json`/lockfile como configuración
Ubicación: `spec/transversal/providers/spec.md` (párrafo ESC-MOD-01, «con cambios confinados a `app/src/providers/`, `providers.module` y la configuración de entorno»).
Por qué: el usuario aprobó que `package.json` y el lockfile cuenten como configuración (listados aparte); un segundo adaptador necesita añadir el SDK a `package.json`, así que el texto tal cual haría M1 ambiguo.
Debe decir: «…y la configuración (variables de entorno, `package.json` y lockfile, listados aparte)».

### Observaciones sin acción requerida
- El falso se compila en `nest build` (`dist/providers/testing/*.js`, solo `fake-llm.provider` y `provider-boundary.scan`; los `.spec.ts` están excluidos por `tsconfig.build.json`). No importa SDK, no está en `ProvidersModule` ni lo importa código de producción: riesgo de ejecución nulo; coste, código muerto en `dist`. Aceptable.
- La prueba de «ausencia de credenciales» solo tiene dientes si el adaptador mismo inyecta la clave (el mensaje simulado no la contiene); aun así detecta esa fuga (mutación M7 abajo) y es la forma realista para este adaptador.
- `parseEffectiveConfig` ahora conserva cualquier `endpoint` de texto (antes solo `'responses'`); con datos de OpenAI el resultado es idéntico. Es el cambio pedido.

## Verificación por punto

1. **Alcance:** `git status` solo lista: `CHANGELOG.md`, `app/src/common/sanitize-failure-message.util(.spec).ts`, `app/src/experiments/experiment-job.helpers.ts` (+ spec nuevo), `app/src/providers/llm-provider.interface.ts`, suites y `testing/` nuevos, `harness/reports/*`, `harness/state.json`, `harness/work-items.json` (registro del leader; `wi-core-089-technical-checks.md` y la propia sesión indican que el implementer no los tocó), `spec/README.md`, `spec/contracts/{interoperability,system}-contract.md`, `spec/transversal/providers/{plan,spec}.md`. `git diff HEAD --name-only` sin coincidencias en `package.json`/lockfile/`schemas`/`app/src/contracts`/`.env`/`referencias`; `providers.module.ts`, `openai-llm.provider.ts`, `openai-embedding.provider.ts` sin diff; sin `harness/contract-sync/**`; sin adaptador Anthropic, `LLM_PROVIDER` ni variable de key (grep del diff).
2. **OpenAI sin cambio:** `llm-provider.interface.ts:8-35` solo cambia tipos a `string` y comentarios; `experiment-job.helpers.ts:84-113`: con `provider:'openai'`, `endpoint:'responses'` o ausente devuelve lo mismo (`experiment-job.helpers.spec.ts:17,21,26` con `toStrictEqual`); rechazos intactos (no objeto, proveedor no string o vacío, `model`/`modelVersion` no string); `openai-*` sin diff.
3. **Pruebas — mutaciones en copia fuera del repo** (suite A3 + A4: 32 tests; base 32/32):
   | Mutación | Resultado |
   |---|---|
   | M1 falso: tokens de entrada tomados de `outputTokens` | FALLA (contenido y tokens, falso) |
   | M2 falso: 429 no externo | FALLA |
   | M4 OpenAI: 429 no externo | FALLA |
   | M5 OpenAI: `input_tokens ?? 0` en vez de `null` | FALLA |
   | M6 OpenAI: sin chequeo de temperatura con razonamiento | FALLA (2 tests) |
   | M7 OpenAI: la clave se añade al detalle del error | FALLA (credenciales) |
   | M8 falso: `generateWithTools` no registra mensajes | FALLA (bucle de herramientas) |
   | M13 OpenAI: `effective.reasoningEffort` nulo en `generate` | FALLA |
   | M14 OpenAI: `resolveEffectiveConfig` con modelo distinto | FALLA |
   | M3 OpenAI: modelo fijo en `generateWithTools` | **PASA** (ver R-2) |
   | M12 OpenAI: `generateWithTools` sin `reasoning` | **PASA** (ver R-2) |
   A4: `import … from 'openai'` en `src/domainx/`, `require('@anthropic-ai/sdk')` en `test/` e import multilínea de `openai` → los tres FALLAN el escaneo real; el segundo test de A4 además cubre en árbol temporal `import()`, `export * from`, subruta, `require` y el nombre parecido `openai-helpers` (no marcado) y `vi.mock` (no cuenta, por diseño). El falso implementa `generate`, `generateWithTools` y `resolveEffectiveConfig` (el build compila `implements LLMProvider`) y queda fuera de `ProvidersModule`.
4. **`sanitize-failure-message`:** ver R-1 (revertir `key-`; conservar `sk-`).
5. **Documentos:** `spec.md` fiel salvo R-3 (segundo proveedor solo tras `arch-v1.0`, confinado, sin mezclar con corridas congeladas, falso como doble de A3); `plan.md:35` coincide con `llm-configuration.error.ts` (`TEMPERATURE_UNSUPPORTED_WITH_REASONING | MODEL_UNAVAILABLE`, campo `temperature`); `spec/README.md` y `CHANGELOG.md` coherentes (INTEROP-2.21 / SYSTEM-2.16; espejos desfasados declarados; salvo la mención de `key-` de R-1); contratos: prosa neutral sin cambio de rutas/DTO/enums/esquemas. Propuesta CT: D-14 recoge WI-A y WI-B, cl100k, M1/M2/M3 (M1 sobre `app/src` y `app/test`), `package.json`/lockfile como configuración, proveedor Anthropic en `feature/esc-mod-01`, tabla de esfuerzo propuesta antes de implementar, y D-10 revisada (D-10 marcada «Revisada por D-14»). Recuento propio de la tabla: columnas Cubiertas 2+1+2+2+4+2+3+3+4+0 = 23; Parciales 3+2+1+1+0+2+1+0+0+4 = 14; Sin cobertura 0+1+3+2+2+1+1+3+1+1 = 15; filas por CT suman 5+4+6+5+6+5+5+6+5+5 = 52; 23+14+15 = 52; 52 filas `CT-xx-Ax` en el documento. CT-09 4/0/1 coincide con A1–A4 cubiertas y A5 pendiente. «Cubiertas» de A3/A4 está justificado por las suites nuevas (pasan en `npm test`); A3 declara el falso y el adaptador real con cliente simulado, y A4 escanea `src/` y `test/` reales. Nota: D-14 dice `pnpm test`; el `packageManager` es pnpm y los scripts se ejecutan con npm (sin impacto).
6. **Gates (desde `app/`, Node 22):** `npm run lint` exit 0 sin diagnósticos; `npm run build` exit 0; `npm run contracts:check` exit 0; `npm test`: **161 archivos pasan, 7 omitidos; 2781 tests pasan, 104 omitidos** (coincide con lo esperado; las trazas de WARN/stack en la salida son de specs ajenos y no son fallos). Raíz: `node scripts/sdd-check.mjs` → `SDD check OK`; `node harness/validate-work-items.mjs` → `passed (CORE, 89 WI)`; `node harness/validate-harness.mjs` → `Harness V3 validation passed`; `node harness/validate-completions.mjs` → `passed (86 completed WI)`.

## Para el segundo ciclo
Tras R-1, R-2 y R-3: volver a correr lint, build, contracts:check, npm test (el conteo esperado cambia: −1 prueba de `key-` en sanitize, +1 de R-2 por adaptador = 2781 − 1 + 2 = 2782 pasan, si no se agregan más) y los cuatro validadores; no hace falta más revisión de documentos fuera de lo tocado.

## Ciclo 2 de 2

**Veredicto: APPROVED.** R-1, R-2 y R-3 resueltos; sin errores nuevos; alcance acotado. Revisado sobre el árbol sin commit.

- **R-1:** `git diff` de `sanitize-failure-message.util.ts` es solo el renombrado `OPENAI_STYLE_KEY` → `SK_PREFIXED_KEY` (regex `\bsk-[\w-]{8,}` idéntica), su comentario y su uso en `REDACTION_RULES`; `redactSecretsInText` sin cambios. El spec conserva la prueba existente de `sk-` y añade la de `sk-ant-api03-…`. Sin menciones de la regla `key-` (`KEY_PREFIXED_KEY`, `redactKeyPrefixedToken`, «familia `key-`») en `app/src`, `spec/`, `CHANGELOG.md` ni `wi-core-089-technical-checks.md` (grep).
- **R-2:** nueva prueba «generateWithTools envía exactamente la configuración pedida…» (`llm-provider.contract.spec.ts:302`, por adaptador; asserta `model`, `reasoningEffort` y `maxOutputTokens`). Mutaciones en copia fuera del repo: modelo fijo `'gpt-x'` en `generateWithTools` del adaptador OpenAI → FALLA (1 test); `reasoningParams` omitido → FALLA (1 test); base 32/32.
- **R-3:** `providers/spec.md` dice «…y la configuración (variables de entorno, `package.json` y lockfile, listados aparte)».
- **Alcance:** `git status` sin archivos nuevos respecto al ciclo 1 (solo cambia el informe de revisión); sin diff en `package.json`, lockfile, esquemas, contratos de `app/src/contracts`, `providers.module.ts` ni `openai-*`.
- **Gates (`app/`, Node 22):** lint exit 0; build exit 0; contracts:check exit 0; `npm test`: 161 archivos pasan, 7 omitidos; **2782 pasan, 104 omitidos** (esperado). Raíz: `SDD check OK`; work items passed (CORE, 89 WI); `Harness V3 validation passed`; completions passed (86 WI).
