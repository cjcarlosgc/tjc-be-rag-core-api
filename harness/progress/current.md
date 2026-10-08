# Progreso actual — CORE

## Secuencia vigente SMART V3 (2026-10-08)

`WI-CORE-016`, `WI-CORE-006`, `WI-CORE-017` y `WI-CORE-018` están `W-DONE` (cierre de 018 en `harness/reports/wi-core-018-closure.md`; `CS-CORE-20261008-002` hacia Console sigue `C-PENDING`). No hay WI activo. Siguen elegibles `WI-CORE-019` (P0, ruta crítica), `WI-CORE-023` y `WI-CORE-007` (P1). Solo puede haber un WI activo por repositorio, así que el Leader los toma en ese orden de prioridad. El usuario aprobó el alcance de `WI-CORE-017` a `WI-CORE-027` (`harness/reports/smart-v3-scope-approval.md`); el Leader los toma por prioridad y dependencias sin pedir aprobación por corte y se detiene solo por `BLOCKED`, `DECISION_REQUIRED`, Human Review o dependencia externa real.

1. **P0, ruta crítica en serie:** `WI-CORE-017` (hecho: SYSTEM-2.6/INTEROP-2.7 publicados y Contract Sync importado en Console y GitHub Integration) → `WI-CORE-018` (hecho) → `WI-CORE-019` → `WI-CORE-020` → `WI-CORE-021`. Comparten migraciones de Functional Knowledge y por eso no se paralelizan.
2. **P1, en paralelo con la ruta crítica:** `WI-CORE-023` → `WI-CORE-024` → `WI-CORE-025` (OE5) tras `WI-CORE-017`; `WI-CORE-022` (OE2) tras `WI-CORE-019`, que introduce el rol Writer que exige su ruta. Después `WI-CORE-026` (tras 021) y `WI-CORE-007` → `WI-CORE-027` (tras 007, 025 y 026).
3. **Diferido, no bloquea nada:** `WI-CORE-013`, `WI-CORE-028` y `WI-CORE-029` (PHP y coordinación con Sandbox, de otro desarrollador). `WI-CORE-004` y `008` (P2) se toman al final; `WI-CORE-005` quedó `W-CANCELLED` (HNSW desestimado, `DEC-VEC-001`).

Cada WI con impacto contractual emite Contract Sync a Console al implementarse; Console y GitHub Integration no se modifican desde Core.


**Cierre más reciente:** `WI-CORE-015`, `W-DONE`; no hay WI activo. SYSTEM-2.5, INTEROP-2.6 y GH-INTEROP-1.2 están homologados byte por byte con Console y GitHub Integration; no cambió semántica contractual. El cierre no implica despliegue ni cutover. Ver `harness/state.json`, `harness/work-items.json` y `harness/reports/wi-core-015-closure.md`.

**Cierre anterior:** `WI-CORE-011`, `W-DONE`. Core excluye PRs anteriores al binding, reclasifica y oculta el historial relacionado, y recupera durablemente las fechas no verificables. `CS-CORE-20260927-003` solicitó a Console espejar INTEROP-2.6 en su WI consumidor. Ver `harness/reports/wi-core-011-closure.md`.

**Hecho en los últimos cortes:** línea base SDD 3.0 de Core/Console (no homologada aún con Sandbox), catálogo fijo EP01–EP06/HU01–HU18, OC01–OC15 (P2), modelo ST↔WI y validadores de cierre/Contract Sync. `WI-CORE-009` hace reproducibles las puertas de dependencias externas; `WI-CORE-010` registra el gate cruzado. Core, Console y GitHub Integration API trabajan en `feature/jean`; Sandbox sigue intacto.

**Migración cerrada:** `WI-CORE-003` adaptó los consumidores Core al servicio GitHub Integration y migró el ingress de webhooks. Implementación, suites, Contract Sync (incluido GH-006), los cuatro checkpoints y el visto bueno humano están registrados. No se hizo deploy/configuración/cutover externo.

**Contract Sync heredado:** los eventos históricos conservan su ciclo/evidencia; las clasificaciones de relevancia se limitan al WI que las registró y no cierran otras obligaciones.

El progreso anterior, incluido T-004-context-traces, se conserva en `harness/reports/`, `CHANGELOG.md` y Git; no es la planificación vigente.
