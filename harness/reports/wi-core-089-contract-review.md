# WI-CORE-089 — revisión contractual
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: APPROVED** (con 3 observaciones no bloqueantes, todas para el evento de Contract Sync y su publicación).

## 1. Prosa de los contratos
- `interoperability-contract.md`: cabecera `INTEROP-2.21` / `Compatible con SYSTEM-2.16`; bullet INTEROP-2.21 (:14) antepuesto al de 2.20 (historia conservada). §6.5 (:380) pasa a «`LLM_MODEL` y `LLM_REASONING_EFFORT`, obligatorio y fijado por cada entorno»; los valores y su interpretación quedan como comportamiento del adaptador (OpenAI: default `gpt-6-luna`, API Responses, escala `none…max`). Conserva: mismo modelo/esfuerzo en ambos brazos, registro en evidencia, «no degrada en silencio», fallo explícito y repetición como fallo, persistencia del esfuerzo. Único matiz textual: «si la API lo rechaza» pasa a «si el proveedor lo rechaza» (equivalente).
- `system-contract.md`: cabecera SYSTEM-2.16; DEC-EXP-004 (:461) reformulada sin `reasoning_effort` y sin «esfuerzo máximo» como requisito (ya sustituido por DEC-EXP-005, :463); `422 REASONING_EFFORT_UNSUPPORTED` y la confirmación del modelo se conservan. DEC-EXP-005 (:472) mueve el default `gpt-6-luna` a «con el adaptador de OpenAI»; :473 (obligatoriedad de `LLM_REASONING_EFFORT`), :475 (`422`, `supportedEfforts ['none']`) y :477 sin cambio. Párrafo de compatibilidad (:489) nuevo y consistente.
- No se perdió ningún hecho vigente ni cambió un requisito.
- Menciones residuales (grep `openai|reasoning_effort|gpt-6` en `spec/contracts/*.md`): `system-contract.md:461,472,489,493` e `interoperability-contract.md:14,380,387` (el :387 y el :493 solo citan `REASONING_EFFORT_UNSUPPORTED`/`LLM_REASONING_EFFORT`, nombres de código y variable que son contrato). Las de OpenAI/`gpt-6-luna` están todas calificadas «con el adaptador de OpenAI», o son historia de versiones; legítimas. No hay embeddings ni ejemplos en esos contratos que mencionen OpenAI.
- `breaking:false` confirmado: `git diff HEAD --stat` sobre `spec/contracts/schemas` y `app/src/contracts` vacío (coincide con technical-checks); `github-integration-contract.md` sin diff.

## 2. `provider` / `endpoint`
- En el esquema y tipos generados `ExperimentModelConfigResponse.provider` ya es `string` (`app/src/contracts/generated/contract-schemas.ts:1207`); `endpoint` no está en el esquema ni en `contract-types`. El cambio a `string` del puerto no toca el wire.
- Consumidores leídos: Console solo muestra `model.provider` como texto (`liveMapping.ts:145`, `ExperimentComparison.tsx:64`; sus pruebas usan `'OpenAI'` como dato de prueba). Integration y Sandbox solo tienen el tipo generado espejado. Ninguno valida `provider === 'openai'` ni `endpoint === 'responses'`. Sin ruptura.

## 3. Versiones y documentos
- `spec/README.md`: SYSTEM-2.16 / INTEROP-2.21 / GH-INTEROP-1.9 coherentes; aclara que los espejos siguen en 2.15/2.20 hasta Contract Sync.
- `CHANGELOG.md`: entrada WI-CORE-089 en `[Unreleased]` encima de WI-CORE-079, mismo formato (negrita con fecha, INTEROP/SYSTEM, no incompatibles, espejos desfasados, `schemas/` y GH-INTEROP sin cambio).
- GH-INTEROP-1.9 sin cambio (cabecera `github-integration-contract.md:3` intacta).
- **O-1 (baja):** el cierre de INTEROP-2.21 en README/CHANGELOG no cita digests; deben calcularse al final, tras el último cambio de texto de los contratos.

