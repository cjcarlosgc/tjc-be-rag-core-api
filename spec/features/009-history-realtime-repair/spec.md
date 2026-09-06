# 009-history-realtime-repair — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU20, HU21, HU22, HU24. HU23 (autorreparación automática) queda descartada — ver regla de alcance definitivo más abajo.

## Objetivo

Evolucionar el producto con historial, push de estado y reintento manual de generaciones fallidas.

## Reglas y comportamiento

- Historial permite consultar runs anteriores sin alterar snapshots.
- WebSockets reemplaza polling progresivamente en Sprint 3; HTTP status/results siguen siendo contratos útiles/fallback.
- **Alcance definitivo de validación (reemplaza a HU23):** una generación validada equivale a una única ejecución en el Sandbox. Si falla por compilación, ejecución o assertions, el resultado queda `INVALID`/`FAILED` tal cual, sin ningún intento adicional. No existe autorreparación automática ni reintento de corrección de la prueba mediante LLM. Esta decisión forma parte del alcance definitivo de la arquitectura y no se contempla como evolución futura (no es una puerta PENDING ni queda abierta a reconsideración posterior).
- HU24 (reintento manual) no depende de un mecanismo automático previo: permite volver a ejecutar desde cero, a pedido explícito del usuario, un target específico de un run terminado que quedó `INVALID`/`FAILED` — no reprocesa el run completo ni los demás targets, y actualiza el resultado/artefacto existente en su lugar.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
- No implementar autorreparación/corrección automática de pruebas inválidas (HU23 tal como constaba en el backlog): decisión definitiva de arquitectura, no un pendiente a resolver más adelante.
