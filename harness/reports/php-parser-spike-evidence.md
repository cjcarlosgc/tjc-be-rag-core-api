# Evidencia técnica de decisión: parser PHP

**Procedencia:** PR [#6](https://github.com/cjcarlosgc/tjc-be-rag-core-api/pull/6), head `cfce98d77170a48ee4ab57e13ee4d721576a6e36`, originalmente `harness/reports/T-005-php-ast-spike.md`.
**Estado Harness vigente:** insumo asociado a `DEC-PHP-AST-001`, decisión aprobada por el usuario para el trabajo actual de PHP. Los resultados numéricos del benchmark siguen siendo reportados por el autor del PR y no se reproducen independientemente aquí; no se usan como criterio de rendimiento ni como evidencia de aceptación del producto.

## Método reportado

- Fixtures PHP 8.3 con namespaces, imports, clases, atributos, enums, traits, `match`, nullsafe, PHPUnit y un archivo con error sintáctico.
- Corpus Laravel 13.17 / PHPUnit 12.5, con `vendor/` completo y 8.048 archivos PHP (se excluyeron Blade); el entorno reportado fue Node 20 sobre Apple Silicon.
- Comparación de `web-tree-sitter@0.25.10` + `tree-sitter-php@0.24.2` frente a `php-parser@3.7.0` con `php8: true`.

## Resultados reportados

| Opción | Archivos con error | Tiempo acumulado | Sintaxis PHP 8.4 |
| --- | ---: | ---: | --- |
| `web-tree-sitter` + `tree-sitter-php` (WASM) | 4/8.048 (0,05 %) | 3,7 s | Sí |
| `php-parser` (glayzzle) | 10/8.048 (0,12 %) | 2,4 s | No |

El reporte atribuye los errores restantes de tree-sitter a casos aislados de interpolación, constantes tipadas y sintaxis en dependencias; ambos parsers extrajeron las construcciones principales de los fixtures. Para un archivo roto, tree-sitter conservó más símbolos posteriores al error. El repo de prueba reportó cero errores en sus 29 archivos propios.

## Límites y uso en el Harness vigente

- La aprobación fija parser y gramática, no afirma que el benchmark haya sido reproducido. La aceptación del WI se basa en pruebas de comportamiento de Core (sintaxis, recuperación parcial, símbolos y regresión), no en repetir esos tiempos/cifras.
- El reporte también advierte que locks resueltos con PHP más nuevo pueden ser incompatibles con el runtime PHP 8.3 del Sandbox. Es una observación para el dueño de Sandbox; no autoriza cambios desde este WI.
- `T-005`, `HU41`/`HU42` y las fases del PR se conservan únicamente como procedencia histórica; el trabajo vigente se planifica mediante `ST-CORE-019`/`WI-CORE-012` y `ST-CORE-020`/`WI-CORE-013`, ligados a HU03/HU04 y HU10/HU11.
