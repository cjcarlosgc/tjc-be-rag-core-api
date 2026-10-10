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

## WI-CORE-013 — Generación y validación PHPUnit (ST-CORE-020)

**Estado:** PROPUESTO para aprobación humana (2026-10-09). El usuario levantó el diferimiento de WI-CORE-013/028/029 con acuerdo del otro desarrollador; se trabaja en `feature/php-core` desde `feature/jean`.
**Contrato:** INTEROP §7 (Core↔Sandbox). Coordinación recibida: `CS-SANDBOX-20261009-001` (Sandbox `feature/php-profile`, corte T-003).

### Hallazgos del análisis (código al 2026-10-09, `777f6bc`)

1. `AnalysisRunValidationJobHandler` termina todo Run PHP en `TECHNICAL_GENERATION_FAILURE` ("pendiente de WI-CORE-013").
2. `PromptBuilder`, `coLocatedSpecPath` y `TestFileMergeService` asumen TypeScript (`.spec.ts`, ts-morph); `GenerationContext.metadata.language` es siempre `typescript`.
3. `EXECUTION_PROFILE_BY_RUNNER` solo conoce Jest/Vitest; `sandbox.types.ts` no declara `PHPUNIT` ni `TestCaseFact.failureKind`.
4. `mapSandboxResult` clasifica todo test fallido compilado y ejecutado como `TEST_ASSERTION`, que la validación convierte en `BEHAVIORAL_MISMATCH`, aunque el fallo sea un error técnico (clase o método inexistente).
5. Fuera de este WI: `ACTION_REQUIRED` (DEC-FK-003/004) solo calcula construcciones de comportamiento para TypeScript, los experimentos y la comparación de retrieval responden `422` para PHP, y el retrieval estructural PHP no existe (WI-CORE-028).

### Reglas

1. **Elegibilidad.** Se genera para símbolos PHP `DIRECTLY_CHANGED` `METHOD`/`FUNCTION` sin test existente, solo si `detectedFramework = PHPUNIT`. Pest no se atribuye. Un proyecto PHP sin PHPUnit deja la propuesta `HELD` con motivo explícito (igual que hoy sin Jest/Vitest).
2. **Contexto y prompt por lenguaje.** `GenerationContext.metadata` lleva `language: 'typescript' | 'php'` y `framework: 'JEST' | 'VITEST' | 'PHPUNIT' | null`. Para PHP el prompt pide un archivo PHPUnit 11 completo (`<?php`, `declare(strict_types=1)` opcional, namespace del test, `use` de las clases del proyecto). Extiende `Tests\TestCase` solo si el target usa el contenedor de Laravel (helpers como `config()` o facades); si no, `PHPUnit\Framework\TestCase`. Retrieval y reglas funcionales se presentan igual que en TypeScript. Si la respuesta trae fences de markdown, se retiran; un contenido sin `<?php` es fallo técnico de generación.
3. **Ubicación del test (DEC-PHP-GEN-001, PROPUESTA).** Un archivo nuevo por target, nunca se fusiona con tests existentes en V1: `tests/Unit/<ruta relativa bajo app/ sin .php>` + `<Método en PascalCase>Test.php`, con namespace `Tests\Unit\<subnamespace>`. Ejemplo: `app/Pricing/PremiumDiscountPolicy.php#discountFor` → `tests/Unit/Pricing/PremiumDiscountPolicyDiscountForTest.php`. Para archivos fuera de `app/` se usa la ruta relativa completa bajo `tests/Unit/`. Si el path ya existe en el snapshot, se agrega el sufijo `Generated`. Es siempre `CREATED`.
4. **Ejecución.** Core envía `executionProfile: PHP_LARAVEL_PHPUNIT` y `runnerHint: PHPUNIT`. `phase` no se envía en este WI: el Sandbox T-003 ya usa por defecto `GENERATED_TESTS` (solo ejecuta los artefactos) y un Sandbox anterior lo rechazaría. Enviar `phase` llega con el baseline real.
5. **Clasificación con `failureKind` (DEC-PHP-GEN-002, PROPUESTA).** `mapSandboxResult` usa `TestCaseFact.failureKind` cuando existe: si algún caso fallido es `ERROR` → `TEST_RUNTIME` (fallo técnico); si todos los fallidos son `ASSERTION` → `TEST_ASSERTION` (candidato a `BEHAVIORAL_MISMATCH`). Sin `failureKind` se conserva la regla actual. Aplica también a TypeScript y a los experimentos, cuyo `failureType` puede cambiar de `TEST_ASSERTION` a `TEST_RUNTIME`; `valid` no cambia.
6. **Contrato canónico.** INTEROP §7.3 incorpora `TestCaseFact.failureKind: 'ASSERTION' | 'ERROR' | null` (aditivo), la tolerancia transitoria de `phase` opcional en el Sandbox y la semántica de selección de `GENERATED_TESTS`, y §7.4 los códigos `TEST_COMPILATION_FAILED`/`COMPILATION` e `IMAGE_UNAVAILABLE`/`INFRASTRUCTURE`. Se publica Contract Sync a Console y Sandbox para los espejos.

### Fuera de este WI (WIs propuestos)

- **WI-CORE-032 (nuevo):** construcciones de comportamiento PHP (tree-sitter) para que DEC-FK-003/004 activen `ACTION_REQUIRED` también en PHP. Lo necesitan los casos F del piloto.
- **WI-CORE-028:** relaciones estructurales PHP R-PHP1 a R-PHP5 en el retrieval SE (OE2).
- **WI-CORE-029:** OE5 con PHP: levantar el `422` de experimentos, herramientas del agente generalista para PHP y prompt PHP en el brazo RAG.
- Baseline real con `phase=BASELINE` (requiere decisión contractual sobre cómo nombrar los tests relevantes).
