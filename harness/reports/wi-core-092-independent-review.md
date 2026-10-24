# WI-CORE-092 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto: CHANGES_REQUESTED** (2 hallazgos altos, 6 medios, 7 bajos). El documento es mayoritariamente exacto y honesto; los altos pueden inducir a clasificar mal un fallo de qualification como resultado del experimento y a rellenar el registro de evidencia con campos que no existen en el JSON. Ruta revisada: `harness/reports/pilotos-runbook-operativo.md` (sin commit, HEAD 270c1e3). Rutas de código relativas a `Tesis/`.

## Alcance de la revisión
Lectura de Sandbox, Core, Integration, Console, spec 008/013/019, INTEROP §6.5/§6.13/§6.16, tesis (Tabla 54, Tabla 70, §3.3.8, §3.3.14, Anexo L) y los tres forks con `gh api` GET. No se leyó ningún `.env` ni se usaron keys.

## Hallazgos

### R-1 · ALTA · §4.1 fila `TEST_ENVIRONMENT_CONFIGURATION_INVALID` (línea 286), §1.2 fila money y §1.4 paso F
El documento marca ✔ que un bootstrap roto de PHPUnit (money, `INTL_ICU_VERSION`) o la BD ausente (Vouchers) se reportan como `TEST_ENVIRONMENT_CONFIGURATION_INVALID`. No es así: ese código solo sale cuando el stderr contiene el marcador de Jest `Validation Error:` (`tjc-be-test-execution-sandbox/app/src/executions/execution-pipeline.service.ts:560` y `:585-593`). Un fatal de PHP (constante indefinida, conexión rechazada) sin JUnit produce `TestExecutionFailedError` → `TEST_EXECUTION_FAILED`, categoría `TEST_RUNTIME` (`:570-573`; `sandbox-fact-error.ts:91-94`). Esa categoría no cuenta para `technicallyValidRate` (INTEROP §6.5.1, línea 385) y es el tipo de fallo que la regla 4.2.3 manda CONSERVAR sin repetir. Riesgo de invalidación: un fallo de qualification quedaría registrado como resultado de la estrategia.
Debe decir: (a) que en PHP el síntoma esperado es `TEST_EXECUTION_FAILED` con mensaje «runner results file is missing/empty» (y `TEST_COMPILATION_FAILED` si hay un error de sintaxis, `:564-569`); (b) añadir una fila a §4.1 para `TEST_EXECUTION_FAILED`; (c) una advertencia explícita: un `TEST_EXECUTION_FAILED` en un repo que no pasó el smoke 1.4 es de qualification y no se asigna a la estrategia; por eso no se lanza el experimento oficial sin smoke verde; (d) quitar el ✔ de esa fila (queda ⚠ o corregida).

### R-2 · ALTA · §3.a (línea 212), §3.b (218), §3.d (232), §3.e (251)
El JSON de «Descargar evidencia» de un ExperimentRun NO trae repositorio, PR, HEAD, `analysisRunId`, `snapshotRef`, `projectVersionId`, `targets` ni `publication`: el ensamblador emite `analysisRun: null` y `publication: null` para `EXPERIMENT` (`tjc-be-rag-core-api/app/src/evidence/evidence-bundle.assembler.ts:369-379`; tipo en INTEROP §6.16 líneas 1337-1342: `analysisRun: {...} | null`). `targetId` tampoco está en ese JSON. El documento describe un solo «contenido» común y dice que `analysisRunId`, `projectVersionId`, `targetId` y el `headSha` se leen del JSON, y la Tabla 70 marca «Proyecto/snapshot/Run: AUTO» desde `analysisRun.*`.
Debe decir: distinguir los dos paquetes. Run: lleva repo/PR/HEAD/`analysisRunId`/`snapshotRef`/`projectVersionId`/targets/publicación. Experimento: lleva `subjectId` (= `experimentId`), `generatedAt`, `generation`, `agentExploration`, `sandbox`, `experimental`; `retrieval`/`context` solo del brazo RAG. Para unir un experimento con su Run/HEAD/target, anotar `analysisRunId` (URL de la Console `?analysisRunId=`), y `projectVersionId`/`targetId` de `GET /experiments/{id}` o `/results` (`experiment-status.presenter.ts:15-30`; `experiments.service.ts:~295`), y el `headSha` del JSON de evidencia del Run. En §3.e, «Proyecto/snapshot/Run» queda AUTO solo combinando ambos archivos; para el experimento solo `experimentId` y `generatedAt` salen del JSON.

