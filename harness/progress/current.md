# Progreso actual — CORE

**Último corte cerrado:** `WI-CORE-010`, `W-DONE`. `WI-CORE-003` es el corte activo; ver `harness/state.json` y `harness/work-items.json` para su estado y gates. El cierre de otros WIs no implica aceptación de las 18 HU.

**Hecho en los últimos cortes:** línea base SDD 3.0 de Core/Console (no homologada aún con Sandbox), catálogo fijo EP01–EP06/HU01–HU18, OC01–OC15 (P2), modelo ST↔WI y validadores de cierre/Contract Sync. `WI-CORE-009` hace reproducibles las puertas de dependencias externas; `WI-CORE-010` registra el gate cruzado. Core, Console y GitHub Integration API trabajan en `feature/jean`; Sandbox sigue intacto.

**Migración actual:** `WI-CORE-003` adaptó los consumidores Core al servicio GitHub Integration y migró el ingress de webhooks. Implementación, suites, Contract Sync y checkpoints `implementation-delivery`/`before-review` están completos. El WI sigue `W-IN_REVIEW`: falta el visto bueno humano personal; no se hizo deploy/configuración/cutover externo.

**Contract Sync heredado:** los eventos históricos conservan su ciclo/evidencia; las clasificaciones de relevancia se limitan al WI que las registró y no cierran otras obligaciones.

El progreso anterior, incluido T-004-context-traces, se conserva en `harness/reports/`, `CHANGELOG.md` y Git; no es la planificación vigente.
