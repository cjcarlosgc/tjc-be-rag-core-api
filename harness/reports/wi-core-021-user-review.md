# Revisión humana — WI-CORE-021
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-08 (America/Lima)
**Reviewer:** usuario (Human Reviewer); el veredicto y las condiciones provienen del usuario en el chat de la sesión, no de un agente (sin `executedBy`).
**Veredicto:** `APPROVED`, condicionado a formalizar en `WI-CORE-026` la persistencia de la traza (obligación registrada en `spec/features/011-context-traces/{spec,plan,tasks}.md` y en `acceptanceCriteria` de `WI-CORE-026`, commit a8707f2).

Evidencia revisada: `wi-core-021-implementation.md`, `wi-core-021-sdd-verification.md`, `wi-core-021-contract-sync-checkpoints.md`.

## Desviaciones del implementer aprobadas (con condiciones)
1. El default `[]` del quinto parámetro de `ContextBuilder.build` es solo por compatibilidad; no debe usarse para omitir reglas cuando el caller ya dispone de Functional Knowledge aplicable.
2. `confirmedByUserId` no va al prompt pero se conserva íntegro en `GenerationContext` junto con la procedencia.
3. El encabezado fijo puede quedar fuera de `maxContextTokens`; todo contenido variable de reglas enviado al LLM cuenta con el mismo tokenizador y se descuenta antes de `relatedChunks`.
4. La auditoría registra `retrieved` y `selected`, distingue reglas aplicables de las que entraron por presupuesto, y las omitidas con cantidad y motivo.

## Decisión sobre la traza persistida
La implementación cumple todo salvo que la traza persistida (`ContextTrace`, `makeRagDetail` en `app/src/experiments/experiment-job.handler.ts`) no guarda procedencia ni `audit.functionalRules`. Decisión del usuario: NO ampliar 021 para persistirlo. 021 conserva su responsabilidad (construir `GenerationContext`, recuperar reglas `ACTIVE` aplicables, seleccionar por presupuesto, conservar en memoria procedencia y auditoría). La persistencia pasa a `WI-CORE-026`: el `context_id` conserva `functionalRuleIds` seleccionados, cantidades recuperadas/seleccionadas/omitidas, motivo de omisión (al menos `TOKEN_BUDGET`) y `knowledgeId` para reconstruir la procedencia desde Functional Knowledge sin duplicarla; si se exponen en `GET /analysis-runs/{id}/trace` o en el bundle, `WI-CORE-026` actualiza INTEROP-2.7 y emite Contract Sync a Console. No cambia el contrato público ni requiere ampliar Console ni GitHub Integration en 021.

## Deuda aceptada (no resuelta en este WI)
- La traza persistida de experimentos no contiene `functionalRules` ni procedencia; hasta `WI-CORE-026` no hay evidencia durable de qué reglas entraron al prompt.
- El test actual de `app/src/experiments/experiment-job.handler.spec.ts` (aserción `expect(serialized).not.toContain('functionalRules')`) exige la ausencia de `functionalRules` en la traza; `WI-CORE-026` deberá invertirlo o reemplazarlo.
- El default `[]` de `ContextBuilder.build` sigue siendo permisivo; los callers deben pasar siempre las reglas recuperadas.

Esta evidencia no autoriza push, PR, merge ni despliegue.