### R-3 · MEDIA · §2.d (líneas 192-199) y §2.c.7
La verificación del `modelConfig` en la Console solo es posible cuando el experimento está `COMPLETED`: `ExperimentComparison` (que contiene «Proveedor y modelo», «Esfuerzo…», presupuestos) se renderiza solo con `operation?.status === 'COMPLETED' && operation.result` (`tjc-fe-rag-developer-console/app/src/experiments/ExperimentPage.tsx:292-299`; bloque en `ExperimentComparison.tsx:63-71`); durante la corrida y en `FAILED` no se muestra. La spec exige verificar el entorno ANTES de crear un experimento de evidencia y el `modelConfig` DESPUÉS (`spec/features/008-experimental-comparison/spec.md:91`). El documento dice «ANTES de dar por buena la corrida» sin precisar, y no da al operador cómo comprobar `medium` antes de gastar 6 generaciones.
Debe decir: (1) antes de lanzar, pedir al usuario/cross confirmación explícita de que `LLM_REASONING_EFFORT=medium` (el operador no ve Render); (2) en la Console el `modelConfig` solo se ve al terminar; durante la corrida solo vía `GET /experiments/{id}` (requiere token, que el operador quizá no tenga); (3) un experimento `FAILED` no muestra el bloque: en ese caso avisar sin descargar como definitiva.

### R-4 · MEDIA · §0.3 (líneas 28-37), §0.2 (línea 26)
(a) Se propone «una invitación aún pendiente» como posible causa del 503. Una membresía `pending` da `NOT_MEMBER` → `DENIED` → `404 PROJECT_NOT_FOUND`, no 503 (`app/src/project-access/organization-access.resolver.ts:193-194`; `project-access.service.ts:337-343` y `:100-102`). El propio §0.2 y la fila 292 de §4.1 lo dicen bien: es incoherente y presenta una causa no posible. (b) El texto citado «verificación de GitHub no disponible» no es el de la Console: `tjc-fe-rag-developer-console/app/src/control-plane/errors.ts:20` muestra «No pudimos verificar el permiso en GitHub ahora; inténtalo de nuevo.» (Core: «GitHub no permite verificar el acceso en este momento; reintenta.», `project-access.errors.ts:31-36`). (c) Falta una causa real del 503: el alta que excede el tiempo de la transacción también devuelve `UNVERIFIABLE` (`project-access.service.ts:211-214`). (d) El listado sin `workspaceId` no devuelve 503: omite lo no verificable (`projects.service.ts:99-106`); el 503 del listado solo aplica con filtro de workspace (`:152-160`).
Debe decir: quitar la invitación pendiente como causa del 503 (pasa a «Project no aparece / 404»); citar el texto real; añadir la causa «tiempo de verificación agotado»; mantener «causa no confirmada» (esa honestidad es correcta).

### R-5 · MEDIA · §0.2 fila «Rol suficiente» (línea 25)
No aclara que ser miembro de la organización no basta: el rol sale del permiso sobre el repositorio (`write`→Writer, `maintain`/`admin`→Maintainer, `triage`/`read`→Reader) y solo el owner de la org es Admin (`project-access.service.ts:337-375`, `roleForPermission`; INTEROP línea 1055 `DEC-ORG-002`: se exige membresía activa y además el permiso). Un compañero miembro con `read` verá el Project pero no podrá lanzar.
Debe decir: además de miembro activo, tener permiso `write` (o superior) sobre el fork correspondiente; un colaborador externo con `write` no accede (404).

