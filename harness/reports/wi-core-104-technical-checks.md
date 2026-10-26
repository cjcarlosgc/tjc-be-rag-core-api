# WI-CORE-104 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium
Implementación: subagente `implementer-high` (configurado claude-sonnet-5-5, atendido claude-sonnet-5-5 según su informe).

## Verificación independiente del leader (desde `app/`, 2026-10-25, tras el último cambio del implementer)
- `corepack pnpm@12.14.0 lint`: sin hallazgos (exit 0).
- `corepack pnpm@12.14.0 build` (prisma generate + nest build): exit 0.
- `corepack pnpm@12.14.0 contracts:check`: limpio (sin cambio de `schemas/` ni de `generated/`).
- `vitest run` (sin base de datos; los `*.pg.spec.ts` se omiten): 192 archivos pasan y 10 se omiten; 3 363 pruebas pasan y 121 se omiten; 0 fallos (antes de WI-104: 3 283; +80).
- `node scripts/sdd-check.mjs`, `harness/validate-work-items.mjs` y `harness/validate-harness.mjs`: en verde.
- El implementer reportó 50 errores de `tsc --noEmit` solo en `*.spec.ts` preexistentes (mismo número antes y después, ninguno en código de producto ni en sus specs).

## Cambio (app/src)
- `retrieval/php-dependency-context.ts`: `MAX_PHP_DEPENDENCY_TOKENS` 300 → 500; `extractPhpConstructorVisibility`, `extractPhpPublicStaticFactories`; render de constructor no público (sin firma, marca de `final` sin «con new»); `buildPhpFqcnGlossary` (excluye FQCN sin namespace, dependencias ya listadas y la clase declarante; tope 30), `renderPhpFqcnGlossary`, `capPhpDependencySection` (recorte: glosario, fábricas, firmas/profundidad 2, entradas), `composePhpDependencySection`; `PhpDependencyEntry` gana `constructorVisibility?` y `factories?` (internos).
- `retrieval/php-dependency-context.service.ts`: visibilidad desde el chunk `CONSTRUCTOR` y fábricas (máximo 4, orden por nombre; excluye `__*`, exige `public static`, no `abstract`) solo en dependencias directas confirmadas como `CLASS` con constructor `private`/`protected`; un error de la consulta de fábricas no se propaga.
- `project-versions/persistence/code-chunks.repository.ts`: consulta de solo lectura `findPhpStaticMethodDeclarations` (chunks `METHOD` PHP con `static`, `take` 400).
- `retrieval/generation-context.ts` y `context-builder.service.ts`: `ContextChunk.importsUsed?` interno, copiado en `appendChunk`; no sale por el prompt (solo `content`) ni por la traza (se construye desde `audit.candidates`).
- `generation/test-generation-pipeline.ts`: `withPhpFqcnGlossary` en `acquireGenerationContext`, solo PHP; con glosario vacío devuelve el mismo objeto; la suficiencia se evalúa sobre el contexto final.
- `experiments/experiment-attempt-presenters.ts`: `dependencyContext` también se persiste con `tokenCount > 0` (glosario sin entradas) — necesario para `entries: []`.
- Sin cambio de ranking, `topK`, capa de contexto, DTO de trazas, rutas, esquema JSON ni migración; el agente generalista no recibe la sección.

## Pruebas y sanidad de mutaciones (reportadas por el implementer; suite reproducida por el leader)
78 pruebas nuevas más 2 del ajuste final: visibilidad y fábricas (`php-dependency-context.constructor-visibility.spec.ts`), servicio con repositorio simulado (`…service.constructor-visibility.spec.ts`), glosario y composición (`php-fqcn-glossary.spec.ts`), pipeline con los escenarios money-c3 (`AutoContext → Brick\Money\Context\AutoContext`) y money-c2 (`Money` final con constructor privado y fábricas `of`/`zero`, sin «con new») y con TypeScript/«sin imports nuevos» por igualdad de referencia (`test-generation-pipeline.fqcn-glossary.spec.ts`), builder, presenter, `context-traces.service` (acepta `entries: []` con `tokenCount > 0`) y repositorio (prisma simulado). Las pruebas existentes solo cambian la cifra del tope (300 → 500) en tres specs; las que pasan 300 explícito a `applyDependencyTokenCap` se dejan. Mutaciones detectadas: ignorar la visibilidad (10 pruebas), quitar el filtro de retorno de fábricas (4), quitar la exclusión de dependencias del glosario (3), no recortar el glosario primero (5), tope 400/600 (2 y 2), «con new» en constructor privado (3), `importsUsed` en la traza (1) o en el prompt (1), composición también en TypeScript (1), y quitar el filtro de FQCN sin namespace (2).

## Hallazgo del leader durante la revisión del diff
El contrato decía que el objeto `dependencyContext` se omite si no hay entradas ni no resueltos: con glosario sin dependencias existe con `entries: []`; se reconcilió en INTEROP-2.23 (la regla de omisión menciona ahora el resto del contenido y `tokenCount`).

## Incidente declarado por el implementer
Ejecutó `git stash` y `git stash pop` seguidos para contar errores de `tsc` en la base; el leader verificó que no queda stash y que los archivos tracked del leader (CHANGELOG, harness, spec) siguen intactos. Se le prohibió repetirlo.

## Límites
Sin ejecución contra GitHub, Integration, Sandbox, OpenAI ni base de datos reales (la consulta nueva solo se probó con prisma simulado; los `*.pg.spec.ts` no se ejecutan sin base de datos). Límites declarados: `importsUsed` guarda el `moduleSpecifier` sin alias (`use A\Foo as Bar` se muestra `Foo → A\Foo`); la consulta de fábricas se corta en 400 resultados; el prefiltro `contains: 'static'` distingue mayúsculas; los topes (500, 4 fábricas, 30 del glosario) se calibran solo con `smoke-*` (D-v2-2).