## 4. Plan de Contract Sync
Un único evento `CS-CORE-20261024-004` (secuencia siguiente tras `-003`; el día no cambia), `source: core`, `sourceWorkItem: WI-CORE-089`, `targets: [console, github-integration, sandbox]`, `scopePaths: [spec/contracts/interoperability-contract.md, spec/contracts/system-contract.md]`, `breaking: false`, `status: C-PENDING`, `sourceRevision` = commit de cierre del WI.
- `changed`: INTEROP-2.21 y SYSTEM-2.16 con su sha256 (calculados sobre el árbol final); declarar `github-integration-contract.md` (GH-INTEROP-1.9, sin cambio) sha256 `dedf00fa2f0f5be928cfaf1e5a12ff19f96e7579524a0a689757f1077bfc6e4e` y el árbol `schemas/` con `examples/` sha256 `8079ab73887e3a74b2dba57fa5…` (valor completo en `-002`; verificar con la receta del evento 2026-10-21-004 que sigue igual).
- `requiredAction`: «re-espejar byte a byte `system-contract.md` e `interoperability-contract.md` desde Core; sin cambio de `spec/contracts/schemas/` ni de `generated/` (no ejecutar `contracts:generate`; `contracts:check` debe seguir en verde); sin cambio de código; Integration y Console siguen espejando también `github-integration-contract.md` (GH-INTEROP-1.9) sin cambio; todos cruzan los digests y ejecutan sus validadores».
- **O-2 (media), ronda previa C-PENDING:** `CS-CORE-20261024-001/002/003` (INTEROP-2.20/SYSTEM-2.15 + esquema CT-01, ese sí requiere `contracts:generate`) y `CS-CORE-20261021-001..004` (el -001 `breaking:true`) siguen `C-PENDING`. Como `-004` cubre los dos contratos y el espejo es byte a byte, ningún consumidor debe re-espejar a 2.20/2.15 y luego a 2.21/2.16: debe hacer UN re-espejo directo a 2.21/2.16 y, en la misma operación, tomar el árbol `schemas/` y `github-integration-contract.md` del evento -001/-002/-003 (que `-004` no re-declara pero que el consumidor aún no tiene). Recomendado: que `-004` indique en `requiredAction` que supera en los dos contratos a `CS-CORE-20261024-001..003` y `CS-CORE-20261021-001..004`, y que los demás archivos (`schemas/`, `github-integration-contract.md`, `generated/`) se sincronizan desde Core según -001..-003. No marcar esos eventos como cerrados desde Core; cada consumidor los cierra con su evidencia.

## 5. Riesgos y condiciones previas a publicar
- **Riesgo bajo:** documental, sin cambio de wire; los consumidores solo ven prosa distinta. El riesgo real es el desfase de espejos y digests mal calculados.
- **O-3 (media):** no reutilizar los digests del evento 2026-10-21-004; los de INTEROP-2.21 y SYSTEM-2.16 son nuevos.
- Antes de publicar: (a) cerrar el WI y commitear contratos, README, CHANGELOG y outbox juntos; (b) calcular sha256 finales y escribir `-004`; (c) validar `node harness/validate-harness.mjs`, `scripts/sdd-check.mjs`, `contracts:check`; (d) revisión independiente del `reviewer` sobre el rango; (e) no hacer push sin orden del usuario.

## Evidencia
`git diff` de `spec/contracts/*.md`, `spec/README.md`, `CHANGELOG.md`; `git diff HEAD --stat` de `schemas/` y `app/src/contracts` (vacío); grep `openai|reasoning_effort|gpt-6` en `spec/contracts/*.md`; lectura de `contract-schemas.ts:1197-1210`; grep de `provider|endpoint|modelConfig|openai|responses` en Console, Integration y Sandbox (solo `liveMapping.ts:145` y `ExperimentComparison.tsx:64` como lectura de texto); lectura de `CS-CORE-20261021-001..004` y `20261024-001..003` (todos `C-PENDING`). No se ejecutaron comandos del Harness; los resultados de `technical-checks.md` son los que reporta el implementer.