### R-6 · MEDIA · §2.c.6 (línea 188) y §5 fila 324
«Pulsar dos veces con la misma llave no duplica (la Console envía `Idempotency-Key`)» induce a error: la Console genera una llave NUEVA en cada pulsación (`ExperimentPage.tsx:87` → `createIdempotencyKey()` = `crypto.randomUUID()`, `api/idempotency.ts:4-6`). La protección real es que el botón se deshabilita mientras la mutación está pendiente o `experimentId` está en la URL (`ExperimentPage.tsx:196`); recargar la pantalla con solo `?analysisRunId=` rehabilita el botón y crearía un segundo experimento.
Debe decir: no hay protección por llave entre pulsaciones distintas; una sola pulsación; si la pantalla se recarga sin `experimentId`, no volver a pulsar sin comprobar antes en el Run si ya existe el experimento. Añadir cómo reabrir uno existente: `/projects/<p>/experimental?experimentId=<id>` (`ExperimentPage.tsx:31-32`).

### R-7 · MEDIA · §2.a.5 y §5 (faltante)
Solo advierte de nuevos commits. Cerrar, mergear o pasar a borrador el PR deja el Run sin vigencia (`current=false`; `github-webhooks.service.ts:145-150`, `analysis-runs.service.ts:118-127`), y reabrir el PR con el mismo HEAD crea un Run nuevo (`startRunInternal`, `analysis-runs.service.ts:175-190`). CT-08 exige un Run «finalizado y vigente» (tesis Tabla 54, procedimiento; las filas OBSOLETE se excluyen).
Debe decir: no cerrar, mergear, reabrir ni convertir a borrador el PR hasta terminar las descargas y la auditoría CT-08.

### R-8 · MEDIA · §1.5 fila «Generación de prueba y flujo Core–Sandbox» (línea 159)
Permite «una corrida de prueba» sin advertir que no debe hacerse sobre el PR/Run/caso oficial: crearía un experimento extra sobre el Run de evidencia y exige otro esfuerzo (`low`) con cambio global de configuración y redeploy (solo el usuario). La spec exige no mezclar clases (`008 spec.md:91`) y §4.2.8 del propio documento dice «cada caso/Run se corre una vez».
Debe decir: la corrida de prueba, si el usuario la pide, usa un PR/Project aparte y nunca el Run oficial ni el caso congelado.

### R-9 · BAJA · §2.d.4 y §2.c.4
Los presupuestos se muestran, pero no se pide compararlos con los valores congelados; los 20/8000/120000 son solo defaults de código (`generation-budget.defaults.ts:8-10`) y `resolveBudget()` toma las variables de entorno de Core en la creación (`experiments.service.ts:355-363`), así que Render puede diferir. Debe decir: comparar los tres presupuestos mostrados con los valores congelados que entregue el equipo, no con los defaults.

### R-10 · BAJA · Citas (líneas 174, 171, 325)
`github-webhooks.service.ts` es de Core (`tjc-be-rag-core-api/app/src/github-webhooks/`), no de Integration; la línea 174 lo agrupa con `tjc-be-github-integration-api/...`. Verificado: líneas 93-102, 132-191 y 176 son correctas; solo falta el prefijo del repo. Verificado también: borrador/rama base distinta no inician Run (`github-webhooks.service.ts:188,197,206`), lo cual puede subirse de ⚠ a ✔.

### R-11 · BAJA · Lenguaje para quien no conoce el SDD
«cross» aparece ~25 veces sin definición (el compañero no sabe qué es); también sin definir: WI-, HU17/HU18, DEC-PHP-ROOT-001, INTEROP §…, OE5, CT-01…, `W-`. Debe decir: definir «cross» en el glosario (o decir «el usuario o la sesión coordinadora») y quitar o glosar los identificadores internos en el texto operativo (p. ej. el bloque HU17/HU18 de §2.c.5 y la mención DEC-PHP-ROOT-001 de §1.1). Además, las rutas de código citadas no son accesibles al operador (aceptable como trazabilidad, pero conviene decirlo en el encabezado).

