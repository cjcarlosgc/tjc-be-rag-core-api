# Progreso actual — CORE

**Cierre registrado:** `WI-CORE-011`, `W-DONE`; no hay WI activo. Core excluye PRs anteriores al binding, reclasifica y oculta el historial relacionado, y recupera durablemente las fechas no verificables. `CS-CORE-20260927-003` solicita a Console espejar INTEROP-2.6 en su WI consumidor; esa implementación no bloquea el cierre local de Core. No se hizo push, PR, despliegue ni cutover. Ver `harness/state.json`, `harness/work-items.json` y `harness/reports/wi-core-011-closure.md`.

**Hecho en los últimos cortes:** línea base SDD 3.0 de Core/Console (no homologada aún con Sandbox), catálogo fijo EP01–EP06/HU01–HU18, OC01–OC15 (P2), modelo ST↔WI y validadores de cierre/Contract Sync. `WI-CORE-009` hace reproducibles las puertas de dependencias externas; `WI-CORE-010` registra el gate cruzado. Core, Console y GitHub Integration API trabajan en `feature/jean`; Sandbox sigue intacto.

**Migración cerrada:** `WI-CORE-003` adaptó los consumidores Core al servicio GitHub Integration y migró el ingress de webhooks. Implementación, suites, Contract Sync (incluido GH-006), los cuatro checkpoints y el visto bueno humano están registrados. No se hizo deploy/configuración/cutover externo.

**Contract Sync heredado:** los eventos históricos conservan su ciclo/evidencia; las clasificaciones de relevancia se limitan al WI que las registró y no cierran otras obligaciones.

El progreso anterior, incluido T-004-context-traces, se conserva en `harness/reports/`, `CHANGELOG.md` y Git; no es la planificación vigente.
