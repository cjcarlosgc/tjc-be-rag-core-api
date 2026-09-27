# 013 — Subtareas actuales

- [ ] **ST-CORE-004 · T-BACKLOGGED · WI-CORE-004 · HU03–HU16:** formalizar OC01–OC15 desde happy paths; agregar subcasos aprobados, pruebas y trazabilidad sin asumir cobertura por el catálogo.
- [x] **ST-CORE-016 [T-DONE] · WI-CORE-003 · HU08, HU14:** hacer atómica la creación de preguntas y la transición a `ACTION_REQUIRED`; ocultar/obsoletar preguntas de Runs obsoletos y evitar que jobs tardíos publiquen Checks o sobrescriban su estado.
- [ ] **ST-CORE-017 · T-BACKLOGGED · WI-CORE-011 · HU02, HU14:** consumir `pullRequest.createdAt` del evento normalizado y excluir de creación/reinicio de Runs los PRs creados antes de `RepositoryBinding.createdAt`, incluidos eventos `synchronize` posteriores.
- [ ] **ST-CORE-018 · T-BACKLOGGED · WI-CORE-011 · HU12, HU14:** reexaminar Runs históricos; conservarlos, obsoletar y ocultar los pre-binding en listas/detalles/bandejas, y mantener ocultos con reintento durable los que no puedan clasificarse por falta temporal de metadata.

El trabajo histórico de esta feature está en `CHANGELOG.md`, `harness/reports/` y Git. Su antigua numeración de HU no se reutiliza como evidencia de aceptación de las 18 HU vigentes.