### R-12 · BAJA · §2.c.1 (línea 181) y página del Run
«Si no ves el botón, revisa rol»: el botón «Comparar RAG vs GA» no depende del rol (`AnalysisRunDetailPage.tsx:284-286`); es la pantalla la que oculta «Ejecutar comparación» a quien no es Writer (`ExperimentPage.tsx:37,190`). En la misma página hay otros dos botones parecidos («Comparación de estrategias →» y el de retrieval, `:311-330`) que NO son el experimento OE5. Debe decir: usar exactamente «Comparar RAG vs GA».

### R-13 · BAJA · §1.4 (fidelidad del smoke) y §1.1 «respeta phpunit.xml»
Los comandos son ejecutables y correctos (imagen equivalente a `Dockerfile:10-23`, límites de memoria/CPU/PIDs, `--network none` en tests, instalación con red y `--no-scripts`, `COMPOSER_HOME`; verificado contra `container-runner.service.ts:219-240,277-296`). Diferencias que conviene declarar: el Sandbox monta el workspace en `/app`, corre como `sandbox` con `CapDrop ALL` y `no-new-privileges`, inyecta `APP_ENV=testing` y un `APP_KEY` aleatorio (`:294`, `:584-591`, `:394-415`; el `<env APP_KEY>` de Vouchers no lo sobreescribe), y en el flujo real ejecuta solo los archivos de prueba generados (`selectTestPaths`, `execution-pipeline.service.ts:517-535`), no la suite completa. La frase «las variables que fija `phpunit.xml` se respetan» es cierta para `DB_*` (el request Core→Sandbox no tiene campo de entorno) pero no para `APP_KEY`.

### R-14 · BAJA · §1.3 y §4.1 filas OOM/`INSTALL_TIMEOUT`
La lista de códigos omite `OOM_KILLED` (`sandbox-fact-error.ts:144-147`), que la fila OOM ni nombra. Los resultados `INFRASTRUCTURE` del Sandbox (incluidos `OOM_KILLED` e `IMAGE_UNAVAILABLE`) los reintenta Core una vez automáticamente (INTEROP §6.5.1 línea 384), por lo que en una corrida oficial el operador verá un segundo intento sin haber hecho nada. Debe decir: nombrar `OOM_KILLED` y avisar de que el intento 2 automático es esperable.

### R-15 · BAJA · §3.a línea 214
«No incluye el texto del prompt (solo su hash, interno)»: el JSON no incluye el hash del prompt (es interno, `008 spec.md:85`); lo que sí trae es `artifactHash` (SHA-256 del contenido de la prueba enviada al Sandbox, INTEROP línea 1243). Debe decir: el JSON trae `artifactHash` de la prueba; el hash del prompt es interno y no se exporta.

