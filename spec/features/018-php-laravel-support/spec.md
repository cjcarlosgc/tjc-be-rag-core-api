# 018 — Soporte PHP/Laravel V1

**Estado:** aprobado para los cortes descritos; generación PHPUnit queda planificada.
**Épicas:** EP02 Repository Intelligence, EP04 Generation & Validation.
**Historias existentes:** HU03, HU04, HU10, HU11. No se crean HUs nuevas.
**Contrato:** SYSTEM-2.5 / INTEROP-2.6.

## Objetivo

Extender el flujo por snapshot de Core a repositorios PHP/Laravel, de modo que la estructura y las pruebas existentes sean recuperables y las pruebas nuevas puedan generarse y validarse posteriormente con PHPUnit y un profile explícito.

## Decisión de parser

### DEC-PHP-AST-001 — Parser estructural PHP

**Estado:** APROBADO por el usuario.
**Blocks:** HU03, HU04, HU10, HU11.
**Resolución:** Core usa `web-tree-sitter@0.25.10` con la gramática `tree-sitter-php@0.24.2` (WASM) para analizar PHP. Se elige por recuperación estructural y compatibilidad reportada con sintaxis PHP 8.4; el benchmark del spike se conserva como evidencia atribuida al autor, no como rendimiento reproducido independientemente. La implementación y sus pruebas de comportamiento son la evidencia de aceptación del producto.
**Evidencia:** `harness/reports/php-parser-spike-evidence.md`.

## Alcance V1

- Un snapshot se clasifica como PHP si contiene `composer.json` de raíz; esta clasificación prevalece sobre un `package.json` de raíz. En ausencia de `composer.json`, Core conserva la selección TypeScript existente.
- PHP procesa `.php`, `composer.json`, configuración PHPUnit y sus tests. Se ignoran `vendor`, `storage`, `bootstrap/cache`, `public/build`, `node_modules`, `.git`, `dist`, `build` y cobertura. Se excluye `.blade.php`, Blade embebido y JavaScript frontend.
- El índice conserva nombres cualificados por namespace, clases, traits, interfaces, enums, funciones, métodos/constructores y relaciones estructurales disponibles. Código con error sintáctico puede aportar los nodos válidos recuperados por el parser; no se inventan declaraciones.
- HU04 incorpora clases, traits, interfaces y enums al índice; los targets de test son clases, métodos públicos y funciones junto con los tests existentes reconocidos por import/uso de símbolos. `hasTest` es una asociación heurística, no una afirmación de que el test pase.
- Para los snapshots TypeScript continúa usándose el parser y detector Jest/Vitest actuales; un `ProjectVersion` guarda su `language` y nunca mezcla los dos pools.
- La respuesta pública expone `language: TYPESCRIPT | PHP` en estado, resumen, resultados e inventario; las versiones históricas se migran a `TYPESCRIPT`. `detectedFramework` admite `PHPUNIT` además de Jest/Vitest.
- Decisión aprobada de alcance de HU42 histórica: PHPUnit es el único runner PHP V1. Pest no se etiqueta como PHPUnit por depender transitivamente de éste. El profile `PHP_LARAVEL_PHPUNIT` se consume en el WI de generación/validación, sin reparación automática.

## Fuera de alcance

Laravel routes, Eloquent/provider-role específico, cobertura semántica de Pest, Blade, JS de frontend, ejecución dentro de Sandbox y cambios en Sandbox. No se importan las antiguas HU41/HU42, sus fases ni sus estados; sirven solo para trazabilidad histórica en el reporte de rebaseline.
