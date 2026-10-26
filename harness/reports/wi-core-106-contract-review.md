# WI-CORE-106 — revisión de contrato
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

## Veredicto
**APPROVED** (con una observación baja y una precisión para el evento de Contract Sync).

## Hallazgos
1. **Aditivo y no incompatible (OK).** Sin campos, rutas, DTO, enums, errores ni esquemas nuevos. `experiment-attempt-presenters.ts:109-132` ya persiste la sección cuando `tokenCount > 0` aunque `entries` esté vacío; `context-traces.service.ts:627-650` (`mapDependencyContext`) no exige entradas y tolera trazas anteriores. El máximo de 500 tokens no cambia.
2. **Texto del contrato vs código (OK).** Profundidad 3 (`php-dependency-context.service.ts:51,222`), máximo 12 firmas (`php-dependency-context.ts:100`), el máximo de 12 no activa `truncated` (`php-class-hierarchy.ts:238-241,307-309`), orden de recorte glosario → fábricas → obligaciones → profundidad 2/firmas → entradas (`php-dependency-context.ts:588-635`) coincide con la descripción de `truncated`. El servicio devuelve la sección con solo obligaciones (`.service.ts:142`); `return null` ante error de repositorio (`:287`, `:156`). Sin contradicción con INTEROP-2.14/2.15/2.23, §6.15 (OE2 no usa `dependencyContext`) ni §6.16 (la evidencia no lo incluye). La regla de omisión del objeto ("ni otro contenido de la sección") sigue correcta.
3. **Observación baja (no bloqueante).** El texto de 2.24 fija "solo PHP y solo RAG" por herencia del párrafo 2.23; basta. Dato no verificado por mí: el comportamiento de los tests (los ejecuta el reviewer).
4. **Referencias de versión.** `grep` de «2.23» fuera de reports/CHANGELOG: solo `spec/README.md` (ya actualizado a 2.24, y su frase "hasta su re-espejo de INTEROP-2.23" debería decir 2.24, ver Qué corregir) y `interoperability-contract.md` (historial). `corepack pnpm@12.14.0 contracts:check`: limpio (`generate-contract-types.mjs --check` sin diferencias).
5. **Espejos (lectura).** Console: INTEROP-2.23, byte a byte con HEAD (sha `5de10cb7…`). Integration y Sandbox: INTEROP-2.21. Ningún consumidor (Console `src`, Integration, Sandbox, `app/scripts`) referencia `dependencyContext` ni valida el tope de `tokenCount`.

## Consumidores y acciones
| Consumidor | Estado | Un Core 2.24 lo rompe | Acción |
|---|---|---|---|
| Console | espejo 2.23 | No (sin campo nuevo; `tokenCount` ≤ 500) | Re-espejar a 2.24 (solo doc) y, si aún no lo hizo, atender lo de CS-001/002 (BELOW_RELEVANCE_THRESHOLD) |
| GitHub Integration | espejo 2.21 | No | Re-espejo directo a 2.24 (doc); lint/build/test |
| Sandbox | espejo 2.21 | No | Re-espejo directo a 2.24 (doc); lint/build/test |
Orden de despliegue Core → Integration → Console (Sandbox aparte): sin dependencia, porque el cambio no es de forma.

## Propuesta de Contract Sync (nuevo, p. ej. `CS-CORE-20261026-001`)
- `type: CONTRACT_SYNC`, `source: core`, `sourceWorkItem: WI-CORE-106`, `targets: [console, github-integration, sandbox]`, `scopePaths: [spec/contracts/interoperability-contract.md]`, `breaking: false`, `status: C-PENDING`.
- `changed`: INTEROP-2.24 `interoperability-contract.md` sha256 `b00fc9e11bd7cc1324007db233fe34b5f02b6170505c071c35fae68e0ef93f9c` (**recalcular si el archivo vuelve a cambiar**); SYSTEM-2.16 `system-contract.md` (sin cambio) `d0a492b4484c8883d65e709f76d8c7ff2462b0eb8c832649cf75723b9543ea77`; `github-integration-contract.md` (GH-INTEROP-1.9, sin cambio) `dedf00fa2f0f5be928cfaf1e5a12ff19f96e7579524a0a689757f1077bfc6e4e`; árbol `schemas/` (sin cambio) `8079ab73887e3a74b2dba57fa5ae5c146e47eb21231f9965718a85a3a2619718` (receta: `cd spec/contracts/schemas && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`). Describir 6.7: bloque (c) de métodos abstractos sin implementar (≤12 firmas, profundidad 3, solo PHP y RAG), no expuesto como campo, `entries: []` con `tokenCount > 0`, máximo 500 sin cambio, `truncated` ajustada. **Subsume `CS-CORE-20261025-002` (2.23) y por transitividad `-001` (2.22)**.
- `requiredAction`: re-espejar `interoperability-contract.md` byte a byte (digest arriba) en UN paso directo a 2.24 (Integration y Sandbox desde 2.21; Console desde 2.23); sin cambio de schemas ni `generated/` (`contracts:check` limpio); sin cambio de código en Integration ni Sandbox (lint, build, test); Console además lo pendiente de CS-001 si no está hecho (tolerar/etiquetar `BELOW_RELEVANCE_THRESHOLD`, `RagSidePanel.tsx:103`); `dependencyContext.tokenCount` hasta 500. Cada consumidor registra su evidencia; Core no resuelve eventos ajenos. Marcar `CS-CORE-20261025-002` como subsumido en la entrega.

## Qué corregir (menor, no bloquea)
- `spec/README.md`: «hasta su re-espejo de INTEROP-2.23» → «de INTEROP-2.24».
- El digest del evento debe calcularse al final, con el contrato ya congelado.

## Verificación del delta (ciclo 1)
**Veredicto: APPROVED.**
- Sigue siendo documental y aditivo: solo cambia la prosa de §6.7 (c); sin campos, rutas, DTO ni esquemas (árbol `schemas/` sin cambio, `8079ab73…`). `abstractObligationsUncertain` es interno (`php-dependency-context.ts:62`, `.service.ts:154`) y no se expone en la traza; el encabezado largo vive en el texto del prompt y cuenta dentro del máximo de 500 (el recorte lo retira junto con las firmas, `php-dependency-context.ts:655`).
- El texto coincide con el código: encabezado alterno que declara jerarquía no completa (trait o tipo fuera del índice, `:125`), y `uncertain` solo si quedan obligaciones. La causa «corte por profundidad o número de tipos» y la regla de `private` no cuentan como implementado las ubica `php-class-hierarchy.ts` (revisión del código a cargo del reviewer; aquí no re-ejecuté tests).
- Sin contradicción con 2.14/2.15/2.23 ni spec 004 (entries, omisión del objeto, `truncated` intactos).
- Digest recalculado: `interoperability-contract.md` INTEROP-2.24 = `c03bbf72640c6f05eb6bffe46d67c401ed5de96e590e8f204d13537b176607a0` (sustituye al digest anterior); system `d0a492b4…`, github-integration `dedf00fa…` y schemas `8079ab73…` sin cambio. Evento propuesto confirmado: mismos targets (console, github-integration, sandbox), scopePaths, `breaking: false`, subsume `CS-CORE-20261025-002` y `-001`; recalcular el digest si el contrato cambia otra vez.
