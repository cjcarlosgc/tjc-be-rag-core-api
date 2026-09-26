# 015-php-laravel-support — Especificación

**Estado:** APROBADO (2026-09-26). `DEC-PHP-AST-001` e `INTEROP-2.5` aprobados por el equipo.
**Historias:** HU41, HU42 (HU43 ya implementada en Test Execution Sandbox)
**Contrato:** SYSTEM-2.4 / INTEROP-2.5 (aditiva sobre 2.4)

## Objetivo

Extender el flujo PR-driven para que Core analice repositorios PHP/Laravel (HU41) y genere pruebas PHPUnit validadas en el Sandbox (HU42), con la misma trazabilidad de contexto que el track TypeScript y sin dispersar condicionales de lenguaje por el dominio (`constitution/conventions.md`).

## Reglas y comportamiento

### Selección de lenguaje

- Un Project tiene un único lenguaje por `ProjectVersion`, detectado en el snapshot: `composer.json` en la raíz → `PHP`; `package.json` → `TYPESCRIPT`. En un repositorio Laravel con frontend TS (`resources/js`), gana PHP y el TS no se indexa en V1.
- Todo código dependiente de lenguaje o framework vive detrás de `LanguageAdapter` y `TestFrameworkAdapter`; el dominio (`snapshot-intelligence`, `retrieval`, `validation`) solo conoce los puertos.

### HU41 — Análisis PHP/Laravel

- Ignorados: `vendor/`, `storage/`, `bootstrap/cache/`, `public/build/`, `node_modules/`.
- Fuente: `*.php`. `*.blade.php` y `database/migrations/**` no son targets; las migraciones se indexan como chunks `FILE`.
- Tests: `tests/**/*Test.php`.
- Chunks: `CLASS`, `INTERFACE`, `TRAIT`, `ENUM`, `METHOD`, `CONSTRUCTOR`, `FUNCTION`, `FILE`, con la misma forma `ParsedChunk`, conteo de tokens y partición de chunks grandes que TypeScript. `qualifiedName` = `Namespace\Clase.metodo`.
- Relaciones estructurales: `importsUsed` = FQCN de los `use` + clases del mismo namespace referenciadas sin `use`; se resuelven a archivo mediante PSR-4 (`autoload`/`autoload-dev` de `composer.json`).
- Inventario: targets = clases concretas y métodos `public`; un target tiene test si un `*Test.php` importa su FQCN y llama al método, o por la convención espejo `app/X.php` ↔ `tests/Unit/XTest.php`.
- Framework: `phpunit/phpunit` en `require-dev` → `PHPUNIT`; cualquier otro (p. ej. Pest) → `null` y la propuesta queda `HELD` con mensaje explícito.
- Convenciones Laravel (corte posterior): rol por archivo (`CONTROLLER`, `MODEL`, `FORM_REQUEST`, `SERVICE`, `JOB`, `POLICY`, `MIDDLEWARE`, `PROVIDER`, `MIGRATION`), rutas → controladores, relaciones Eloquent y bindings de `*ServiceProvider`.

### HU42 — Generación PHPUnit

- Ruta del test: el test existente del target si lo hay; si no, convención espejo (`tests/Feature` para `CONTROLLER`/`FORM_REQUEST`, `tests/Unit` para el resto) con namespace derivado de `autoload-dev`.
- El prompt incluye versiones de PHP/PHPUnit/Laravel (`composer.lock`), clase base adecuada, `strict_types` si el proyecto lo usa y `RefreshDatabase` solo con SQLite en memoria en `phpunit.xml`. La respuesta es un archivo PHP completo.
- Merge: agrega `use` faltantes e inserta métodos antes del cierre de la clase, renombrando colisiones; si el archivo no se puede parsear, la propuesta queda `HELD` (sin merge a ciegas).
- Validación: `executionProfile: PHP_LARAVEL_PHPUNIT`, `runnerHint: PHPUNIT`. Una generación = una ejecución en el Sandbox, sin reparación automática (decisión de HU23).

## Delta contractual (INTEROP-2.5, aditivo, aplicado)

- `detectedFramework`: `'JEST' | 'VITEST' | 'PHPUNIT' | null` en `ProjectVersionResultsResponse`, `ProjectVersionSummaryResponse` y `TestInventoryResponse`.
- `ProjectVersionResponse.language: 'TYPESCRIPT' | 'PHP' | null` (`null` hasta detectarlo en el snapshot; las versiones existentes se rellenan con `TYPESCRIPT`).
- Sin rutas nuevas. `AnalysisSymbolResponse.language` y los perfiles del Sandbox ya existen en INTEROP-2.4.
- `CONTRACT_SYNC` `CS-20260926-001` publicado a Console y Sandbox al aprobarse; se publicará otro al implementarse.

## Decisiones

### DEC-PHP-AST-001 — Parser PHP para análisis estructural
**Estado:** APROBADO (2026-09-26)

**Resolución:** `web-tree-sitter@0.25` + `tree-sitter-php@0.24` (WASM, sin compilación nativa). En el spike de T-005 parseó 8.048 archivos PHP reales (Laravel 13 + vendor, 37,8 MB) con 4 archivos con error (0,05%), incluida sintaxis PHP 8.4 (property hooks, visibilidad asimétrica, `new X()->m()`). La alternativa `php-parser` (glayzzle) 3.7 es ~35% más rápida pero falla en esa sintaxis 8.4 (10 archivos de Symfony). Evidencia: `harness/reports/T-005-php-ast-spike.md`.

## Fuera de alcance

- Pest, Blade, JavaScript del frontend Laravel.
- Brazo `GENERALIST_AGENT` del experimento para PHP (sus herramientas usan ts-morph); se registrará como HU nueva si la tesis lo requiere.
- Fase `BASELINE` del Sandbox (aprobada, pendiente de implementación en Sandbox).
