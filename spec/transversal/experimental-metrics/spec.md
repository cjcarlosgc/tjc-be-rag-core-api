# experimental-metrics — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** capacidad técnica transversal

## Objetivo

Conservar datos objetivos para análisis estadístico posterior sin fijar todavía muestra o prueba estadística.

## Reglas y comportamiento

- Conservar por repetición la estrategia, configuración del modelo, métricas de compilación/ejecución/validez, failure type, tiempos, tokens y costo cuando estén disponibles.
- Conservar trazas explicativas de adquisición de contexto propias de cada estrategia sin convertir un dato ausente en cero.
- Exponer datos y agregados reproducibles; el backend no concluye significancia estadística ni declara automáticamente un ganador.


## Jerarquía de métricas y evidencia (SDD 2026-10-08; implementación pendiente)

La jerarquía vigente es CF primaria, CO secundaria y VT guardrail; tokens, costo, latencia, tool calls y archivos son descriptivas; compilación, ejecución, aprobación y tipo de fallo son diagnóstico técnico; Precision@k y Recall@k son exclusivas de OE2. El oráculo es previo a las salidas, no se entrega a RAG ni al agente y no se construye de la prueba generada; no hay segundo LLM como juez y la evaluación de CF/CO es humana y externa. Core no deriva CF/CO de `valid`/`passed`, no declara ganador funcional y exporta evidencia reproducible versionada (`INTEROP-2.7` §6.16, `schemaVersion: '1'`) sin chain-of-thought ni identificadores `EV-OE*`. Bootstrap, Wilcoxon y Cohen κ quedan fuera del producto. **Hallazgo:** el agregado actual prioriza `validRate`; `WI-CORE-027` ajusta la presentación a esta jerarquía sin inventar estados.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- Mutation testing no forma parte de este alcance; la decisión de descarte está en `spec/ideas.md`.
