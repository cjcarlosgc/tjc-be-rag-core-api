# Progreso actual — CORE

**Último corte cerrado:** `WI-CORE-003`, `W-DONE`. No hay WI activo; `WI-CORE-011` queda planificado después de `WI-GH-007` para excluir y ocultar Runs de PRs anteriores al binding. El cierre no implica aceptación de las 18 HU ni despliegue/cutover. Ver `harness/state.json` y `harness/work-items.json`.

**Hecho en los últimos cortes:** línea base SDD 3.0 de Core/Console (no homologada aún con Sandbox), catálogo fijo EP01–EP06/HU01–HU18, OC01–OC15 (P2), modelo ST↔WI y validadores de cierre/Contract Sync. `WI-CORE-009` hace reproducibles las puertas de dependencias externas; `WI-CORE-010` registra el gate cruzado. Core, Console y GitHub Integration API trabajan en `feature/jean`; Sandbox sigue intacto.

**Migración cerrada:** `WI-CORE-003` adaptó los consumidores Core al servicio GitHub Integration y migró el ingress de webhooks. Implementación, suites, Contract Sync (incluido GH-006), los cuatro checkpoints y el visto bueno humano están registrados. No se hizo deploy/configuración/cutover externo.

**Contract Sync heredado:** los eventos históricos conservan su ciclo/evidencia; las clasificaciones de relevancia se limitan al WI que las registró y no cierran otras obligaciones.

El progreso anterior, incluido T-004-context-traces, se conserva en `harness/reports/`, `CHANGELOG.md` y Git; no es la planificación vigente.
