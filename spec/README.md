# SDD — RAG Core API

`spec/` es la fuente de verdad del proyecto.

Orden de lectura: `constitution/project-context.md` -> constitución aplicable -> `backlog.md` -> feature `spec.md` -> `plan.md` -> `tasks.md` -> transversales aplicables.

## Versionado

La especificación vigente se consolida; no se acumulan enmiendas. Los cambios se registran en `CHANGELOG.md` y en Git.

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
