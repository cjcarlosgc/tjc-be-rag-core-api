# WI-CORE-104 — revisión de contrato
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

## Veredicto
**APPROVED** (con dos observaciones LOW de redacción, no bloqueantes). El cambio INTEROP-2.22 → 2.23 es documental, aditivo y no incompatible.

## Hallazgos
1. **INFO — Aditivo y compatible (verificado).** El diff de `spec/contracts` solo cambia versión, bullet de compatibilidad y §6.7 (comentarios de `tokenCount`/`truncated` y la regla `dependencyContext`). No cambian rutas, DTO, enums, errores ni `schemas/`. `schemas/` no contiene `dependencyContext` ni `tokenCount` (grep sin resultados). Core lee sin tope superior: `context-traces.service.ts:627-653` (`mapDependencyContext`) exige `tokenCount` entero >= 0, `unresolvedCount` >= 0, `truncated` boolean y `entries` array; por tanto acepta `entries: []` con `tokenCount > 0` y trazas anteriores (300 o menos) sin cambio.
2. **INFO — Escritura coherente con la lectura.** `experiment-attempt-presenters.ts:109-132` omite el objeto solo si no hay entradas, no resueltos ni `tokenCount > 0`; coincide con la regla del contrato (§6.7, línea 631). El presenter no expone `constructorVisibility`, `factories`, `transitiveEntries` ni el glosario (solo `typeName`, `fqcn`, `origin`, `resolvedBy`, `final`), como dice el contrato.
3. **LOW — Glosario: exclusión incompleta en el texto.** El contrato dice que el glosario son los imports «que no están ya entre las dependencias». El código (`test-generation-pipeline.ts:124-130`) excluye además las dependencias de profundidad 2 y la clase declarante, y descarta FQCN de un segmento y duplicados. Sugerencia de texto: «que no están ya entre las dependencias (directas o de profundidad 2) ni son la clase declarante».
4. **LOW — `truncated` con glosario.** `capPhpDependencySection` (`php-dependency-context.ts:533-580`) pone `truncated = true` también al retirar entradas del glosario o fábricas, y `composePhpDependencySection` hace OR con el `truncated` de la base. El comentario del contrato («recortaron entradas por el máximo de 20 o contenido de la sección por el máximo de 500») lo cubre, pero conviene añadir una frase en la regla de §6.7: «también si se recorta el glosario o las fábricas». No contradice nada; solo precisión.
5. **INFO — Sin contradicciones con otras secciones.** INTEROP-2.14/2.15 y el párrafo de `final` actualizan «300» a «500; 300 hasta 2.22»; no queda otro «300» en el contrato (grep). §6.15 (OE2 SE vs SEM) y §6.16 (evidencia `schemaVersion '1'`) no incluyen `dependencyContext`, y la regla ya lo dice. Solo PHP y solo RAG consistentes con `withPhpFqcnGlossary` (`language !== 'php'` retorna igual) y con el agente generalista sin sección (`prompt-builder.service.ts:112`).
6. **LOW (fuera del contrato) — cifras históricas de 300 en spec/work-items.** `spec/features/004/tasks.md:14` (ST-CORE-073) y `harness/work-items.json:3315,3806,3927` conservan «300» como historia de WI anteriores; el bullet WI-CORE-104 de `spec/features/004/spec.md` y las frases de firmas/profundidad 2 ya dicen 500. No requieren cambio (historia), solo no reescribirlas.
7. **LOW — `spec/README.md` desactualizado en una frase.** Dice que los espejos de Integration, Console y Sandbox «siguen en SYSTEM-2.15 e INTEROP-2.20». Verificado en lectura: los tres espejos están en INTEROP-2.21 (sha256 `7f946d55…`) y Console tiene SYSTEM-2.16; `CS-CORE-20261024-004` está `C-RESOLVED` en los tres inbox. La frase correcta es «siguen en INTEROP-2.21 hasta su re-espejo por Contract Sync». Corregir con la edición del README (documental).

