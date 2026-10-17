Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-063 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**Veredicto: APPROVED** (con 4 observaciones de severidad baja, no bloqueantes). Rango revisado: `222b608^..222b608` (solo `harness/calibration/` y reportes; `app/` y `harness/*.mjs` sin cambios). Revisor independiente del implementer (claude-haiku-5-5). No se accedió a la base ni a `app/.env`; no se ejecutó el extractor contra la base.

## Verificaciones ejecutadas
1. **Línea base:** `calibrate.mjs` sobre los 9 casos V1 y sobre las 6 verificaciones: 15/15 «OK linea base» (top-10 recalculado = SELECTED persistido, con orden), salida 0. En una copia con un `cands.json` alterado: «VERIFICACION FALLIDA», salida 1; con `--no-verify`, salida 0 (documentado).
2. **M5:** candidato 0.2/0.8 topK 10 y 0.5/0.5 topK 8, recomputado de forma independiente (Python) en SUB-1, SAL-1, RES-1, SUB-3, SAL-3, RES-3, SAL-2: selección, solape n/K, Jaccard y `sameOrder` coinciden (p. ej. SUB-3: mismo conjunto 10/10, distinto orden → `tenOfTen=false`; SAL-1: 7/10, J=0,54; topK 8: 8/10, J=0,8).
3. **M1:** colaboradores de `collaboratorsOf` = regex/algoritmo de `fase2-01-replay-colaboradores.py` ejecutado aparte, 0 diferencias en 15 casos; presencia en sección recomputada contra `deps.json`: coincide.
4. **M3/M4:** definiciones del README = código. M3 recomputado a mano en RES-3 (270/559 = 48,3 %). Tokenizador `cl100k_base` cargado con `createRequire` sobre `app/package.json` (no importa código de app); sus conteos igualan los persistidos (`tokenCount` y `sectionTokens`) en los 9 casos.
5. **M6:** 26 sondas propias: R-FINAL marca final (createMock, createStub, getMockBuilder, prophesize, Mockery::mock, FQ) y no marca interfaz; R-SAME marca variable `new DateTimeImmutable`/VO usada solo en `assertSame` e inline `new`, no marca pasada a constructor, valor devuelto de método, valor de llamada, reasignada ni uso en otro método; R-NS marca `use` inventado y alias inventado, no marca presente, `PHPUnit\Framework\*`, global ni `use function`. Precisión de R-FINAL recomputada a mano (trials con hit y fallos con evidencia): coincide con el informe (2/2 V1, 9/9 verificaciones; la resolución por FQCN evita falsos hits de nombre corto). Limitaciones (línea única, multilínea, sin alias/indirectas) declaradas en README e informe.
6. **M2:** `m2-template.md` solo con columnas vacías R1–R5; no puntúa.
7. **Extractor:** todas las sentencias son `SELECT` (sin INSERT/UPDATE/DELETE/DDL); `PGOPTIONS` read-only + timeout; sin `set -x` ni `echo` de la URL; aborta (65) con `--out` relativo, absoluto, `./app/...` y vía symlink dentro del repo, antes de leer `.env`; prefijos con comillas, `;`, `$()`, espacios rechazados (64).
8. **Higiene:** sin credenciales (`DATABASE_URL=`, claves, `postgres://`) en el diff; fixtures sintéticos (`Acme`), con prueba que lo verifica; informe con números agregados y nombres de clases del piloto, sin código de terceros.
9. **Pruebas:** `node --test harness/calibration/*.test.mjs` 26/26; `node --test harness/*.test.mjs` 31/31; `validate-harness` pasa. Mutantes sobre `lib.mjs` (no ordenar por combined, ignorar struct, M5 solape/Jaccard/orden, R-FINAL sin verificar final, R-SAME marcando identidad, R-NS sin excepción PHPUnit, M1 sección sin deps, M3 sin filtro de método): los 10 son detectados (1–4 pruebas fallan cada uno).

## Hallazgos
| # | Severidad | Hallazgo | recommendedNextStep |
|---|---|---|---|
| 1 | low | La URL de la base (con credencial) pasa como argumento `-d "$DB_URL"` a `psql` y es visible en `ps` (riesgo ya declarado). | Cuando convenga, pasar la conexión por `PGHOST/PGUSER/PGPASSWORD` o `PGSERVICEFILE` en el entorno del proceso; no bloquea. |
| 2 | low | `grep -E '^DATABASE_URL'` también casaría `DATABASE_URL_DIRECT` u otra variable con ese prefijo y tomaría la primera. | Anclar a `^DATABASE_URL[[:space:]]*=`. |
| 3 | low | `collaboratorsOf` difiere de la referencia Python en dos detalles (une `importsUsed` del ancla y del constructor; exige el mismo archivo para el constructor) aunque el README dice «misma regex»; sin diferencias en los 15 casos. | Documentar la desviación en README o alinear. |
| 4 | low | R-NS ignora `use` agrupados (`use A\{B, C}`); no está en las limitaciones. | Añadir a las limitaciones declaradas. |

Notas informativas: R-SAME queda silenciosa frente a las 2 fallas reales de identidad (declarado como decisión abierta en el informe; no es defecto de la herramienta); el desempate de `recompute` por `rank` es una suposición razonable que la verificación 10/10 respalda; R-NS tiene 1 hit en trial válido en las verificaciones (declarado). Sin decisión `DEC` abierta que alcance este WI.

## Estado
status: APPROVED · blockers: ninguno · filesAffected: `harness/calibration/*`, `harness/reports/wi-core-063-*.md` · evidence: salidas de las verificaciones 1–9 arriba · recommendedNextStep: el leader puede cerrar WI-CORE-063 y registrar la revisión; los hallazgos 1–4 pueden resolverse en un corte posterior o aceptarse.
