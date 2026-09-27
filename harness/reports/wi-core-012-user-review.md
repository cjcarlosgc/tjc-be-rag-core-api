# Revisión humana — WI-CORE-012

**Fecha:** 2026-09-27
**Reviewer:** usuario
**Veredicto:** `APPROVED` para el alcance de WI-CORE-012.

## Alcance revisado

HU03/HU04: detección de snapshots PHP, análisis estructural, inventario heurístico de tests existentes, persistencia de `ProjectVersion.language`, DTOs `INTEROP-2.6` y regresión de TypeScript. El usuario aprobó el corte tras revisar su resumen, evidencia técnica y revisión contractual del delta PHP.

## Compatibilidad con lo previamente definido

- No se crean ni redefinen épicas o historias; se reutilizan HU03/HU04.
- El recorrido TypeScript y `JEST`/`VITEST` se conserva. Las versiones existentes quedan clasificadas `TYPESCRIPT`; los snapshots PHP añaden `PHP` y el framework detectable `PHPUNIT`.
- El contrato extiende las respuestas de versiones/inventario. Console debe importar el tipo compartido y no presentar PHPUnit como listo para generación antes de WI-CORE-013.
- No se incluye generación/ejecución PHPUnit, cambios en Sandbox ni trabajo de WI-CORE-013.
- Los textos heredados sobre OAuth, `Action Required` y autorización de ramas se excluyeron del corte y no se consideran comportamiento aprobado por esta revisión.

Esta aprobación no cierra el WI: quedan pendientes el Contract Sync del consumidor Console (`CS-CORE-20260927-001`) y las puertas Harness previas a `W-DONE`.