## Evidencia de comandos
- `shasum -a 256 spec/contracts/interoperability-contract.md` → `6a19c4953c3546ea59c391591200dc7b8bfcd579c79416fedad0f076c3628f74`
- `system-contract.md` → `d0a492b4484c8883d65e709f76d8c7ff2462b0eb8c832649cf75723b9543ea77` (sin cambio)
- `github-integration-contract.md` → `dedf00fa2f0f5be928cfaf1e5a12ff19f96e7579524a0a689757f1077bfc6e4e` (sin cambio)
- Árbol `schemas/` (receta indicada) → `8079ab73887e3a74b2dba57fa5ae5c146e47eb21231f9965718a85a3a2619718` (sin cambio)
- `corepack pnpm@12.14.0 contracts:check` (app/, PATH node22) → `node scripts/generate-contract-types.mjs --check`, sin diferencias (salida limpia, sin error).
- Grep de «2.22» fuera de harness/reports y CHANGELOG: solo `app/pnpm-lock.yaml` (ajeno), comentarios históricos de código (`context-traces.service.ts:562,690`, `context-trace.response.ts`) que describen WI-CORE-103 y siguen siendo ciertos, `spec/features/004` y `011` (historia de 103, correcto), `spec/README.md` (ya en 2.23), `harness/state.json`/`work-items.json` y el evento `CS-CORE-20261025-001`. No hay otra referencia vigente a actualizar.

## Consumidores y acciones
Lectura solo de los repos hermanos.
| Componente | Estado hoy | Impacto de Core 2.23 | Acción |
|---|---|---|---|
| Console | espeja INTEROP-2.21 (`7f946d55…`), SYSTEM-2.16; no hay uso de `dependencyContext`/`RagDependency*` en `src` | Ninguno en ejecución: no valida tope 300 ni lo asume; `entries: []` con `tokenCount > 0` no se consume | Re-espejo documental directo a 2.23; además lo ya pedido por CS-001 (etiquetar `BELOW_RELEVANCE_THRESHOLD`: `types.ts`, `ragLabels.ts`, fallback `RagSidePanel.tsx:103`) |
| GitHub Integration | INTEROP-2.21; sin código que use la traza | Ninguno | Re-espejo documental; lint, build, test |
| Sandbox | INTEROP-2.21; sin código que use la traza | Ninguno | Re-espejo documental; lint, build, test |
| Exportes / evidencia §6.16 y `app/scripts` | `dependencyContext` ausente de la evidencia; scripts sin referencias | Ninguno | Ninguna |

Un Core 2.23 desplegado antes del re-espejo no rompe a ningún consumidor que espeje 2.20, 2.21 o 2.22: no hay campos, enums ni rutas nuevos; solo cambia el máximo de un entero y el contenido de un texto interno. Orden de despliegue Core → Integration → Console (Sandbox aparte) sin restricción adicional.

## Propuesta de evento Contract Sync (subsume CS-CORE-20261025-001 y, para INTEROP, CS-CORE-20261024-004)
- `type: CONTRACT_SYNC`; `id: CS-CORE-20261025-002` (o el siguiente que asigne el leader); `source: core`; `sourceWorkItem: WI-CORE-104`
- `targets: [console, github-integration, sandbox]`
- `scopePaths: [spec/contracts/interoperability-contract.md]`
- `breaking: false`
- `changed`: INTEROP-2.23 `interoperability-contract.md` sha256 = **recalcular tras aplicar las correcciones LOW 3, 4 y 7 (el digest actual `6a19c495…` cambia si se edita el contrato; 7 solo toca `spec/README.md`)**; SYSTEM-2.16 `system-contract.md` (sin cambio) `d0a492b4…43ea77`; `github-integration-contract.md` (GH-INTEROP-1.9, sin cambio) `dedf00fa…c6e4e`; árbol `schemas/` con `examples/` (sin cambio) `8079ab73…2619718` (receta indicada); descripción: aditivo, §6.7 eleva `tokenCount` máx. de 300 a 500, texto de la sección con constructor no público y fábricas y glosario FQCN no expuestos como campos, `entries: []` con `tokenCount > 0`; subsume `CS-CORE-20261025-001` (INTEROP-2.22) y `CS-CORE-20261024-004` para INTEROP.
- `requiredAction`: re-espejar `interoperability-contract.md` byte a byte cruzando el digest, en un solo paso directo a INTEROP-2.23; sin cambio de `schemas/` ni `generated/` (`contracts:check` limpio); Integration y Sandbox sin cambio de código (lint, build, test); Console además etiqueta `BELOW_RELEVANCE_THRESHOLD` (de CS-001) y tolera `entries: []` con `tokenCount > 0` (no requiere UI). Marcar `CS-CORE-20261025-001` como superado por este evento (la regla de subsunción del repositorio, con `status` que corresponda en su ciclo).
- `sourceRevision`: el commit de cierre de WI-CORE-104.

## Qué corregir (todo opcional/LOW; ninguno bloquea)
1. Texto del glosario en §6.7 (hallazgo 3) y frase de `truncated` (hallazgo 4).
2. `spec/README.md` (hallazgo 7): «siguen en INTEROP-2.21».
3. Calcular los digests del evento después de esas ediciones; `contracts:check` otra vez.
