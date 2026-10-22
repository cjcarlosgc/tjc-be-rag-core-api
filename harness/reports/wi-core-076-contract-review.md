# WI-CORE-076 — revisión contractual
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

**Estado: APPROVED** (sin bloqueantes; 1 hallazgo menor editorial y 1 nota informativa).

## (a) DEC-EXP-005 y prosa
- `system-contract.md:465-479`: DEC-EXP-005 `Estado: APROBADO (2026-10-21, por el usuario)`, `Blocks: NONE`, enmienda explícita de DEC-EXP-004. `:463` marca en DEC-EXP-004 qué se sustituye (flujo de producto, esfuerzo máximo, 422 por esfuerzo) y qué se conserva. El cuerpo original de DEC-EXP-004 (`:461`) se deja intacto como historia con el aviso de enmienda inmediatamente debajo: no hay contradicción vigente, aceptable.
- Código vs prosa (verificado): esfuerzo único `LLM_REASONING_EFFORT` obligatorio, escala `none…max` (`env.validation.ts:364-379`, `reasoning-effort.scale.ts`), `resolveLlmSettings` único para flujo normal y experimentos (`llm-settings.ts`, `openai-llm.provider.ts:58-66,121-125`); retiradas con aviso sin valores ni bloqueo (`env.validation.ts:351-389`); un 400 por esfuerzo rechazado se lanza en la llamada (`openai-llm.provider.ts createResponse`, `isExternalProviderFailure` no lo trata como externo, sin reintento) y el log incluye modelo y esfuerzo; `experiments.service.ts:336-362` solo traduce a 422 `TEMPERATURE_UNSUPPORTED_WITH_REASONING` (`supportedEfforts:['none']`, `provider:171-188`) y `MODEL_UNAVAILABLE` a 503 `LLM_PROVIDER_UNAVAILABLE`. El 422 por esfuerzo ya no existe. Coincide con DEC-EXP-005 puntos 1-6, INTEROP §6.5.1 (`:379`, `:386`, precedencia PHP `:387`) y SYSTEM `:489`.
- Matiz: la prosa dice que la repetición queda `failureType: UNKNOWN` sin reintento (correcto; `experiment-job.handler.ts:979`). No afirma 503 por repetición, y es lo correcto: el 503 es del modelo no disponible al crear; el aviso al caller de "UNKNOWN con 503" debe leerse como el error de proveedor subyacente en log, no como respuesta HTTP.
- Hallazgo F1 (menor, editorial): `interoperability-contract.md:14`, tras la reescritura queda un `)` de cierre sin apertura: «…WI-CORE-074; en conjunto **aditiva…** …de las respuestas).». Corrección opcional; no afecta a digest semántico pero sí cambia el digest si se corrige antes de publicar (corregir antes del Contract Sync, o publicar con los digests de abajo y dejarlo).

## (b) Sin cambio de wire
- `git diff 5c82853..03b4da4 --stat -- spec/contracts`: solo `interoperability-contract.md` (14) y `system-contract.md` (24); `schemas/`, `examples/` y `github-integration-contract.md` sin tocar. `ExperimentModelConfigResponse.reasoningEffort` sigue `string|null` (`interop:~430`), sin rutas/DTO/enums/ErrorCode nuevos (`REASONING_EFFORT_UNSUPPORTED` se conserva).
- Consumidores: GitHub Integration y Sandbox no usan `REASONING_EFFORT_UNSUPPORTED`/`supportedEfforts` (solo aparece en sus espejos de contrato). Console lo maneja en `app/src/control-plane/errors.ts:44-68`: muestra «El modelo no admite el esfuerzo…» y lista `details.supportedEfforts` si es `string[]` no vacío, tolerando ausente/vacío (probado en `errors.test.ts:128-140`). Con `['none']` mostrará «Esfuerzos admitidos: none.»: funcional, sin ruptura. Nota informativa N1: el texto base de Console habla de «modelo/esfuerzo» y ahora el 422 solo ocurre por temperatura; mejora opcional de mensaje (no requerida). Mocks/demo de Console usan `['low','medium']` (`mockBackend.ts:3532`, `ExperimentPage.test.tsx:360`): solo demo.

