# 001-project-management — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

Módulo `projects` con controller/service/repository. Separar creación/consulta de la lógica de indexación. Persistir `Project` y relación con `ProjectVersion`.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
