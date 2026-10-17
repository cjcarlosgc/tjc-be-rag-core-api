# WI-CORE-055 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Autoriza:** Jean, directamente en el chat de Core («Confirmo los 3 puntos + análisis B», punto 3) y el coordinador: «Procede con 055».

## Alcance
`inspect_symbol` del GENERALIST_AGENT (`generation/agent/workspace-agent-tools.ts`) resuelve nombres PHP calificados con `\` (p. ej. `App\Domain\OrderLine\hasStock` y `App\Domain\OrderLine`) además de los simples; TypeScript y nombres simples sin cambio; prueba roja-verde. Sin cambiar ranking ni contexto RAG, experimentos, evidencia, métricas ni contratos; sin build en `app/`.
