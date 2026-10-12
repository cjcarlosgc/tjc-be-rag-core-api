# WI-CORE-044 — Implementación (constructor sin chunk, símbolos de archivos de test y ruta PHP duplicada)
Modelo: implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

Cortes 1 y 2 por `implementer` (Haiku 5.5 / low), en paralelo con archivos disjuntos; los commits y las verificaciones las hizo el leader. Alcance y límites: `wi-core-044-scope-approval.md`; análisis: `wi-core-044-sdd-verification.md`. No se ejecutó `build` en `app/` (protege el Core local E2E en vivo).

## Commits
- `4811825` corte 1 (CONSTRUCTOR): `CodeChunksRepository.findBySymbol` acepta `string | readonly string[]` (con lista usa `{ in: [...] }`); `RetrievalService.retrieve` busca `['METHOD', 'CONSTRUCTOR']` para objetivos de método y `'FUNCTION'` sin cambio. Archivos: `code-chunks.repository.ts`, `retrieval.service.ts`, `retrieval.service.spec.ts` y nuevo `code-chunks.repository.spec.ts`.
- `8bea14c` corte 2 (símbolos de test): nuevo `test-source-path.util.ts` (`isTestSourcePath(filePath, language?)`) y su spec (39 casos) y `analysis-run-validation-job.handler.ts` (+ import y `&& !isTestSourcePath(symbol.filePath, language)` en el filtro `candidates`) con 3 pruebas nuevas.

## Evidencia rojo → verde
- **Corte 1:** `npx vitest run src/retrieval/retrieval.service.spec.ts src/project-versions/persistence/code-chunks.repository.spec.ts` antes del arreglo: 4 fallos (los dos constructores PHP `__construct` y TS `constructor` lanzaban «No se encontró un chunk indexado…»); después: 28/28.
- **Corte 2:** `npx vitest run src/validation/test-source-path.util.spec.ts src/validation/analysis-run-validation-job.handler.spec.ts` antes: 3 fallos más el módulo inexistente; después: 75/75; `oxlint` 0.

## Verificación del leader (sobre el árbol con los dos cortes)
- `npx vitest run` completo: 140 archivos pasan / 6 omitidos; 2137 pasan, 104 omitidos.
- `npx oxlint src/ test/`: 0.
- `npx tsc --noEmit -p tsconfig.json`: **45** errores en un worktree desechable limpio de `HEAD` (`bd1eaff`, con `prisma generate`) y **45** con los cortes; los conteos por archivo son idénticos (17 archivos): el WI no añade errores. La línea base de 43 quedó atrás por cambios de otras sesiones; el delta de 044 es 0.
- No se ejecutó `pnpm build`/`nest build`; no se tocó el Core local, cloudflared, la VM, `app/.env` ni Supabase.

## Defecto 3 (ruta PHP duplicada)
No es un defecto separado: `phpTestLocation` conserva la ruta completa fuera de `app/` (DEC-PHP-GEN-001) y la duplicación `tests/Unit/tests/Unit` solo aparece cuando un archivo de test llega a ser objetivo; se corrige en la raíz con el corte 2. `php-test-path.ts` y DEC-PHP-GEN-001/002 no se tocan.

## Riesgos de regresión
- **Constructores ya indexados / versiones ya indexadas con símbolos sin chunk:** el chunk key persistido no cambia y la búsqueda ahora alcanza los chunks `CONSTRUCTOR` ya guardados; **no hace falta reindexar**.
- **Colisión METHOD/CONSTRUCTOR:** si un archivo tuviera un `METHOD` y un `CONSTRUCTOR` con el mismo `symbolName` y `parentSymbolName`, `targetChunks[0]` mezclaría partes (ordena solo por `partIndex`); en la práctica `__construct`/`constructor` no coexisten con un método homónimo. Registrado como observación.
- **Cobertura de `existingTargets` (`findMatchingTestTarget`):** el empareo usa `targetType`/`methodName` del `TestTarget`, no `symbolKind` de chunks; un constructor se empareja como `METHOD` con `methodName` `__construct`/`constructor`, sin cambio.
- **Evidencia 027:** la sección `retrieval`/`context` de un constructor, antes ausente por `UNRESOLVABLE_TARGET`, ahora puede existir; sin cambio de forma.
- **Símbolos de test:** siguen en `analysis_symbols` y los ven el trace, la evidencia, los experimentos, la comparación OE2 y el evaluador funcional (un método de test con ramas podría originar una pregunta `ACTION_REQUIRED`); extenderlo es una decisión aparte del usuario.