## Verificado como exacto (muestra amplia)
- SHAs base money `93f145c`, orm `b44f3df`, Vouchers `546f871` coinciden con `develop`; ninguno de los tres tiene `composer.lock` en la raíz.
- Imagen PHP: `Dockerfile:10-23` (`php:8.3-cli` + `acl` + `unzip` + Composer 2, usuario 10001); sin intl/gd/zip/pdo_pgsql; límites 1 GiB / 1 CPU / 128 PIDs / instalación 180 s / tests 120 s / salida 64 KiB / deadline 600 s / workspace 2 GiB / descarga 200 MiB (`container-limits.config.ts`, `.env.example`); `SANDBOX_MAX_CONCURRENT_EXECUTIONS=2` (`execution-pipeline.service.ts:51,103`); instalación con red y tests con `network: false`; `composer install --no-interaction --no-progress --prefer-dist --no-scripts` (`container-runner.service.ts:219-240`); comando PHPUnit y criterio de runner (`phpunit-test-runner.adapter.ts:14-37`).
- money: `phpunit.xml` referencia `phpunit-bootstrap.php`; este hace `printf(... INTL_ICU_VERSION)` incondicional; en PHP 8 una constante indefinida lanza `Error` fatal. `ext-intl` solo en `suggest`; `ext-dom`/`ext-pdo` en `require-dev`.
- Vouchers: `phpunit.xml` fija `DB_CONNECTION=pgsql`, `DB_HOST=postgres`; el Sandbox solo inyecta `APP_ENV`/`APP_KEY` y el request Core→Sandbox no tiene campo de entorno; tests sin red; CI propio con MySQL y `migrate:fresh`. La parte de `maatwebsite/excel`→`phpspreadsheet`→`gd`/`zip` está correctamente marcada ⚠ (no verificable con las fuentes permitidas).
- orm: `phpunit.xml.dist` con `pdo_sqlite` en memoria, `failOnWarning/Notice/Risky`, bootstrap `tests/Tests/TestInit.php`; la carpeta `tests/Tests/ORM/Hydration` existe. Los `.gitattributes` de money y orm hacen `export-ignore` de `tests/` y `phpunit.xml*`, pero Integration sirve el snapshot por git trees/blobs, no por `git archive` (`github-repository-content.service.ts:62-71`), así que no afecta.
- Console: textos y rutas existen («Comparar RAG vs GA», «Descargar evidencia (JSON)», «Traza operativa», «Evidencia versionada», «Ejecutar comparación», «Target experimental», «Capturar el próximo PR»/«Armar captura» con sello PROPUESTA, rutas `/analysis-runs`, `/action-required`, `/projects/:id/experimental`); el botón se oculta con `ACTION_REQUIRED` u `OBSOLETE`; nombres `evidence-analysis-run-<id>.json` y `evidence-experiment-<id>.json` (`evidence/download.ts`).
- Core: `@IsIn([3])` (`create-experiment.dto.ts`); defaults 20/8000/120000; `modelConfig` y `budget` persistidos al crear (`experiments.service.ts:~154-182`); `REASONING_EFFORT_UNSUPPORTED`, `UNSUPPORTED_PROJECT`, `LLM_PROVIDER_UNAVAILABLE` con su significado; `EXPERIMENT_FAILED`/`EXPERIMENT_WORKER_LOST` reanudables (INTEROP línea 319); reintento único por fallo externo y excepción `TIMED_OUT` (INTEROP línea 384); `EXPERIMENT_REPETITION_CONCURRENCY=3` (`env.validation.ts:215`); poller de un job a la vez por instancia (`jobs.service.ts:21,110-119`, `claimNext` con `SKIP LOCKED` `LIMIT 1`); `LLM_MODEL`/`LLM_REASONING_EFFORT` globales (`env.validation.ts:477-507`); no existe bloqueo «un experimento por Project» (solo idempotencia por llave, `experiments.service.ts:154`).
- Códigos del Sandbox existentes: `DEPENDENCY_INSTALL_FAILED`, `INSTALL_TIMEOUT`, `TEST_EXECUTION_FAILED`, `TEST_COMPILATION_FAILED`, `TEST_ENVIRONMENT_CONFIGURATION_INVALID`, `INVALID_PROJECT_ROOT`, `UNSUPPORTED_RUNNER`, `IMAGE_UNAVAILABLE`; `TIMED_OUT` es un estado, no un código de error; `COMPOSER_INSTALL_FAILED` no existe (confirmado por `CS-CORE-20261024-001/002/003` y WI-079).
- Protocolo: las reglas 4.2 coinciden con `008 spec.md:63`, INTEROP línea 384 y tesis §3.3.8 (línea 1243) y tabla de la línea 2548-2550; 54 ejecuciones = 3×3×2×3 (27 pares).
- Tabla 70: ocho columnas correctas (`evidence_id`, OE/indicador, Fecha, Proyecto/snapshot/Run, Tipo, Ubicación maestra, Estado, Qué demuestra), estados PLANIFICADA/DISPONIBLE/VERIFICADA/NO DISPONIBLE (tesis línea 1267) y Core no genera `EV-OE*` (INTEROP línea 1234). La clasificación «solo Fecha y Proyecto/snapshot/Run son automáticos» es razonable, sujeta a R-2.
- Trace: mapeo de los nueve enlaces, `PRESENT`/`NOT_APPLICABLE`, ausencia de consulta inversa y de estado «inconsistente», `409 EVIDENCE_NOT_FINISHED`, Runs previos sin relleno (INTEROP líneas 1236-1241).
- Honestidad: cada ⚠ está donde corresponde; no se encontró ningún ⚠ presentado como ✔ salvo R-1 (fila de `TEST_ENVIRONMENT_CONFIGURATION_INVALID`); el documento no pide tocar `harness/`, `spec/`, el oráculo ni `.env`, ni usar `AGENTS.md` (los menciona solo para decir que no hacen falta); declara los límites del borrador (§6.3).
- Seguridad/publicación: no hay secretos, IPs, tokens ni ids sensibles; la URL de la Console y los SHA públicos son datos ya públicos; las credenciales de `phpunit.xml` de Vouchers no se reproducen.

