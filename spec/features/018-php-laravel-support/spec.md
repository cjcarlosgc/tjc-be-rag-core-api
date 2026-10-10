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

**Estado:** APROBADO e implementado (revisión humana APPROVED, 2026-10-09). El usuario levantó el diferimiento de WI-CORE-013/028/029 con acuerdo del otro desarrollador; se trabaja en `feature/php-core` desde `feature/jean`.
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

## WI-CORE-032 — Construcciones de comportamiento PHP para ACTION_REQUIRED (ST-CORE-039)

**Estado:** APROBADO por el usuario (2026-10-09). Depende de WI-CORE-013 (aprobado).

### Hallazgo

DEC-FK-003/004 (spec 013) definen la activación de `ACTION_REQUIRED` en términos independientes del lenguaje: target `METHOD`/`FUNCTION` `DIRECTLY_CHANGED`, sin regla `ACTIVE` aplicable, cuando el diff introduce o modifica una ramificación, un `throw` o una transición o escritura de estado. La implementación (`SymbolBehaviorConstructsService`, `FunctionalContextEvaluator`, `behavior-fingerprint.ts`) solo la calcula para TypeScript (ts-morph); un Run PHP nunca hace preguntas funcionales.

### Reglas

1. **Paridad de reglas.** Para PHP se aplican exactamente las mismas cuatro categorías V1 y la misma comparación base/HEAD por huella (`diffBehaviorConstructs`, `scenarioKeyFor` sin cambios). Solo cambia el extractor.
2. **Extractor PHP (tree-sitter, mismo parser aprobado en DEC-PHP-AST-001).** Dentro del cuerpo del método o función que identifica `qualifiedName` (`Namespace\Clase.metodo` o `Namespace\funcion`):
   - `if_statement` y `else_if_clause` → `BOUNDARY` si la condición contiene `<`, `<=`, `>` o `>=`; si no, `EXPECTED_RESULT`.
   - `conditional_expression` (ternario) → misma regla que `if`.
   - `switch_statement` y `match_expression` → misma regla aplicada al discriminante, con las etiquetas de los casos en la forma.
   - `throw_expression`/`throw_statement` → `EXCEPTION`.
   - Asignación simple o compuesta (`assignment_expression`, `augmented_assignment_expression`) y `++`/`--` (`update_expression`) cuyo destino sea estado → `STATE_TRANSITION`. Estado = acceso a miembro (`$this->x`, `$obj->x`), propiedad estática (`self::$x`, `static::$x`) o subíndice de un destino de estado. Una variable local (`$x`) no es estado, igual que una variable declarada dentro del símbolo en TypeScript.
   - No cuentan las llamadas a métodos, `??` ni `?:` abreviado (paridad con TypeScript).
3. **Forma normalizada.** Estructura del AST sin comentarios ni espacios; literales por valor; variables declaradas dentro del cuerpo (incluidos los parámetros de closures anidadas, excepto `$this`) reemplazadas por marcadores posicionales en orden de aparición; los parámetros propios del símbolo quedan literales, igual que en TypeScript (corrección de paridad registrada en la implementación, 2026-10-09); `formHash` = SHA-256 de la forma; `snippet` = texto colapsado a una línea, máximo 160 caracteres. Mismo contrato `BehaviorConstruct` que TypeScript.
4. **Elegibilidad.** `qualifiesForBehaviorConstructs` e `isBehaviorTarget` aceptan `language` `TYPESCRIPT` o `PHP`. TypeScript no cambia; sus pruebas existentes deben seguir pasando sin modificaciones.
5. **Determinismo.** Mismo código → misma huella y misma `scenarioKey`; un cambio solo de formato o comentarios no crea preguntas nuevas.

### Consecuencia para el piloto (registrada, sin decisión de producto)

Con esta regla determinista, un target sin ramificaciones, `throw` ni escrituras de estado no activa `ACTION_REQUIRED`, aunque su caso sea F. En el piloto, el usuario decidió (2026-10-09) reseembrar SUB-3 con una ramificación (`5935e81`), de modo que los tres casos F (SAL-2, RES-3, SUB-3) tienen construcciones y pueden activar `ACTION_REQUIRED`.

## WI-CORE-028 — Relaciones estructurales PHP R-PHP1 a R-PHP5 en el retrieval SE

**Estado:** APROBADO por el usuario (2026-10-09), con R-PHP3 exigiendo la mención del nombre corto. Depende de WI-CORE-013 (aprobado).
**Contrato:** INTEROP-2.7 §6.15 ya define `StructuralRelation` con las cinco relaciones; este WI las implementa y retira el `422` PHP **solo** en la comparación de retrieval. Los experimentos siguen respondiendo `422` para PHP hasta WI-CORE-029.

### Hallazgos

1. `RetrievalService.resolveStructuralMatches` solo resuelve imports relativos de TypeScript; para PHP el modo SE se comporta como SEM.
2. El chunk PHP ya trae lo necesario: `symbolName`/`parentSymbolName` cualificados por namespace y `importsUsed` con los FQCN de las declaraciones `use` que el chunk menciona.
3. El tipo interno `StructuralMatch` y el contrato de trazas de contexto (`RagMatchedVia`, `RagCandidateNodeResponse.structuralMatch`) solo admiten `IMPORTS`/`IMPORTED_BY`, y `context-traces.service.ts` descarta otros valores. Los Runs PHP (WI-CORE-013) ya producen trazas.
4. `retrieval-comparisons.service.ts` responde `422 UNSUPPORTED_PROJECT` para PHP (DEC-RC-001, "hasta que WI-CORE-028 lo retire").

