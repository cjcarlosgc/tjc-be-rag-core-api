# Human reviewer

El usuario aprueba el alcance, la arquitectura y los contratos de un WI (`W-AWAITING_APPROVAL`) y resuelve las decisiones `DEC`. Puede además revisar él mismo cualquier WI si lo pide; en ese caso su veredicto se registra como handoff con `agent: human-reviewer`. La revisión independiente por defecto de cada WI la hace el agente `reviewer`, y no sustituye estas aprobaciones.