## Ampliación: los tres riesgos menores de la revisión independiente (ciclo 1) — cortes 3, 4 y 5
Orden del usuario en chat («corrige los 3 riesgos menores y pásale un review más»). Cada corte con rojo primero y verde después, por `implementer` (Haiku 5.5 / low), sin build en `app/`.

| Corte | Commit | Riesgo | Cambio | Rojo → verde |
|---|---|---|---|---|
| 3 | `f1c4088` | Colisión METHOD/CONSTRUCTOR homónimos | `selectWinningSymbolKindChunks` en `retrieval.service.ts`: METHOD si existe; si no, el kind del primer chunk; ancla y `targetChunks` solo de ese kind, por `partIndex`; `findBySymbol` no cambia | «expected ['ctor-1','method-1','method-2'] to deeply equal ['method-1','method-2']» → `src/retrieval` 141 pasan |
| 4 | `6c44dbb` | `isTestSourcePath` global y asimétrico | firma `(filePath, language?, projectRoot = '.')`: PHP `tests` solo como primer segmento relativo al projectRoot o `*Test.php`; TS/JS `.spec`/`.test`, `__tests__` en cualquier segmento y `tests`/`test` solo como primer segmento; el validador pasa `version.effectiveProjectRoot` | 17 fallos → 99/99 |
| 5 | `14af3e1` | Símbolos de test visibles al evaluador funcional | el evaluador excluye `isTestSourcePath(symbol.filePath, language, projectRoot)` con `effectiveProjectRoot` de la versión (fallback `'.'`); `FunctionalKnowledgeModule` importa `ProjectVersionsModule` (sin ciclo: el e2e arranca) | 5 fallos → 28/28 |


Decisiones del corte 4 confirmadas: `tests/Unit/FooTest.php` con projectRoot `backend` cuenta como test por el sufijo `*Test.php`; `__tests__` aplica en cualquier posición, también fuera de la raíz.

### Verificación del leader (HEAD con los cortes 1 a 5)
- `npx vitest run` completo: 140 archivos pasan / 6 omitidos; 2170 pasan, 104 omitidos.
- `npx oxlint src/ test/`: 0.
- `tsc --noEmit -p tsconfig.json`: 45 en un worktree limpio de `bd1eaff` (con `prisma generate`) y 45 con los cortes; conteos por archivo idénticos (delta 0).
- e2e (`vitest.config.e2e.ts`, DB inalcanzable): 7 archivos, 246 pasan (arranque de módulos Nest, sin ciclo).
- `validate-harness` pasa; `harness/*.test.mjs` 31/31. Sin `build`, Core local, cloudflared, VM, `app/.env` ni Supabase tocados.

### Qué sigue viendo símbolos de test (contrato)
`analysis_symbols` no cambia: el trace (§6.16 `targets` = símbolos `DIRECTLY_CHANGED` METHOD/FUNCTION), la evidencia 027, los experimentos y la comparación OE2 siguen viendo los símbolos de archivos de test, porque su contrato lo exige tal cual; excluirlos ahí tocaría el contrato (decisión aparte). Un Run cuyos únicos símbolos con construcciones son de test queda `actionRequired: false` y sigue `NO_TEST_RELEVANT_CHANGES`.