## (c) Referencias de versión
- Vigentes correctas: `system-contract.md:3` SYSTEM-2.14, `interoperability-contract.md:3-4` INTEROP-2.19/SYSTEM-2.14, `spec/README.md` SYSTEM-2.14/INTEROP-2.19/GH-INTEROP-1.8. `github-integration-contract.md:3` cita `INTEROP-2.17` §4 (versión que introdujo `ErrorEnvelope.retryable`) y sigue siendo cierto; no cambió. No hay `SYSTEM-2.13`/`INTEROP-2.18` vigentes incorrectos.
- Históricos aceptables (INTEROP-2.18 como versión que introdujo la funcionalidad): `interoperability-contract.md:14,85,111,316,474`; `system-contract.md:491` (SYSTEM-2.13 histórico); `schemas/error-envelope.schema.json:10,11,16` y `realtime-events.schema.json:5` y sus generados `app/src/contracts/generated/*`; comentarios en `app/src/**` (`realtime.gateway.ts:26`, `all-exceptions.filter.ts:22,61`, `experiment-realtime.events.ts:14`, etc.) y specs `spec/features/013…:112,116`, `transversal/errors/*`. Ninguno es incorrecto: citan el contrato donde nació la regla. `system-contract.md:489` dice que los espejos siguen en 2.13 hasta Contract Sync: correcto hasta importar.
- `sandbox-execution.schema.json` no cita 2.13/2.18 (solo 2.8/2.16/2.17).

## (d) Contract Sync a publicar
Un único evento (o tres por destino, como en 2.18) `breaking: false`, `sourceWorkItem: WI-CORE-076`, `targets: [github-integration, console, sandbox]`, `scopePaths: [spec/contracts/system-contract.md, spec/contracts/interoperability-contract.md]`, `sourceRevision` = SHA completo del commit publicado (el commit 03b4da4f8dc9fd2e14304b227f5a25e29883ab41 contiene los contratos; si F1 se corrige o se añade un commit documental, usar el HEAD final y recalcular digests).

Digests actuales (HEAD 03b4da4):
- system-contract.md (SYSTEM-2.14): `f60d6c4b19e2bfbce232894614667e5898197a8677eb80db284d96b9f2b96ce3`
- interoperability-contract.md (INTEROP-2.19): `9a1ff0c11792a013f37dad75216335e6f4ccccfe5a8e5a7dc036b12934d22dec`
- github-integration-contract.md (GH-INTEROP-1.8, sin cambio): `6c553ee856d0c53420a75d2bde5a9eb04cce2e029ffae1bf4194dcbc7a25565a`
- árbol schemas/ con examples/ (sin cambio, igual que 2.18): `a1ba9a199d0035de85b807fa9ae26b9afb09f8af340a22f1cb34096547dc9091`

Espejos: system-contract.md e interoperability-contract.md a los tres (los espejos actuales son b70f9358… / 22b880d1… en los repos que los tienen). github-integration-contract.md: sin cambio (no recopiar; GH/Console ya tienen 6c553ee8…). Schemas: sin cambio, no hace falta recopiarlos.

`changed` común: «SYSTEM-2.14 e INTEROP-2.19, documentales y no incompatibles (WI-CORE-076, DEC-EXP-005 enmienda DEC-EXP-004): configuración única del LLM (LLM_MODEL y LLM_REASONING_EFFORT obligatorio) para flujo normal y experimentos con el mismo modelo; el flujo normal pasa a gpt-6-luna; sin lista de combinaciones: un esfuerzo que la API rechace falla en la llamada y la repetición queda UNKNOWN sin reintento; 422 REASONING_EFFORT_UNSUPPORTED al crear solo por temperatura incompatible con razonamiento activo (details.supportedEfforts=['none']). Sin cambio de rutas, DTO, enums, ErrorCode ni esquemas. Digests: system f60d6c4b…6ce3; interop 9a1ff0c1…2d22dec; GH-INTEROP-1.8 y schemas sin cambio.» (incluir hashes completos).

`requiredAction` (informativo):
- console: «Re-espejar system-contract.md e interoperability-contract.md. Sin cambio de código. Opcional: el 422 REASONING_EFFORT_UNSUPPORTED ahora solo sale por temperatura y trae supportedEfforts ['none']; el manejo actual de errors.ts ya lo tolera.»
- github-integration: «Re-espejar system-contract.md e interoperability-contract.md (espejo byte a byte, solo versión SYSTEM-2.14/INTEROP-2.19). Sin cambio de código ni de GH-INTEROP-1.8.»
- sandbox: «Re-espejar system-contract.md e interoperability-contract.md (homologación documental). Sin cambio de código, esquemas ni Harness local.»

## (e) Comprobaciones
- `npm run contracts:check` (app/): exit 0. Tests de contrato (`vitest run contract`): 4 archivos, 44 pruebas en verde. Árbol de trabajo limpio tras ejecutar.

## Veredicto
APPROVED. Sin cambio de wire; enmienda coherente. F1 opcional.
