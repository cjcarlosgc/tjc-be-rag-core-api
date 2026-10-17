# WI-CORE-044 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Modo:** fuera de casa (awayMode) · **Rango:** `bd1eaff..HEAD` (`4811825`, `8bea14c`, `514fef7`, `d692222`, `9d2e1d9`) · **Veredicto:** APPROVED (no sustituye la aprobación del usuario ni declara `W-DONE`).

## status
APPROVED. Sin blockers ni findings importantes. Tres observaciones menores.

## Verificación
(a) **CONSTRUCTOR.** `findBySymbol` acepta `string | readonly string[]`; con lista usa `{ in: [...] }`, con string conserva la igualdad. `retrieve` busca `['METHOD','CONSTRUCTOR']` solo para `targetType==='METHOD'`; `FUNCTION` sigue con el string `'FUNCTION'`. El chunk key persistido no cambia (sin reindexación). Único llamador de producción: `retrieval.service.ts:101`; los fakes de specs que pasan string siguen válidos (`kinds: string | readonly string[]`). `isSameSymbol` y las reglas PHP usan el `symbolKind` del propio chunk ancla, así que un ancla CONSTRUCTOR se compara consigo misma sin cambios. Mínimo y correcto.

(b) **`isTestSourcePath`.** Coincidencia por segmento completo / sufijo exacto; `TestimonialService.php`, `Contest.php`, `TestsRunner.php`, `contest.ts`, `src/latest/contest.ts` son falsos (en la spec). Los segmentos `tests`/`Tests` se buscan en cualquier posición del path relativo al repo, de modo que Laravel con `tests/` bajo un `projectRoot` queda cubierto. `tests/TestCase.php`, `tests/CreatesApplication.php` y helpers bajo `tests/` se excluyen: correcto (no son objetivos de generación). El filtro vive solo en `candidates` del validador; `analysis_symbols` y los demás consumidores no cambian (diff de código confirma que solo tocan el handler, el util y specs). Un Run con solo símbolos de test deja `candidates` vacío y cae en la rama ya existente `NO_TEST_RELEVANT_CHANGES` (prueba existente en spec línea ~795; el handler mantiene `outcomes.length===0`).

(c) **DEC-PHP-GEN-001/002.** `php-test-path.ts` y `spec/` no aparecen en el diff del rango. La ruta duplicada desaparece solo porque el archivo de test deja de ser objetivo; `phpTestLocation` no cambia.

(d) **Rojo→verde.** `npx vitest run src/retrieval src/project-versions src/validation` (DATABASE_URL/DIRECT_URL dummy): 28 archivos pasan, 1 omitido; 287 pasan, 9 omitidos. Mutaciones en worktree desechable de HEAD: (1) `{ in: [...] }` → igualdad: falla 1 prueba (`code-chunks.repository.spec.ts`); (2) quitar `!isTestSourcePath(...)`: fallan 3 pruebas del bloque «símbolos de archivos de test excluidos»; (3) `retrieve` vuelve a `'METHOD'`: fallan 3 pruebas (incluidas las dos de CONSTRUCTOR PHP/TS). Las pruebas detectan las tres regresiones.

(e) **tsc.** `npx tsc --noEmit -p tsconfig.json` en worktrees desechables de `bd1eaff` y `HEAD` (con `prisma generate` en el propio worktree): 45 errores / 17 archivos en ambos; delta por archivo = 0.

(f) **Harness.** `node harness/validate-harness.mjs`: passed; `harness/*.test.mjs`: 8 archivos, 0 fallos. WI-CORE-044 en `W-IN_REVIEW` con `contractSyncReview` NOT_RELEVANT justificado y reporte enlazado. Los cuatro commits llevan `Refs: HU05, HU06, HU10, HU11` y trailer Co-Authored-By. No se ejecutó build ni se tocó Core local, `app/.env`, Supabase; `git status` final solo muestra los .md de WI-CORE-004 ajenos.

## Findings
- Blockers: ninguno.
- Importantes: ninguno.
- Menores:
  1. **Colisión METHOD/CONSTRUCTOR homónimos** (mismo `symbolName` y `parentSymbolName`): `targetChunks[0]` ordena solo por `partIndex` y podría mezclar partes. Improbable (`__construct`/`constructor` no suelen tener homónimo); ya registrado por el implementer.
  2. **TypeScript:** un archivo bajo `tests/` o `src/tests/` sin sufijo `.spec/.test` o `__tests__` no se considera test (decisión explícita en la spec). A la inversa, un directorio PHP de producción llamado `Tests`/`tests` (p. ej. módulo `app/Modules/Tests/`) se excluiría; falso positivo posible pero poco probable.
  3. **Símbolos de test siguen visibles** al evaluador funcional (`ACTION_REQUIRED`), trace, evidencia 027, experimentos y comparación OE2; extenderlo es decisión aparte del usuario (ya declarado en alcance).

## Riesgos que el usuario debe conocer
Los puntos 1 y 3 anteriores; además, el cambio no reindexa: versiones ya indexadas recuperan constructores sin reindexar (efecto deseado), y evidencia 027 de constructores antes ausente ahora puede existir (sin cambio de forma).

## evidence
Comandos descritos en (d), (e), (f); worktrees desechables eliminados (`git worktree prune`).

## recommendedNextStep
El usuario revisa diff y evidencia y emite el veredicto final (W-DONE). Sin push/PR hasta su solicitud explícita.
