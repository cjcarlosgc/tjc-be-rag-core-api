# WI-CORE-036 — Revisión de alcance de Contract Sync histórico

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

Fecha: 2026-10-11.

## Eventos históricos excluidos de este corte

- `CS-20260920-001` no declara `scopePaths` y es anterior a la línea base. Sus acciones pendientes cubren binding, rutas y lifecycle de Projects. WI-CORE-036 preserva la cardinalidad repositorio↔Project y no modifica operaciones de binding, borrado ni autorización.
- `CS-20260921-003` tampoco declara `scopePaths` y es anterior a la línea base. Trata login de Console y orden de despliegue/configuración externa; WI-CORE-036 no toca identidad, login, publicación ni infraestructura externa.

Los digests estables se cotejaron con el contenido de ambos eventos normalizando únicamente `status`. La clasificación `NOT_RELEVANT` se limita a WI-CORE-036; no cambia el estado de los eventos ni cancela sus acciones en otros cortes.
