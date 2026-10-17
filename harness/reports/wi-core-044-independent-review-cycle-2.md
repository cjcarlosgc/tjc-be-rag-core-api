# WI-CORE-044 — revisión independiente, ciclo 2 de 2
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Modo:** fuera de casa (awayMode) · **Rango:** `bd1eaff..HEAD` (cortes 1 `4811825`, 2 `8bea14c`, 3 `f1c4088`, 4 `6c44dbb`, 5 `14af3e1`, más docs) · **Veredicto:** APPROVED (no sustituye la aprobación del usuario ni declara `W-DONE`).

## status
APPROVED. Sin blockers ni importantes. Los tres riesgos del ciclo 1 quedaron corregidos, cada uno con prueba que falla sin el arreglo. Tres observaciones menores nuevas.

## Verificación
(a) **Riesgos del ciclo 1, mutaciones en worktree desechable de HEAD.**
- Colisión METHOD/CONSTRUCTOR: `winningTargetChunks = targetChunks` (sin selección) → falla 1 prueba («uses only the METHOD parts…»); «primer kind gana» en vez de METHOD preferido → falla la misma prueba.
- projectRoot: `rootSegments = splitPath('.')` → fallan 8 pruebas de `test-source-path.util.spec.ts`.
- Evaluador funcional sin la exclusión → fallan 5 pruebas del bloque «exclusión de archivos de test (corte 5)».
- `findBySymbol` `{ in }` → igualdad: falla 1 prueba del repositorio.
(b) **`selectWinningSymbolKindChunks`.** METHOD si hay algún METHOD; si no, el kind del primer chunk (solo CONSTRUCTOR es posible, la búsqueda es `['METHOD','CONSTRUCTOR']`); filtra por kind y ordena por `partIndex` (partes múltiples del kind ganador, ancla = primera parte, `partsTotal` del ganador). `FUNCTION` sigue con string y no pasa por la mezcla. Pruebas: colisión, solo CONSTRUCTOR multi-parte, solo METHOD sin cambio, FUNCTION intacto. Correcto.
(c) **`isTestSourcePath`.** Normaliza `.`, `''`, `./backend`, `backend/`, `./backend/`; relativiza al projectRoot; PHP: `tests` (minúscula) solo como primer segmento relativo o sufijo `Test.php`; TS: sufijos `.spec|.test`, `__tests__` en cualquier posición, `tests`/`test` solo primer segmento relativo. Sin falsos positivos: `app/Tests/`, `src/tests/` de producción, `backend/src/tests/`, `TestimonialService.php`. `tests/TestCase.php` bajo la raíz queda excluido. Consecuencia: con projectRoot `.` un `packages/x/tests/Helper.php` ya no se excluye (solo `*Test.php`); y un `tests/` fuera del projectRoot no se excluye por directorio (por diseño; ese archivo no entra al pool del proyecto).
(d) **Evaluador funcional.** Inyecta `ProjectVersionsRepository`; `ProjectVersionsModule` (importa solo `ProjectAccessModule`, exporta el repositorio) se añade a `FunctionalKnowledgeModule`: sin ciclo; el evaluador solo se provee en ese módulo. Sin `projectVersionId` o sin versión cae a `'.'`. El filtro vive solo en `evaluate`; el diff no toca `analysis_symbols`, construcciones persistidas, trace, evidencia 027, experimentos ni OE2. Un Run con solo símbolos de test sigue en `NO_TEST_RELEVANT_CHANGES` (rama existente del validador; `candidates` vacío).
(e) **DEC-PHP-GEN-001/002.** `php-test-path.ts`, `spec/` y `prisma/` sin cambios en el rango.
(f) **Gates.** `npx vitest run src/retrieval src/validation src/functional-knowledge src/snapshot-intelligence` (DATABASE_URL/DIRECT_URL dummy, worktree HEAD con `prisma generate`): 27 archivos pasan, 1 omitido; 468 pruebas pasan, 9 omitidas. `tsc --noEmit` en worktrees desechables de `bd1eaff` y HEAD: 45 errores / 17 archivos en ambos; delta por archivo 0.
(g) **Harness.** `validate-harness`: passed; `harness/*.test.mjs`: 31 pruebas, 0 fallos. WI-CORE-044 `W-IN_REVIEW`, `ST-CORE-051`, `contractImpact=false`, scope approval enlazado. Cinco commits de código y los docs llevan `Refs: HU05, HU06, HU10, HU11` y trailer Co-Authored-By. Sin build; Core local, cloudflared, VM, `app/.env` y Supabase intactos; worktrees eliminados y `git status` solo muestra los .md de WI-CORE-004 ajenos.

## Findings
- Blockers: ninguno.
- Importantes: ninguno.
- Menores:
  1. **Cableado del handler no cubierto por mutación.** Cambiar `version.effectiveProjectRoot` por `'.'` en `analysis-run-validation-job.handler.ts` mantiene las 52 pruebas del handler en verde: el caso «backend/tests…» queda cubierto por el sufijo `Test.php`. Añadir un caso `backend/tests/Helper.php` (sin sufijo) haría discriminante la prueba. El util y el evaluador sí están cubiertos.
  2. **Cobertura de exclusión más estricta que en el ciclo 1.** Directorios `tests/` anidados (monorepo, projectRoot `.`) y helpers sin sufijo (`TestCase.php`) ya no se excluyen. Es el cambio pedido; sin falsos positivos, pero puede reaparecer algún helper como objetivo en proyectos con `tests/` anidado.
  3. **Registro.** `acceptanceCriteria` del WI y `spec/` no incorporan la ampliación (solo `scope-approval.md` y el reporte); aceptable por no haber cambio funcional de contrato, pero conviene consolidarlo al cerrar si el usuario lo aprueba.

## Riesgos que el usuario debe conocer
Los menores 1 y 2; símbolos de test siguen visibles para trace, evidencia 027, experimentos y OE2 (decisión explícita del contrato §6.16); no hay reindexación.

## recommendedNextStep
El usuario revisa diff y evidencia y emite el veredicto final (W-DONE). Se agotaron los 2 ciclos de revisión del agente. Sin push/PR hasta su solicitud explícita.
