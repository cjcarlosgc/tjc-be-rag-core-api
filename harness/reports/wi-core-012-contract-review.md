# Revisión contractual — WI-CORE-012

**Fecha:** 2026-09-27
**Alcance:** delta PHP de `INTEROP-2.6` para HU03/HU04. El usuario aprobó este delta el 2026-09-27; esa aprobación no equivale al visto bueno independiente de todo el Work Item ni lo cierra.

## Resultado del delta PHP

- `ProjectLanguage = TYPESCRIPT | PHP` aparece en status, results, summary e inventory; coincide con los DTOs de Core y con `ProjectVersion.language`.
- `TestFramework` incluye `PHPUNIT`; TypeScript conserva `JEST`/`VITEST`. La migración establece `TYPESCRIPT` como default y backfill para versiones previas.
- El contrato de generación define `PHP_LARAVEL_PHPUNIT`, pero este WI no implementa generación/ejecución PHP. Eso queda en WI-CORE-013 y no afirma compatibilidad ejecutable de Sandbox.
- El delta no exige cambios funcionales de Console; sí requiere importar `INTEROP-2.6` y sus tipos compartidos. `CS-CORE-20260927-001` sigue `C-PENDING`, sin acuse de Console.

## Referencias heredadas excluidas por instrucción del usuario

Estas tres áreas aparecen en documentación previa, pero se consideran desfasadas para el corte actual. No son parte de WI-CORE-012, no deben importarse desde PR #6 ni tratarse como comportamiento vigente al revisar el delta PHP:

1. Recorrido de `X-GitHub-Provider-Token`/OAuth.
2. Ciclo de vida de preguntas `Action Required` al obsoletarse un Run.
3. Autorización de ramas mediante callback síncrono Integration → Core.

No se modifica aquí su implementación ni esas secciones del contrato; su limpieza o reemplazo requiere un corte propio. Por ello, este reporte aprueba **solo la coherencia interna del delta PHP**, no declara revisada la vigencia integral de todo `INTEROP-2.6`.

## Secuencia y pendientes antes del cierre

- Console debe importar y acusar el Contract Sync; después resolver su acción con evidencia para satisfacer la sincronización transversal del WI.
- El usuario todavía debe revisar el diff completo y emitir su visto bueno independiente del WI.
- Resolver el pequeño cambio no comprometido de fecha de corte del contrato antes de publicar una revisión final del artefacto.
