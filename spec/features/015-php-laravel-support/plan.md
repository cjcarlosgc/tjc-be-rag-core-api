# 015-php-laravel-support — Plan

Cortes en orden. Cada corte deja lint, test y build en verde.

0. **Preparación (T-005 Fase 0):** fix `executionProfile` en `SandboxExecutionService`; spike y propuesta `DEC-PHP-AST-001`; esta feature; delta `INTEROP-2.5`; repositorio de prueba `tjc-be-php-repo-test` (MiniERP en Laravel 13, PHP 8.3, PHPUnit 12).
1. **Refactor a adapters (sin cambio de comportamiento):** puertos `LanguageAdapter`/`TestFrameworkAdapter` en `src/languages/`; `TypeScriptLanguageAdapter` y `JestVitestFrameworkAdapter` envuelven los servicios actuales; registries por workspace y por framework; `executionProfile` deriva del adapter. Todos los tests TS existentes siguen en verde.
2. **HU41 base:** `PhpLanguageAdapter` (descubrimiento, parser tree-sitter, chunks, PSR-4, impacto, inventario, detección PHPUnit); migración `TestFramework += PHPUNIT` y `ProjectVersion.language`.
3. **HU42:** `PhpUnitFrameworkAdapter` (ruta de test, prompt, saneo, create/merge); cableado en `ContextBuilder` y `AnalysisRunValidationJobHandler`.
4. **HU41 Laravel:** rol por archivo (`CodeChunk.role`), rutas → controladores, Eloquent, bindings del contenedor; uso del rol en retrieval y en la ruta de test.
5. **Integración:** e2e Core ↔ Sandbox real con `tjc-be-php-repo-test` (webhook → Check → companion PR); `CONTRACT_SYNC` de implementación a Console.

El corte 4 va después del 3 para poder medir en la tesis el efecto de las convenciones Laravel sobre la calidad de los tests generados.

## Verificación

- Fixtures PHP en `app/src/languages/php/__fixtures__/` (PHP 8.3/8.4, archivo con error de sintaxis, test existente).
- Contract tests del delta `INTEROP-2.5` y de `executionProfile`/`runnerHint` hacia el Sandbox.
- Compatibilidad TypeScript: la suite actual sin cambios de expectativas en el corte 1.
