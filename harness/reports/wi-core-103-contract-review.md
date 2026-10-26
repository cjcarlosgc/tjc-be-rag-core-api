# WI-CORE-103 — revisión de contrato
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo bajo

## Veredicto
**APPROVED** (con 3 observaciones menores no bloqueantes, ninguna exige cambiar el contrato).

## Hallazgos
1. **Aditivo y no incompatible: confirmado (info).** Todo lo nuevo es opcional o un valor de enum nuevo. `layer?`, `strategy?`, `relevanceThreshold?`, `declaringClassMaxTokens?`, `targetEvidenceMaxTokens?` (interoperability-contract.md ~L562, L575-581). No cambian rutas ni DTO existentes. Los exportes y la evidencia §6.16 y la comparación OE2 §6.15 no cambian de forma (el contrato lo dice; el recuperador y el ranking no se tocan).
2. **Lectura de trazas anteriores (info, OK).** `context-traces.service.ts:562-582` y `:691-709`: `layer` y los campos de `configuration` solo se exponen si están almacenados; un valor almacenado inválido sigue lanzando `invalidStoredDetail` (`isRagDiscardReason` L82-88, `isRagContextLayer` L90-96, `requireContextStrategy`). El presenter (`experiment-attempt-presenters.ts:148`) emite `layer: candidate.layer`.
3. **Menor — `layer` null vs ausente.** El contrato dice «null si se descartó o con RANKED; ausente en trazas anteriores». Es coherente con el código (el builder escribe `layer: null` en descartados, `context-builder.service.ts:166,228`; la traza antigua no tiene la clave). Pero `layer=null` con `RANKED` en un candidato SELECTED es redundante con `configuration.strategy`. Sugerencia opcional: añadir la frase «un candidato SELECTED con `layer` null/ausente no implica capa». No bloquea.
4. **Menor — nombre `configuration.strategy`.** Convive con `ContextTraceStrategy` (`'RAG'|'GENERALIST_AGENT'`, L486/495) en el mismo documento. No hay colisión de campo (uno es del summary, otro de `configuration`), pero la regla ya aclara «estrategia de contexto»; basta como está.
5. **Menor — ambigüedad de `BELOW_RELEVANCE_THRESHOLD`.** El texto lo define para candidatos «sin `semanticScore` o por debajo del umbral que ninguna capa anterior seleccionó». Un candidato `DECLARING_CLASS` o de evidencia que no cupo en su tope se descarta por `TOKEN_BUDGET` aunque no tenga semántica: coherente con el scope («lo que no cabe… `TOKEN_BUDGET`»). Sin contradicción con §6.15, DEC de trazas, `dependencyContext` (no rankeado, no cuenta en `contextTokens`) ni INTEROP-2.14/2.15.
6. **`contracts:check` limpio.** `corepack pnpm@12.14.0 contracts:check` en `app/`: `node scripts/generate-contract-types.mjs --check` terminó sin diferencias. El árbol `schemas/` y `generated/` no cambian. SYSTEM-2.16 y GH-INTEROP-1.9 intactos.
7. **Referencias a la versión.** Grep de «2.21» fuera de `reports`: solo la línea histórica del propio contrato (L15), `system-contract.md:489` (SYSTEM-2.16 describe WI-089, histórico correcto), títulos de WI-089 en `harness/work-items.json`/`state.json` (históricos) y `outbox/CS-CORE-20261024-004.yaml` (evento propio). Nada debe actualizarse. `spec/README.md` ya dice INTEROP-2.22 y que los espejos siguen en 2.20 hasta el re-espejo (correcto: CS-CORE-20261024-004 sigue `C-PENDING`).

## Consumidores
| Consumidor | Hallazgo | Acción |
|---|---|---|
| Console (`../tjc-fe-rag-developer-console/app/src`) | `types.ts:41` tiene `RagDiscardReason` cerrado de tres valores, pero solo como tipo TS: no hay validación en tiempo de ejecución (sin zod/safeParse). `discardReasonLabel` (`ragLabels.ts:9`) es `Record<string,string>`; `ContextExplorerPage.tsx:70` y `RagGraph.tsx:73` caen a «Descartado» ante un motivo desconocido. **`RagSidePanel.tsx:103` renderiza `discardReasonLabel[candidate.discardReason]` sin fallback: con `BELOW_RELEVANCE_THRESHOLD` queda vacío.** Campos nuevos: se ignoran. | No rompe en runtime. Recomendado (no bloqueante para desplegar Core): WI de Console menor con re-espejo byte a byte, añadir el motivo y la etiqueta, el fallback del panel lateral y, opcional, mostrar `layer` y `strategy`. |
| GitHub Integration | Solo espeja el documento. | Re-espejo documental byte a byte; sin código. |
| Sandbox | Solo espeja SYSTEM e INTEROP. | Re-espejo documental; sin código. |

## Despliegue Core → Integration → Console (y Sandbox)
Un Core nuevo con un Console que espeja 2.20/2.21 **no se rompe**: el contrato ya exige ignorar campos desconocidos, y el Console degrada a «Descartado» (o vacío en el panel lateral). No se necesita un WI de Console previo al despliegue de Core; sí conviene antes de las capturas de evidencia, para que el Context Explorer etiquete bien.

## Propuesta de Contract Sync
```yaml
type: CONTRACT_SYNC
id: CS-CORE-20261025-001   # siguiente libre
source: core
sourceWorkItem: WI-CORE-103
targets: [console, github-integration, sandbox]
scopePaths: [spec/contracts/interoperability-contract.md]
breaking: false
changed:
  - INTEROP-2.22 interoperability-contract.md sha256 76f5e77431969995d359fb973f58c9d94ccd43c12c3429557e45806a72a29c43 (recalcular tras cualquier edición); SYSTEM-2.16 system-contract.md sin cambio (sha256 d0a492b4484c8883d65e709f76d8c7ff2462b0eb8c832649cf75723b9543ea77); GH-INTEROP-1.9 y arbol schemas/ sin cambio (digests de CS-CORE-20261024-004). §6.7: RagDiscardReason + BELOW_RELEVANCE_THRESHOLD, RagContextStrategy, RagContextLayer, layer?, configuration.strategy?/relevanceThreshold?/declaringClassMaxTokens?/targetEvidenceMaxTokens?.
requiredAction:
  - Re-espejar interoperability-contract.md byte a byte en un solo paso a INTEROP-2.22 (subsume CS-CORE-20261024-004 para INTEROP; system-contract.md sigue en SYSTEM-2.16 de ese evento); sin cambio de schemas ni generated/ (contracts:check limpio).
  - Console: tolerar y etiquetar BELOW_RELEVANCE_THRESHOLD (types.ts, ragLabels.ts, fallback en RagSidePanel.tsx:103); campos nuevos opcionales; mostrar layer/strategy es opcional.
  - Integration y Sandbox: solo re-espejo documental; ejecutar lint, build y test. Core no resuelve los eventos de otros.
```
Si el contrato se edita de nuevo, el digest cambia: recalcular al emitir el evento.

## Qué corregir
Nada obligatorio. Opcional: la frase de la observación 3 en §6.7.