## Evidence (comandos)
- `node scripts/sdd-check.mjs` → «SDD check OK».
- `node harness/validate-work-items.mjs` → «Work item validation passed (CORE, 91 WI)».
- `node harness/validate-harness.mjs` → «Harness V3 validation passed».
- `node harness/validate-completions.mjs` → «Completion validation passed (88 completed WI)».
- `git status --short`: `M harness/state.json`, `M harness/work-items.json`, `?? pilotos-runbook-operativo.md`, `?? wi-core-092-contract-sync-scope-review.md`, `?? wi-core-092-technical-checks.md`; `git diff --stat`: solo `harness/state.json` y `harness/work-items.json`. No hay cambios en `app/`, `spec/contracts`, `referencias/` ni `.env`.
- Los validadores aplican al estado actual de `harness/`; el informe de la revisión se añade como archivo nuevo sin tocar el resto.

## Para pasar a APPROVED (ciclo 2)
Corregir R-1 y R-2 (obligatorio), R-3 a R-8 (medios) y, de los bajos, al menos R-9, R-11 y R-12; el resto es recomendable. Los cambios son solo de texto en `pilotos-runbook-operativo.md`; no hay decisión DEC ni cambio de alcance o contrato abierto.

---

## Ciclo 2 de 2

Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto: APPROVED** con 2 observaciones menores no bloqueantes (N-1, N-2) que conviene corregir en el cierre. R-1..R-15 se aplicaron y se sostienen contra código, Console, forks y tesis; no se introdujo ningún error nuevo de gravedad media o alta.

