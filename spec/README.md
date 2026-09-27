# SDD — RAG Core API

`spec/` es la fuente de verdad del proyecto.

**Línea base Core/Console:** SDD 3.0 / SYSTEM-2.5 / INTEROP-2.6. **Homologación global pendiente:** Sandbox permanece en SDD 2.1 bajo trabajo de otro desarrollador; `2026-09-24-core-console-transition` identifica este corte sin declarar compatibilidad global.

Orden de lectura: `contracts/system-contract.md` -> `contracts/interoperability-contract.md` -> `constitution/project-context.md` -> `constitution/planning-model.md` y constitución aplicable -> `backlog.md`/`operational-cases.md` -> feature `spec.md` -> `plan.md` -> `tasks.md` -> transversales aplicables -> `harness/work-items.json`. La extracción está detallada en `features/016-github-integration/`; las dependencias entre repos y sus puertas locales, en `features/017-cross-repository-dependency-gates/`. Cada repo mantiene solo WIs locales y se coordina por Contract Sync.

## Versionado

La numeración HU anterior se retiró de la especificación vigente. El mapa de capacidades históricas se conserva en `harness/reports/hu-rebaseline-audit.md`, `CHANGELOG.md` y Git; ninguna casilla histórica acredita `H-DONE`.

La especificación vigente se consolida; no se acumulan enmiendas. Los cambios se registran en `CHANGELOG.md` y en Git. `sddVersion: 3.0` identifica la nueva línea base Core/Console solicitada por el usuario; aún no está homologada globalmente con Sandbox, por lo que no se publica como línea base común hasta completar ese trabajo. Los 18 IDs HU vigentes no heredan automáticamente el estado de las antiguas HU homónimas.

## Estados de decisión

- **APROBADO:** implementable.
- **PROPOSED:** recomendación técnica aún no aprobada.
- **PENDING:** decisión requerida antes de implementar el punto afectado.

Las decisiones `PENDING` y `PROPOSED` que puedan afectar trabajo futuro deben tener un ID estable y declarar su alcance:

```md
### DEC-AREA-NNN — Título breve
**Estado:** PENDING
**Blocks:** HUxx, `spec/features/...` o `NONE`
**Pregunta:** pregunta concreta que necesita respuesta
```

`Blocks` determina si la decisión impide verificar el work item activo. Una decisión pendiente de otra feature no bloquea globalmente el repositorio. No registrar como decisión técnica bloqueante información académica que no cambie un contrato implementable.

No existe un registro central adicional que duplique decisiones. Cada decisión vive en la spec dueña del contrato; `CHANGELOG.md` registra cuándo cambió y `harness/state.json` conserva únicamente los IDs aplicables al work item activo.

## Contrato entre componentes

`contracts/system-contract.md` es el propietario canónico de las decisiones compartidas actuales. Las copias espejo declaran `SYSTEM-*`; no sustituyen specs internas ni cierran operaciones `PENDING`. `contracts/github-integration-contract.md` es el contrato entre Core, Console y GitHub Integration: incluye rutas de usuario Console→Integration y operaciones privadas, incluida autorización síncrona Integration→Core. `GH-INTEROP-1.1` sustituye la topología limitada a Core de `GH-INTEROP-1.0`; el cutover y la configuración externa siguen pendientes.

`contracts/interoperability-contract.md` contiene los DTOs, rutas, estados, errores y reglas de transporte públicos vigentes. Su versión `INTEROP-*` evoluciona independientemente de la línea base SDD conjunta.
