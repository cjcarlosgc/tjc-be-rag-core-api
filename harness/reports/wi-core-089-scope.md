# WI-CORE-089 (WI-A) — neutralizar el puerto LLMProvider y la prosa contractual antes del baseline arch-v1.0
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** mensaje escrito directamente por el usuario en el chat de Core el 2026-10-24: «Apruebo WI-A y WI-B ahora. WI-A en feature/jean: neutralizar el puerto LLMProvider y la prosa contractual con Contract Sync y versión nueva, adaptador falso reutilizable, suites A3 y A4, enmienda de providers/spec.md. WI-B en una rama aparte feature/esc-mod-01, creada sobre el commit de cierre de WI-A y sin mezclarla en feature/jean: segundo adaptador de Anthropic, LLM_PROVIDER y la key solo en la frontera (app/src/providers, providers.module, config/env). Acepto cl100k como aproximación documentada, tu definición de M1/M2/M3 y que package.json cuente como configuración. La tabla de esfuerzo para Anthropic me la propones antes de implementar. Continúa.» Base: `harness/reports/arch-v1.0-modularidad-llm-provider-core.md` (WI-CORE-088, revisado). Este WI es **WI-A**; **WI-B** (rama `feature/esc-mod-01`) es otro WI posterior.

## Alcance aprobado (WI-A, rama `feature/jean`)

1. **Puerto neutral:** `app/src/providers/llm-provider.interface.ts` pasa `provider: 'openai'` a `string` y `endpoint?: 'responses'` a `string` (incluido `LLMGenerationResult.effective.provider`); el adaptador de OpenAI sigue fijando `'openai'`/`'responses'`. `app/src/experiments/experiment-job.helpers.ts` (`parseEffectiveConfig`) deja de rechazar otro proveedor y de reescribir `'openai'`/`'responses'`; el comportamiento con datos existentes (`provider: 'openai'`) no cambia. `app/src/common/sanitize-failure-message.util.ts` pasa a una redacción genérica de credenciales (sin depender del prefijo `sk-` de OpenAI). Los specs que fijan `provider: 'openai'` se verifican y ajustan solo si hace falta.
2. **Prosa contractual neutral** (cambio de contrato: aprobación dada): `interoperability-contract.md:379`, `system-contract.md:461` y `:472` dejan de nombrar «la API de OpenAI» y `reasoning_effort` como si fueran el contrato; el modelo por defecto y la escala pasan a ser comportamiento del adaptador configurado. Sin cambio de wire, rutas, DTO, enums ni esquemas. Versiones nuevas **INTEROP-2.21** y **SYSTEM-2.16** (documentales, no incompatibles), cabeceras, `spec/README.md`, `CHANGELOG.md` y **Contract Sync** a Integration, Sandbox y Console.
3. **Adaptador falso reutilizable** en la frontera permitida (`app/src/providers/testing/fake-llm.provider.ts`, nombre propuesto) que implementa `LLMProvider`.
4. **Suites:** CT-09-A3 (suite de contrato del puerto parametrizada contra el adaptador OpenAI y el falso) y CT-09-A4 (test de arquitectura: ningún SDK de proveedor fuera de `app/src/providers/**`).
5. **Documentos:** enmienda de `spec/transversal/providers/spec.md` (la línea «no se inventa un segundo proveedor concreto» se sustituye por el escenario controlado de ESC-MOD-01: segundo proveedor solo en rama posterior al baseline y sin mezclarse con corridas de evidencia congeladas) y corrección del drift de `plan.md:35` (`REASONING_EFFORT_UNSUPPORTED` frente a `TEMPERATURE_UNSUPPORTED_WITH_REASONING`); registro en la propuesta CT de la decisión D-14 (aprobaciones de este mensaje y D-10 revisada: falso para A3, real para la evidencia y prueba de humo opcional).

## Decisiones del usuario que este WI registra

Tokenizador `cl100k_base` aceptado como aproximación documentada para otros proveedores; definición de M1/M2/M3 de `arch-v1.0-modularidad-llm-provider-core.md` §3 aceptada (M1 sobre `app/src` y `app/test`; `package.json`/lockfile cuentan como configuración, listados aparte); proveedor alternativo previsto Anthropic (su selector `LLM_PROVIDER`, su key y el mapeo de `LLM_REASONING_EFFORT` son de WI-B).

## Fuera de alcance

Selector `LLM_PROVIDER`, adaptador de Anthropic, variable de key, tabla de esfuerzo (todo WI-B); el tag `arch-v1.0` (lo crea el usuario); push, PR, merge; cambios en Integration, Sandbox o Console (Contract Sync vía cross); `.env` y cualquier key; cambios de wire, esquemas o comportamiento observable de OpenAI.

## Criterios y orden

Lint, tests y build en verde; comportamiento observable de OpenAI sin cambio; M2 sin cambios en `spec/contracts/schemas`; contract-reviewer y reviewer independientes; el cierre de este WI es el commit sobre el que se crea `feature/esc-mod-01`.
