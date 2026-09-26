# 015-php-laravel-support — Tareas

## Fase 0 — Preparación (T-005)

- [x] Traer a `develop` el fix de `executionProfile` (`5674785`, antes solo en `feature/prueba-01`); 16/16 tests de `src/sandbox` y `tsc` en verde.
- [x] Spike de parsers PHP sobre 8.048 archivos reales; reporte en `harness/reports/T-005-php-ast-spike.md`.
- [x] Registrar `DEC-PHP-AST-001` en esta spec (PROPOSED → APROBADO el 2026-09-26).
- [x] Redactar el delta `INTEROP-2.5` en esta spec (sin editar todavía el contrato canónico).
- [x] Crear `tjc-be-php-repo-test` local: MiniERP en Laravel 13, `platform.php = 8.3.0`, 10/10 PHPUnit en `php:8.3-cli`.
- [x] Aprobación humana de `DEC-PHP-AST-001` y del delta `INTEROP-2.5` (2026-09-26).
- [x] Aplicar `INTEROP-2.5` al contrato canónico y publicar `CONTRACT_SYNC` `CS-20260926-001` a Console y Sandbox.
- [ ] Publicar `tjc-be-php-repo-test` en GitHub e instalar la GitHub App.

## Fase 1 — Refactor a adapters

- [ ] Puertos `LanguageAdapter` y `TestFrameworkAdapter` + registries.
- [ ] `TypeScriptLanguageAdapter` y `JestVitestFrameworkAdapter` sobre los servicios existentes.
- [ ] Migrar `SnapshotAnalysisJobHandler`, `RetrievalService`, `ContextBuilder` y `AnalysisRunValidationJobHandler` a los puertos.
- [ ] Suite TS completa en verde sin cambiar expectativas.

## Fase 2 — HU41 base

- [ ] Descubrimiento y filtros PHP; parser tree-sitter → `ParsedChunk[]`.
- [ ] Resolver PSR-4 y `importsUsed`; impacto y relaciones de retrieval.
- [ ] Inventario de targets y tests existentes; detección PHPUnit.
- [ ] Migración `TestFramework += PHPUNIT`, `ProjectVersion.language`.

## Fase 3 — HU42

- [ ] `PhpUnitFrameworkAdapter`: ruta, prompt, saneo, create/merge.
- [ ] Cableado en `ContextBuilder` y `AnalysisRunValidationJobHandler`.

## Fase 4 — HU41 Laravel

- [ ] `CodeChunk.role`, rutas → controladores, Eloquent, bindings; uso en retrieval y ruta de test.

## Fase 5 — Integración

- [ ] e2e Core ↔ Sandbox real con `tjc-be-php-repo-test`.
- [ ] `CONTRACT_SYNC` de implementación a Console.
