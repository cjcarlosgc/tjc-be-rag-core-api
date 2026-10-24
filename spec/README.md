# SDD — RAG Core API

`spec/` es la fuente de verdad del proyecto.

**Línea base común:** SDD 3.1 / Harness V3 en los cuatro repositorios. Core mantiene los contratos canónicos SYSTEM-2.16, INTEROP-2.21 y GH-INTEROP-1.9 (`WI-CORE-089`, documental; los espejos de GitHub Integration, Console y Sandbox siguen en SYSTEM-2.15 e INTEROP-2.20 hasta su re-espejo por Contract Sync), más los esquemas JSON de `spec/contracts/schemas/`; GitHub Integration y Console los espejan byte a byte, y Sandbox espeja SYSTEM e INTEROP.

Orden de lectura: `contracts/system-contract.md` -> `contracts/interoperability-contract.md` -> `constitution/project-context.md` -> `constitution/planning-model.md` y constitución aplicable -> `backlog.md`/`operational-cases.md` -> feature `spec.md` -> `plan.md` -> `tasks.md` -> transversales aplicables -> `harness/work-items.json`. La extracción está detallada en `features/016-github-integration/`; las dependencias entre repos y sus puertas locales, en `features/017-cross-repository-dependency-gates/`. Cada repo mantiene solo WIs locales y se coordina por Contract Sync.

## Versionado

La numeración HU anterior se retiró de la especificación vigente. El mapa de capacidades históricas se conserva en `harness/reports/hu-rebaseline-audit.md`, `CHANGELOG.md` y Git; ninguna casilla histórica acredita `H-DONE`.

La especificación vigente se consolida; no se acumulan enmiendas. Los cambios se registran en `CHANGELOG.md` y en Git. `sddVersion: 3.1` identifica la línea base común de los cuatro repositorios. Los 18 IDs HU vigentes no heredan automáticamente el estado de las antiguas HU homónimas.

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

`contracts/system-contract.md` es el propietario canónico de las decisiones compartidas actuales. Las copias espejo declaran `SYSTEM-*`; no sustituyen specs internas ni cierran operaciones `PENDING`. `contracts/github-integration-contract.md` es el contrato entre Core, Console y GitHub Integration: incluye rutas de usuario Console→Integration y operaciones privadas, incluida autorización síncrona Integration→Core. `GH-INTEROP-1.8` conserva la identidad y respuesta de Checks, pero sustituye la coordinación PostgreSQL de `GH-INTEROP-1.5` por una sola instancia activa con mutex efímero en proceso; no agrega una base ni garantiza coordinación entre procesos o reinicios. El cutover y la configuración externa siguen pendientes.

`contracts/interoperability-contract.md` contiene los DTOs, rutas, estados, errores y reglas de transporte públicos vigentes. Su versión `INTEROP-*` evoluciona independientemente de la línea base SDD conjunta.
