# WI-CORE-031 — aprobación de alcance por el usuario (2026-10-09)

Modelo: agente principal de la sesión Core · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Autoriza:** el usuario, en chat, tras ver la propuesta de alcance y el resultado de las pruebas de la API (`harness/reports/deployment-preconditions-20261009.md`).

## Decisiones
1. **Qué flujos pasan a `/v1/responses`:** TODOS, incluido el flujo de producto (no solo los experimentos).
2. **Estado de la conversación:** sin estado (`store=false`, sin `previous_response_id`) y devolviendo al modelo los ítems de razonamiento cifrados en cada turno; nada queda retenido en OpenAI.
3. **Contrato:** el endpoint efectivo es solo interno (`modelConfig`) y consta en la evidencia experimental; no se expone en el campo `model` de Console. Sin cambio de INTEROP ni Contract Sync.

## Qué es y qué no es
Es la aprobación del **alcance** para pasar a SDD; no es `SPEC_VERIFIED` ni autoriza implementar por sí sola: el `sdd-analyst` debe verificar la suficiencia (incluida una prueba real mínima del turno múltiple con razonamiento cifrado y la compatibilidad de los esquemas de herramientas con Responses), y el flujo de producto exige pruebas de regresión. El leader toma el WI cuando el slot activo se libere (hoy está activo WI-CORE-030).

## Riesgo anotado
Migrar también el producto amplía el alcance y toca un flujo en uso (`gpt-4o-mini`): se revalida con pruebas de regresión y no se envía el parámetro `reasoning` a modelos sin razonamiento.
