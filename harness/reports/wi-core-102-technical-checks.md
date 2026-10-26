# WI-CORE-102 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium
Implementación: subagente `implementer-high` (configurado claude-sonnet-5-5, atendido claude-sonnet-5-5; el subagente declaró esfuerzo «bajo» sin verificarlo).

## Verificación independiente del leader (desde `app/`, 2026-10-25)
- `corepack pnpm@12.14.0 lint`: sin hallazgos (exit 0).
- `corepack pnpm@12.14.0 build` (prisma generate + nest build): exit 0.
- `corepack pnpm@12.14.0 contracts:check`: limpio (sin cambio de contrato ni de `generated/`).
- `vitest run` (sin base de datos; los `*.pg.spec.ts` se omiten): 186 archivos pasan y 10 se omiten; 3 223 pruebas pasan y 121 se omiten; 0 fallos (antes de WI-102: 3 147). Tras las mitigaciones de la revisión (sección siguiente): 186 archivos pasan y 10 se omiten; 3 242 pasan y 121 se omiten; 0 fallos.
- `node scripts/sdd-check.mjs`, `harness/validate-work-items.mjs` y `harness/validate-harness.mjs`: en verde.

## Cambio (app/src)
`isSandboxFixtureFile`/`isSandboxSnapshotFile`/`SANDBOX_FIXTURE_LIMITS`/`SANDBOX_FIXTURE_EXTENSIONS` en `project-versions/indexing.constants.ts`; `GithubSnapshotMaterializerService.addSandboxFixtures` (nunca lanza; vuelve a pedir el árbol; solo proyectos PHP; ≤ 500 archivos, ≤ 1 MiB por archivo, ≤ 5 MiB en total, orden por ruta; omisiones solo como contadores); llamadas en `persistSnapshot` (análisis) y antes de `zipDirectory` en Validation; `ct-02-orchestration.spec.ts` solo añade el mock del método nuevo. `isPhpPoolFile`, `isPoolFile` e `isTypeScriptPoolFile` no cambian.

## Hallazgo del leader corregido en este WI
Primera versión: un `package.json`/`tsconfig.json`/`jest.config.json` de un repo PHP habría viajado como fixture (extensión json) y reaparecido en `FileDiscoveryService.discover` del workspace del `GENERALIST_AGENT` (usa `isPoolFile`). Ahora un fixture nunca es archivo del pool; hay pruebas del predicado, del materializador y de no regresión de `discover` con el servicio real.

## Pruebas y sanidad de mutaciones (reportadas por el implementer; reproducidas las pruebas por el leader)
- Predicado: 44+ casos en `indexing.constants.spec.ts`; materializador: bloque nuevo de `addSandboxFixtures` (inclusión, exclusión de `.env*`/binarios/lockfiles/rutas ignoradas, topes, fallo de lectura, no-UTF-8, no-PHP, fallo de `getTree`, orden determinista, log sin rutas, ruta absoluta, no regresión de `discover`); handlers: llamada antes de zipear (el ZIP subido contiene el fixture escrito por el mock) y continuidad del Run si el paso falla.
- Mutaciones detectadas: (a) quitar la exclusión de segmentos con `.` (5 pruebas fallan), (b) quitar el tope por archivo (2), (c) quitar el skip de `fetchFailed` (2), (d) llamar a `addSandboxFixtures` después de `zipDirectory` (1 por handler, tras añadir pruebas que comprueban el contenido del ZIP), (e) quitar el guard `isPoolFile` (9).

## Límites
No se ejecutó nada contra GitHub, Integration ni el Sandbox reales; la cobertura es con mocks más un caso real de `zipDirectory`/`FileDiscoveryService` sobre un directorio temporal. La comprobación de extremo a extremo (zip de un smoke con fixtures y una prueba que los lee en el Sandbox) es el criterio (a) de la puerta de qualification. Riesgos aceptados: un archivo > 1 MiB se descarga entero antes de omitirse (el tamaño no viene en el árbol; variante C1-b fuera de alcance); +N llamadas Core→Integration→GitHub (≈ 72 en casbin, lotes de 8).

## Mitigaciones tras la revisión independiente (delta, mismo alcance: omisión con contadores)
- Relación de compresión: `addSandboxFixtures` omite un fixture con ratio (deflate raw nivel por defecto) > `SANDBOX_FIXTURE_LIMITS.maxCompressionRatio` = 80 y lo cuenta en `omitted.highCompression`, porque `safe-archive-extractor.ts` del Sandbox rechaza el snapshot entero si una entrada supera 100 (reproducido por el reviewer: un CSV repetitivo de 440 KB da ratio ~396). Las pruebas que usaban `'x'.repeat(...)` para los topes de 1 MiB y 5 MiB pasaron a texto poco compresible sin debilitar sus aserciones; prueba con `adm-zip` real: ninguna entrada del ZIP supera ratio 100.
- Nombres sensibles: `SANDBOX_FIXTURE_SENSITIVE_NAME` (`auth`, `credential(s)`, `secret(s)`, `service-account` como palabra) excluye `auth.json` de Composer, `credentials.json`, `config/secrets.yml`, etc.; no excluye `oauth2.json`, `authors.json` ni `examples/rbac_model.conf`; sin falsos positivos en los tres forks del piloto (`git ls-files` de money, persistence y casbin).
- Mutaciones: sin el guard de ratio fallan 2 pruebas; sin la regla de nombres sensibles, 12. Verificación del leader tras el delta: lint sin hallazgos, build exit 0, `contracts:check` limpio, 3 242 pruebas pasan.
