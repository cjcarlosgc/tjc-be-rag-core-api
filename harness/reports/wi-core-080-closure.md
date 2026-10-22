# WI-CORE-080 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: inventario de solo lectura de la cobertura de C-01…C-10 (Anexo E de la tesis) para el tag `arch-v1.0`, en `harness/reports/arch-v1.0-inventario-contratos-core.md`. WI `HARNESS`, carril `FAST`; pedido relayado por cross como decisión del usuario (2026-10-21). No toca `app/`, contratos, esquemas ni `referencias/`; sin corridas oficiales ni números de IOE; sin tag.

- **Revisión independiente (`reviewer`):** CHANGES_REQUESTED en el ciclo 1 (F-1…F-9: una ruta inexistente, `context_id` mal atribuido, brecha de `retrieval_id`/`context_id` sobrestimada y varias citas faltantes) y APPROVED en el ciclo 2 de 2, con todas las rutas, describes y cifras verificadas (6 `*.pg.spec.ts`, 104 omitidos sin base de datos; C-06 y C-07 verificados al 100 %). `contract-reviewer`: no aplica; sin Contract Sync.
- **Observaciones del ciclo 2:** C-06 sin la misma salvedad que C-07 (aplicada en el cierre); `context-builder.service.spec.ts` citado dos veces en C-05 (cosmético, sin acción).
- `retryLimitRespected`: 2 de 2 ciclos de revisión usados.

## Resumen del mapa (según el reporte; el analista verificó nombres por grep, sin ejecutar pruebas)

Cubiertos con contrato real: C-06 y C-07 (este último solo si Core y Sandbox están juntos). Parciales: C-01…C-05 y C-08…C-10. Brechas de mayor valor: recorrido directo e inverso de los nueve enlaces (C-08); suite de contrato de `LLMProvider` y ESC-MOD-01 (C-09); payload canónico Integration→Core sin esquema (C-01); correr los seis `*.pg.spec.ts` y aclarar qué es «puerto» (C-10); aserciones de `retrieval_id`/`context_id` en la frontera de `RetrievalService` y `ContextBuilder` (C-03/C-05). Decisión pendiente del usuario: la tesis no define qué comprueba cada CT-01…CT-10 (solo la «evidencia» por contrato); hay que fijar esas aserciones antes de escribir pruebas nuevas. No hay e2e de Core para C-01…C-08.