### Verificación de cada corrección
- R-1 OK: §1.3 (nuevo bloque «Ojo con dos códigos»), §1.2, §1.4 paso F y fila nueva `TEST_EXECUTION_FAILED` en §4.1 coinciden con `execution-pipeline.service.ts:560,564-573,585-593`; la regla «sin smoke verde, un `TEST_EXECUTION_FAILED` es de qualification» está en 1.3 y 4.1; quitado el ✔ de la fila de `TEST_ENVIRONMENT_CONFIGURATION_INVALID`.
- R-2 OK: §3.a separa el paquete del Run y el del experimento (`evidence-bundle.assembler.ts:369-379`); §3.b, §3.d y la Tabla 70 de §3.e (`AUTO solo combinando archivos`) correctos.
- R-3 OK: §2.d distingue «antes de lanzar» (confirmar `medium` con el usuario, spec 008:91) y «después» (bloque solo con `COMPLETED`, `ExperimentPage.tsx:292-299`).
- R-4/R-5 OK: 404 para membresía pending (`organization-access.resolver.ts:193-194`), rol por permiso (`deriveRole`/`roleForPermission`), colaborador externo 404 (DEC-ORG-002), texto real `errors.ts:20`. Sobre el timeout de transacción: el analista tiene razón, la línea correcta es `project-access.service.ts:194-196` (mi cita 211-214 del ciclo 1 era errónea; se corrige aquí).
- R-6 OK (`ExperimentPage.tsx:87,196,31-32`; `idempotency.ts:4-6`). R-7 OK (`github-webhooks.service.ts:145-150,186-196`; `analysis-runs.service.ts:118-127,175-190`). R-8 OK (§1.5).
- R-9 OK (`experiments.service.ts:355-363`). R-10 OK (prefijos de Core). R-11 OK (glosario con cross, WI, HU, DEC, INTEROP, OE5). R-12 OK: los tres botones existen con esos textos exactos («Comparación de estrategias →», «Comparar RAG vs GA», «Comparar recuperación SE vs SEM», `AnalysisRunDetailPage.tsx:311-326`) y el primero no depende del rol.
- R-13 OK (diferencias del smoke ya declaradas, consistentes con `container-runner.service.ts`). R-15 OK (`artifactHash` sí; hash del prompt interno).
- R-14 OK y verificado: Core reintenta UNA vez (intento 2) cuando el resultado es `INFRASTRUCTURE` salvo `TIMED_OUT` del Sandbox, o el proveedor LLM falla por 5xx/429/conexión, o el cliente del Sandbox lanza excepción (`experiment-job.handler.ts:422-428,877-881`; `attempt-recovery.ts:33-39,91-92`; INTEROP línea 384). `OOM_KILLED` e `IMAGE_UNAVAILABLE` son `INFRASTRUCTURE` en el Sandbox (`sandbox-fact-error.ts:114,146`), por lo que entran. `INSTALL_TIMEOUT` y los timeouts de pruebas dan estado `TIMED_OUT` y no se reintentan.
- Sin secretos ni IPs (grep limpio). El operador no recibe peticiones prohibidas: no toca `harness/`, `spec/`, oráculo ni `.env`; el único push es el del PR del caso, previsto. ⚠/✔ honestos (R-5, R-8, R-9, R-13, R-14 y R-15 comprobados por mí contra el código).

### Observaciones nuevas (no bloqueantes)
- N-1 (baja-media) §1.2, celda Vouchers (a): afirma como síntoma esperado `TEST_EXECUTION_FAILED` «conexión rechazada sin archivo de resultados» sin ⚠. Es una inferencia: con Testbench la conexión a BD suele fallar dentro de cada test, PHPUnit sí escribe el JUnit y la ejecución saldría `COMPLETED` con pruebas falladas/erróneas, indistinguible de un fallo de la estrategia. Debe decir: marcar ⚠ y añadir que el síntoma puede ser pruebas erróneas con resultados (no `TEST_EXECUTION_FAILED`), lo que refuerza que el smoke 1.4 sea condición previa. Para money el síntoma (bootstrap antes de crear el JUnit) es plausible y ya consta como ⚠ en §4.1.
- N-2 (baja) §0.3 línea 29: redacción duplicada («al abrir un Project … (o el listado de Projects) al abrirlo directamente (enlace o id)»); dejar solo «al abrirlo directamente (enlace o id)». Además el encabezado aún dice «BORRADOR … para el futuro WI-CORE-092»; actualizar al cierre.

### Evidence (ciclo 2)
- `node scripts/sdd-check.mjs`, `validate-work-items.mjs`, `validate-harness.mjs`, `validate-completions.mjs`: todos en verde (mismas salidas que el ciclo 1).
- `git status`: solo `harness/state.json`, `harness/work-items.json` modificados y los informes/runbook sin commit; ningún cambio en `app/`, `spec/contracts`, `referencias/` ni `.env`.
