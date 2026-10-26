# WI-CORE-102 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo bajo (declarado, no verificable)

## Veredicto: APPROVED (con 1 observación media y 4 bajas, sin cambios obligatorios)

El código cumple el alcance aprobado y los criterios de aceptación. La observación media (relación de compresión del Sandbox) no viola ningún criterio del WI, pero puede romper un Run real; se recomienda registrarla como riesgo/limitación o tratarla en un WI posterior (no exige cambios en este).

## Verificaciones ejecutadas (desde `app/`, PATH node22, sin base ni .env)
- `pnpm@12.14.0 lint`: sin hallazgos. `build`: exit 0.
- `DOTENV_CONFIG_PATH=/nonexistent vitest run`: 186 archivos pasan, 10 omitidos; 3223 pruebas pasan, 121 omitidas, 0 fallos (coincide con lo reportado).
- `node harness/validate-harness.mjs`: passed. `validate-work-items.mjs`: passed (101 WI). `scripts/sdd-check.mjs`: OK.

## Mutaciones (en el archivo real; restaurado siempre, `git diff --stat` idéntico antes/después)
Todas detectadas por las pruebas existentes: quitar `.sort()` (2 fallos); quitar `isSafeRelativePath` (1); quitar el chequeo U+FFFD (1); quitar tope total (1); quitar tope de 500 (1); quitar el gate PHP (2); quitar `pnpm-lock.yaml` de exclusiones (2); quitar `isIgnoredPath` del predicado (7); lotes de tamaño 1 (10); mover `addSandboxFixtures` después de `zipDirectory` en Validation (1) y en `persistSnapshot` (1). Las pruebas no son triviales; detectan regresiones reales.

## Hallazgos

1. **MEDIA — Un fixture muy repetitivo hace que el Sandbox rechace TODO el snapshot.**
   `tjc-be-test-execution-sandbox/app/src/workspace/safe-archive-extractor.ts:72-78` lanza `InvalidArchiveError` si `uncompressedSize/compressedSize > maxCompressionRatio` (default 100, `sandbox-limits.config.ts:90`) por entrada, y aborta el archivo completo. Reproducido con adm-zip: un CSV de 440 000 B de líneas repetidas comprime a 1 110 B (ratio 396); 100 KB de `x` da 877. Los topes de Core (500/1 MiB/5 MiB) no lo previenen. Antes de WI-102 esto no podía ocurrir con el pool PHP. Impacto: un fixture de datos sintéticos (CSV/SQL/JSON/TXT) mata la ejecución de ambos brazos y de Validation. No hay prueba ni mención en spec/informes. Sugerencia (no bloqueante, fuera de alcance aprobado): omitir en Core fixtures cuyo ratio estimado supere un umbral, o declarar el riesgo en la spec 002; no hay evidencia de que casbin lo dispare (no ejecutado aquí).

2. **BAJA — Sin lista de nombres sensibles; `auth.json`, `credentials.json`, `secrets.yml`, `*.sql` (volcados) pasan.** `indexing.constants.ts` (`isSandboxFixtureFile`) solo excluye segmentos con `.` y 3 lockfiles, tal como se aprobó (D-v2-3). Consecuencia: esos archivos ahora se persisten en Object Storage (`project-versions/<id>/snapshot.zip`, `analysis-runs/<id>/snapshot.zip`) y llegan al Sandbox; antes no salían de GitHub. No van a OpenAI (verificado: `WorkspaceAgentTools` restringe lectura a `allowedFiles` = `discover`, `workspace-agent-tools.ts:376-420`; `discover` usa `isPoolFile`, y el predicado rechaza todo archivo pool). Aceptable con forks públicos; vinculado a DEC-VAL-001 PENDING (la spec lo menciona). Recomendado ampliar la lista antes de repos empresariales.

3. **BAJA — Precisión de la spec.** `spec/features/002-.../spec.md` afirma que los fixtures «solo están en el workspace del Sandbox»; en realidad también están en el ZIP de Object Storage y en el workspace temporal de Core que extrae el snapshot para el brazo agente (`experiment-job.handler.ts:1223`; no son legibles por las herramientas, pero existen en disco) y `ContextTraces` extrae el ZIP (solo lee rutas de excerpts). Matizar a «viajan en el ZIP del snapshot; no entran en índice, discovery ni herramientas». El alcance también listaba actualizar specs 018:134 y 008; no se tocaron (018:134 trata de herramientas del agente, que no cambian; 008 sin cambios): no es defecto, pero el alcance declarado difiere del hecho.

4. **BAJA — Comportamientos menores de `addSandboxFixtures`.**
   - `getTree` truncado: `getTree` solo loguea y devuelve subconjunto; el informe de fixtures no lo refleja (omisión silenciosa de fixtures). `github-repository-content.service.ts:78`.
   - Se vuelve a pedir `getTree` en cada análisis incluso en proyectos TypeScript (ruta temprana `phpProject=false`, pero tras la llamada de red). Costo mínimo.
   - `content.includes('�')` omite también archivos UTF-8 válidos que contengan literalmente U+FFFD (conservador, aceptable).
   - Un repo TS con un `composer.json` anidado no ignorado se trata como PHP para el gate de fixtures (mismo criterio que `materialize`, coherente).
   - Nunca lanza: verificado (try/catch envuelve todo; el `logger.log/warn` final no depende de datos externos). Orden `.sort()` por unidad de código, determinista. Los logs solo contienen contadores (verificado en código y hay prueba).