### Reglas (DEC-PHP-RET-001, APROBADA)

Notación: `A` = chunk ancla (target); `C(A)` = FQCN de la clase que declara el target (`parentSymbolName`), o `null` si es una función; `ns(X)` = namespace de un FQCN; para un candidato `K`, `O(K)` = `K.parentSymbolName`, o `K.symbolName` si `K` es una declaración de clase, interfaz, trait o enum. Se excluye siempre el propio símbolo.

- **R-PHP1 `IMPORTS`:** `O(K)` está en `A.importsUsed` (el target usa una clase importada con `use`).
- **R-PHP2 `IMPORTED_BY`:** `C(A)` está en `K.importsUsed` (el candidato importa la clase del target).
- **R-PHP3 `SAME_NAMESPACE`:** `O(K) ≠ C(A)`, `ns(O(K)) = ns(A)` y el contenido de `A` menciona el nombre corto de `O(K)` como palabra completa (referencia no cualificada que PHP resuelve en el mismo namespace). **Recomendación del leader:** exigir la mención. La alternativa literal ("cualquier clase del mismo namespace") agrega todos los miembros del namespace como candidatos sin evidencia de uso.
- **R-PHP4 `FULLY_QUALIFIED_REFERENCE`:** el contenido de `A` contiene `\` + `O(K)` (nombre totalmente cualificado con barra inicial). Un nombre con `\` sin barra inicial dentro de un namespace es relativo en PHP, así que no cuenta.
- **R-PHP5 `DECLARING_CLASS`:** `K` es la declaración (todas sus partes) de la clase, trait o enum `C(A)`.
- **Una sola etiqueta por candidato:** si aplican varias, se registra la primera en el orden R-PHP1 → R-PHP5. La señal estructural del ranking es la misma para todas (`0.7·semántico + 0.3·estructural`, sin pesos por relación).
- **Despacho por lenguaje:** los chunks TypeScript conservan exactamente su resolución actual.
- **Contrato de trazas (aditivo):** `RagMatchedVia` y `RagCandidateNodeResponse.structuralMatch` admiten además `SAME_NAMESPACE`, `FULLY_QUALIFIED_REFERENCE` y `DECLARING_CLASS`; `context-traces.service.ts` los acepta. Contract Sync a Console (Context Explorer debe tolerar y etiquetar los valores nuevos).
- **Comparación OE2:** se retira el `422` PHP solo en `POST /retrieval-comparisons`; el texto de §6.15 se actualiza.

## WI-CORE-029 — OE5 con PHP/PHPUnit

**Estado:** PROPUESTO para aprobación humana (2026-10-09). Dependencias cerradas: WI-CORE-013, WI-CORE-025 y WI-CORE-028 (aprobados).
**Contrato:** INTEROP-2.7 §6.5/§6.5.1 (experimentos). Se retira el `422 UNSUPPORTED_PROJECT` para proyectos PHP con PHPUnit; Contract Sync a Console.

### Hallazgos

1. `ExperimentsService` responde `422 UNSUPPORTED_PROJECT` si `detectedFramework` no es Jest/Vitest; `ExperimentJobHandler` además lanza si la versión es PHP.
2. La ruta del test usa `coLocatedSpecPath` o el primer test existente y fusiona con ts-morph (`TestFileMergeService`).
3. El brazo RAG construye el contexto y el prompt sin lenguaje; las instrucciones del agente generalista dicen "TypeScript" y "Jest o Vitest".
4. `inspect_symbol` del agente generalista solo analiza `.ts`/`.tsx` (ts-morph). `list_files`, `read_file` y `search_text` ya incluyen archivos PHP (`isPoolFile`).

### Reglas

1. **Elegibilidad.** Se admite un experimento sobre un proyecto PHP si `detectedFramework = PHPUNIT`; el runner persistido es `PHPUNIT` y el perfil `PHP_LARAVEL_PHPUNIT`. PHP sin PHPUnit sigue con `422 UNSUPPORTED_PROJECT`. Se conserva la precedencia actual de validaciones (§6.5.1).
2. **Mismas condiciones para ambos brazos (Tabla 65 de la tesis).** Ruta del test por DEC-PHP-GEN-001 (archivo nuevo por target, siempre `CREATED`, sin fusión), saneamiento con `sanitizeGeneratedPhp` y el mismo Sandbox. Una respuesta sin `<?php` es un resultado técnico desfavorable de la estrategia (`TECHNICAL`/`COMPILATION`, sin reintento), no un fallo externo.
3. **Brazo RAG.** `ContextBuilder` con `language: 'php'` y `framework: 'PHPUNIT'`; prompt PHP con el namespace y la ruta del test (WI-CORE-013). Functional Knowledge `ACTIVE` aplicable igual que en TypeScript (ADR-09).
4. **Brazo GENERALIST_AGENT.** Instrucciones equivalentes en semántica a las de TypeScript pero para PHP/PHPUnit 11 (archivo completo con `<?php`, namespace y ruta indicados, `Tests\TestCase` solo si el código usa Laravel). Mismas herramientas, presupuesto y tope de llamadas.
5. **`inspect_symbol` para PHP (paridad de herramientas).** Busca con tree-sitter la declaración de clase, interfaz, trait, enum o función con ese nombre corto en los archivos `.php` del pool, devuelve su texto y líneas, y las referencias por palabra completa en otros archivos, con el mismo formato de resultado y observaciones que TypeScript. Sin shell, Composer ni PHPUnit.
6. **TypeScript sin cambios** en ambos brazos.
