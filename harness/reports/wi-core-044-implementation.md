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
