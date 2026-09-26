# T-005 — Spike de parser PHP (`DEC-PHP-AST-001`)

**Fecha:** 2026-09-26 · **Work item:** T-005-php-laravel-support (Fase 0)

## Conclusión

Recomendación: `web-tree-sitter@0.25.10` + `tree-sitter-php@0.24.2` (WASM). Es la única opción evaluada que parsea la sintaxis PHP 8.4 que ya aparece en dependencias reales, sin compilación nativa.

## Método

1. Fixtures propios (PHP 8.3): namespace, `use` agrupados y con alias, clase `final readonly` con atributo, constructor con promoción, `match`, nullsafe, enum respaldado con métodos, trait, función global, test PHPUnit 12 con `#[Test]` y un archivo con error de sintaxis.
2. Corpus real: `tjc-be-php-repo-test` recién creado con `composer create-project laravel/laravel` (Laravel 13.17, PHPUnit 12.5, `vendor/` completo), excluyendo `*.blade.php`.
3. Por archivo: parseo con ambos parsers, conteo de errores y tiempo acumulado (Node 20, M-series).

## Resultados

| Parser | Archivos con error (de 8.048) | Tiempo total | Sintaxis PHP 8.4 |
| --- | --- | --- | --- |
| `web-tree-sitter` + `tree-sitter-php` | 4 (0,05%) | 3,7 s | Sí |
| `php-parser` (glayzzle) 3.7.0, `php8: true` | 10 (0,12%) | 2,4 s | No |

- Errores de tree-sitter: interpolación compleja en strings (`symfony/var-dumper`), una constante de clase tipada (`mockery`), dos casos aislados en `psysh` y `league/uri-interfaces`. Ninguno afecta la extracción de clases y métodos del resto del archivo.
- Errores de php-parser: property hooks (`symfony/http-foundation/Response.php`), visibilidad asimétrica `public(set)` (`symfony/http-kernel`), `new X()->m()` sin paréntesis (`symfony/console`).
- Fixtures: ambos extraen correctamente namespace, `use` (agrupados y alias), clases, interfaces, traits, enums, métodos con visibilidad y rangos de líneas. Con el archivo roto, tree-sitter conserva más símbolos (recupera el método posterior al error); php-parser lo pierde.
- Código propio de `tjc-be-php-repo-test/app` (29 archivos): 0 errores con tree-sitter.

## Implicaciones para la implementación

- Cargar `tree-sitter-php.wasm` con `require.resolve`; inicializar `Parser.init()` una vez por proceso (en `onModuleInit`).
- Llamar `tree.delete()` tras cada archivo (memoria WASM).
- `tree.rootNode.hasError` no invalida el archivo: se extraen los símbolos válidos y se registra el conteo de errores como evidencia.

## Hallazgo lateral

`composer:2` usa PHP 8.5; un `composer.lock` resuelto ahí exige PHP ≥ 8.4.1 y falla en `php:8.3-cli` (imagen por defecto del Sandbox) con un error de plataforma. `tjc-be-php-repo-test` fija `config.platform.php = 8.3.0`. Los repositorios reales con locks resueltos en PHP más nuevo producirán `DEPENDENCY` en el Sandbox: conviene que el prompt/Check lo explique y que el Sandbox permita elegir imagen según `require.php`.
