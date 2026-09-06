# 007-artifacts — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

ArtifactService trabaja con la abstracción interna `ObjectStorageService`; diff se calcula on demand y no modifica artifact. ZIP de descarga se arma de manera segura preservando rutas relativas.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