5. **BAJA — Registros.** `tasks.md` ST-CORE-124 queda `T-IN_PROGRESS` y el WI `W-IN_REVIEW`: correcto para esta etapa. `wi-core-102-technical-checks.md` y CHANGELOG coinciden con el código y con las cifras que reproduje; las mutaciones que reporta como del implementer son compatibles con las mías. La afirmación «Sin cambio en Sandbox/Integration/contratos» es cierta (diff solo en `app/src` de Core y docs). `workspace-agent-tools`/`FileDiscoveryService`/`isPoolFile`/`isPhpPoolFile` sin cambios (diff HEAD confirma).

## Verificado sin hallazgo
- Seguridad de rutas: `isSafeRelativePath` + `join` bajo el workspace; rutas con `..`/absolutas se omiten; `.env*` y cualquier segmento con `.` excluidos; binarios no aplican (lista cerrada de extensiones de texto; no-UTF-8 se omite).
- Orden de operaciones: en `persistSnapshot` el llamado va tras indexar y justo antes de `zipDirectory`; `persistSnapshot` está en try/catch (falla no bloquea el Run). Los usos posteriores de `workspace.dir` (`detectSymbols`, resolución de tests) trabajan con listas de archivos ya descubiertas, no reescanean el directorio, y los fixtures no son archivos pool. En Validation el llamado va antes de `zipDirectory` y los tests generados se escriben después (no entran al ZIP, igual que antes).
- Sin cambio de contrato/DTO/enum/ErrorCode/evento/esquema/env/migración; Sandbox admite el volumen (20 000 entradas, 500 MiB, 200 MiB de descarga) salvo el ratio de compresión del hallazgo 1.

## Qué debe corregirse
Nada obligatorio. Recomendación al leader: registrar el hallazgo 1 como riesgo conocido (spec 002 o informe técnico) y decidir con el usuario si se mitiga en Core antes del smoke de casbin; ajustar la frase del hallazgo 3.

## Re-revisión del delta
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo bajo (declarado, no verificable)

### Veredicto: APPROVED (2 observaciones bajas, sin cambios obligatorios)

### Verificaciones
- lint sin hallazgos; build exit 0; vitest 186 archivos pasan, 10 omitidos; 3242 pasan, 121 omitidas (coincide con lo esperado); `validate-harness`, `validate-work-items` (101 WI) y `sdd-check`: OK.
- El delta no toca `isPhpPoolFile`, `isPoolFile` ni `materialize`/`fetchAndWriteInBatches` (el diff de esos archivos solo añade código de fixtures; verificado por grep del diff).
- Ratio con adm-zip real (el mismo compresor que `zipDirectory`): `deflateRawSync` por defecto da exactamente el mismo tamaño comprimido que la entrada del ZIP de adm-zip en las 6 muestras no vacías (repetitivo 1110/1110, 'x'*100k 114/114, JSON 12558/12558, CSV poco compresible 1980/1980 con ratio 51.7, aleatorio base64 60256/60256). El cálculo de Core es por tanto exacto, no una estimación, y el margen 80 vs 100 es suficiente (la cabecera del ZIP usa los mismos tamaños que evalúa `safe-archive-extractor.ts:72-78`). Límite: depende de que adm-zip siga usando nivel por defecto; si cambiara, el margen de 20 % absorbe diferencias pequeñas.
- Casos límite: archivo vacío (`Math.max(compressed,1)`, ratio 0) pasa y se incluye; archivo de 1 byte (ratio 0.3) pasa; ya comprimido/aleatorio (ratio ~1.3) pasa. El tope de 1 MiB se evalúa antes que el ratio.
- Mutaciones (restauradas; diff idéntico): quitar el guard de ratio (2 fallos), subir el umbral ×100 (2 fallos), quitar el guard sensible (12 fallos), quitar los límites de palabra de la regex (5 fallos). Las pruebas con `'x'.repeat` restantes solo ejercen el tope de tamaño (1 048 577 B); los casos de contenido poco compresible fueron sustituidos por texto que pasa el ratio y hay casos nuevos `a,b,c,d\n`*55000 que deben omitirse: no hay debilitamiento.
- Regex `SANDBOX_FIXTURE_SENSITIVE_NAME` (probada sobre nombres en minúscula): coincide con `auth.json`, `credentials.json`, `secrets.yml`, `secret.txt`, `my-secret.csv`, `service-account.json`, `serviceaccount.json`, `auth.conf`; no coincide con `author(s).json`, `oauth*.json`, `authz.conf`, `secretary.csv`, `keymatch_model.conf`, `rbac_model.conf`, `policy.csv`.
- Docs: spec 002, CHANGELOG y scope describen lo que hace el código (ratio > 80, nombres sensibles, límites declarados); la frase del hallazgo 3 quedó corregida.

### Hallazgos
1. BAJA — Falso positivo: `auth_model.conf` y `rbac_with_auth.conf` se excluyen (`auth` entre `_`/`.`); un fixture legítimo de un repo de autorización con ese nombre dejaría de viajar y el test que lo lea fallaría por entorno. Casbin usa nombres como `rbac_model.conf`/`keymatch_model.conf` (no afectados), así que el riesgo para el piloto es bajo; documentado en spec solo como «contenga ... como palabra».
2. BAJA — Falsos negativos: `oauth-*.json`, `secretKey.json` (sin separador), `token.json`, `password*.txt`, `apikey*`, claves en `.txt` pasan el filtro. La lista es heurística, no una garantía; la spec no promete exhaustividad pero conviene no presentarla como control de secretos. Sigue vigente DEC-VAL-001 para repos empresariales.
