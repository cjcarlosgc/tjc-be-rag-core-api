# WI-CORE-085 — Impacto de los pilotos oficiales (brick/money, doctrine/orm, EscolaLMS/Vouchers)
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Alcance: solo lectura de Core, Integration, Sandbox, Console, tesis y handoff del usuario. No se leyó ningún `.env`. No se ejecutó nada contra los pilotos ni se verificaron sus `composer.json` (los repos pilotos no están en el workspace): todo dato sobre ellos es DESCONOCIDO salvo que se indique. Rutas relativas a `Tesis/<repo>/`.

Leyenda: SOPORTADO (con evidencia) · PARCIAL · BRECHA · DESCONOCIDO (solo verificable ejecutando).

---

## 1. Esquema canónico del payload Integration→Core (CT-01, D-2)

### 1.1 Payload real hoy: sirve de base
| Aspecto | Hallazgo | Evidencia |
|---|---|---|
| Emisor | Integration serializa `NormalizedWebhookEvent` con `JSON.stringify(event)`; `POST {CORE_API_BASE_URL}/internal/v1/github/webhook-events`, `Authorization: Bearer`, `X-Correlation-ID`, timeout 8 s, `redirect:'error'` | `tjc-be-github-integration-api/app/src/github-webhooks/github-webhook-core-client.ts:21-37` |
| Tipos emisor | Unión `data.kind` de 9 variantes: `PULL_REQUEST`, `INSTALLATION`, `INSTALLATION_REPOSITORIES`, `REPOSITORY`, `MEMBER`, `MEMBERSHIP`, `ORGANIZATION`, `TEAM`, `IGNORED`; envoltorio `schemaVersion:1, deliveryId, eventName, action(string\|null), receivedAt` | `.../github-webhook.types.ts:1-51` |
| Receptor Core | `POST internal/v1/github/webhook-events`, `@Public()` + `GithubIntegrationAuthGuard`; `202` nuevo/no-op, `200` solo PR duplicado | `tjc-be-rag-core-api/app/src/github-webhooks/github-webhooks.controller.ts:9-23` |
| Auth | Bearer `GITHUB_INTEGRATION_TO_CORE_TOKEN`, comparación en tiempo constante; sin credencial `503 GITHUB_WEBHOOK_UNAVAILABLE`; bearer inválido `401 AUTH_REQUIRED`; el guard corre antes del parseo | `.../github-integration-auth.guard.ts:12-31` |
| Validación Core | `parseNormalizedWebhookEvent`: claves exactas (`hasExactKeys`), `schemaVersion===1`, `deliveryId` ≤255, `eventName` ≤100, `action` ≤100, `receivedAt` ISO, IDs `^[1-9][0-9]*$`, coherencia `eventName`↔`kind`, `createdAt` null o ISO UTC; inválido → `400 INVALID_REQUEST` | `.../dto/normalized-webhook-event.ts:60-229` |
| Contrato | La forma normalizada está en GH-INTEROP (sección que cita "esquema normalizado siguiente"); INTEROP §6.9 solo declara la ruta y remite a GH-INTEROP | `spec/contracts/github-integration-contract.md:228-255`; `spec/contracts/interoperability-contract.md:698-700` |

**Diferencias Core vs Integration (deriva latente):**
- Los tipos TS son idénticos campo a campo (Core `normalized-webhook-event.ts:5-46` vs Integration `github-webhook.types.ts:1-51`), pero se mantienen **a mano en cada repo**.
- La validación estricta (longitudes máx., patrón de IDs, claves exactas) existe **solo en Core**; Integration no valida lo que emite contra ningún esquema.
- Respuesta: Core `accepted: boolean` (`webhook-accepted.response.ts:3`) vs Integration `accepted: true` (`github-webhook.types.ts:55`). Integration además exige `accepted===true` y coherencia 200↔`duplicate` (`github-webhook-core-client.ts:57-69`).
- Variantes opcionales/null: `installationId` (PR, REPOSITORY), `createdAt`, `userLogin`, `owner`, `account.*`, ids de MEMBER/MEMBERSHIP/ORGANIZATION/TEAM. `action` para PR: opened, reopened, ready_for_review, synchronize, closed, edited, converted_to_draft (INTEROP §6.9). `IGNORED` solo `{kind}`.

Veredicto: **sí sirve de base** casi tal cual; un esquema JSON Schema (`oneOf` por `data.kind`, `additionalProperties:false`, patrones de ID y longitudes de `parseNormalizedWebhookEvent`) lo codifica sin cambio de comportamiento ni de wire.

### 1.2 Qué cambiaría
| Componente | Cambio | Tamaño |
|---|---|---|
| (a) Core | Nuevo `spec/contracts/schemas/github-webhook-event.schema.json` (+ definición de la respuesta aceptada); ejemplos mínimos: PR `opened`, PR `synchronize`, PR `closed` merged, `installation`, `installation_repositories`, `repository`, `IGNORED` (y opcionalmente member/membership/organization/team); entradas en `examples/manifest.json` (formato `file/schema/definition`, `manifest.json`); `contracts:generate` regenera `src/contracts/generated/*` (el script toma todo `*.schema.json`, `scripts/generate-contract-types.mjs:14`); la prueba de contrato ya itera el manifest (`app/src/contracts/contract-validator.spec.ts:9-12`) → los ejemplos nuevos se prueban solos; añadir un caso que pase los mismos ejemplos por `parseNormalizedWebhookEvent` (la frontera real). Sin cambio de código de producto es suficiente; sustituir los tipos manuales por los generados es opcional | S–M |
| (b) Integration | `contracts:generate` (ya existe `contracts:check/generate`, `app/package.json:12-13`; tiene `src/contracts/contract-validator.ts`); test en `github-webhook-normalizer.spec.ts`/`github-webhook-core-client.spec.ts` que valide lo emitido y los ejemplos contra el esquema. Su propio WI; no cambia runtime | S |
| (c) Contract Sync | La forma vive en **GH-INTEROP** → `GH-INTEROP-1.9` (aditiva, documental: referencia al esquema). El árbol `schemas/` es idéntico byte a byte en los 4 repos (verificado con `diff -rq`: iguales) y los `generated/` de cada repo cambian al agregar un `.schema.json` (`contracts:check` fallaría sin regenerar). Espejos a re-copiar: `schemas/` completo + `manifest.json` a Integration, Sandbox y Console; `github-integration-contract.md` a Integration y Console (Sandbox no lo espeja); `interoperability-contract.md` a los 4 si cambia INTEROP | M |
| (d) Orden/riesgo | Core primero (esquema + ejemplos + versión + evento Contract Sync) → Integration valida/regenera → Console y Sandbox solo re-espejan y regeneran (`contracts:check`). Breaking: **ninguno** (aditivo; no cambia wire ni DTO). Riesgo real: que el esquema sea más estricto/laxo que `parseNormalizedWebhookEvent`; mitigado pasando los ejemplos por ambos | Bajo |

### 1.3 ¿Mismas versión que erratas E-01/E-02 y mención del piloto antiguo?
- `INTEROP-2.19` es la vigente (`interoperability-contract.md:3`); E-01 (`ExperimentResultsResponse` lista `analysisRunId`/`symbol`, el servidor emite `targetId`; `harness/reports/errata-pendientes-interop.md`, línea de E-01; interfaz en `interoperability-contract.md:359`) es documental y la decisión del usuario fue acumularlas "junto con el próximo cambio de INTEROP por otro motivo". El esquema del webhook es ese motivo → **conviene incluir E-01 en `INTEROP-2.20`** (una sola ronda de espejos de INTEROP). E-02 es informativa sobre un evento histórico (`CS-CORE-20261021-003`): no requiere cambio.
- `tjc-piloto-ventas` aparece en `spec/contracts/system-contract.md:287` (SYSTEM-2.14, espejado en los 4 repos). Corregirlo exige `SYSTEM-2.15` documental → también otra ronda de espejos. Si se quiere **una sola ronda**, hacer en el mismo WI/Contract Sync: `INTEROP-2.20` + `GH-INTEROP-1.9` + `SYSTEM-2.15` (+ esquema). Costo extra: bajo (texto), beneficio: sin segunda ronda.
- Decisión recomendada para cross/usuario: **una sola versión de las tres + esquema**, porque los 4 repos ya deben re-espejar `schemas/`. Alternativa mínima: omitir SYSTEM (la mención es un ejemplo histórico inocuo; WI-CORE-084 ya despersonalizó el SDD propio).

---

## 2. Qualification/smoke por piloto (qué soporta hoy Core + Sandbox)

### 2.1 Matriz de capacidades
| Capacidad | Estado | Evidencia / comentario |
|---|---|---|
| PHP en Sandbox | SOPORTADO (8.3) | `tjc-be-test-execution-sandbox/app/docker/php/Dockerfile:10` (`php:8.3-cli`), imagen gestionada `tjc-sandbox-php:8.3-nonroot` (`container-limits.config.ts`). Configurable con `SANDBOX_DEFAULT_PHP_IMAGE` (debe traer `composer` y `unzip`) |
| Composer 2 | SOPORTADO | `Dockerfile:11,19`; `composer install --no-interaction --no-progress --prefer-dist --no-scripts`, respeta `composer.lock`, red habilitada solo en esa etapa (`container-runner.service.ts:219-240`) |
| Caché Composer | SOPORTADO | volumen `sandbox-composer-cache` (`SANDBOX_COMPOSER_CACHE_VOLUME`); pnpm tiene su store aparte |
| PHPUnit | SOPORTADO | `phpunit-test-runner.adapter.ts:14-37`: `supports` = `phpunit/phpunit` en require/require-dev o `phpunit.xml(.dist)`; comando `php vendor/bin/phpunit --log-junit <file> [testPaths]`; parser JUnit propio |
| Perfil / runner | SOPORTADO | `PHP_LARAVEL_PHPUNIT` es el **único** perfil PHP; no distingue Laravel de PHP puro: brick/money y doctrine/orm usarían el mismo perfil y runner `PHPUNIT` (el nombre dice Laravel, la imagen y el comando son genéricos) |
| `composer install --no-scripts` | DESCONOCIDO | No corre `post-autoload-dump` ni el package discovery de Laravel (`container-runner.service.ts:219-226`; el comentario dice que Laravel regenera su manifest al arrancar los tests). Para Vouchers/Testbench puede bastar o no; la qualification (comprobación 11) debe cubrirlo; brick/money y doctrine/orm dependen de sus propios scripts: DESCONOCIDO |
| Extensiones | PARCIAL | `php:8.3-cli` base (Dockerfile comentario l.5-8): ctype, dom, fileinfo, mbstring, openssl, tokenizer, xml, pdo_sqlite, curl, iconv, json, sodium, zlib. **No** hay `intl`, `bcmath`, `gmp`, `gd`, `zip`, `pdo_mysql/pgsql` (la imagen solo agrega `acl` y `unzip`, `Dockerfile:16-18`). Si un piloto exige `ext-intl` (formatear dinero en brick/money), `bcmath/gmp` o BD externa, Composer falla (`DEPENDENCY_INSTALL_FAILED`) o los tests fallan en runtime. Qué exige cada `composer.json`: **DESCONOCIDO** (hay que leerlo/correrlo) |
| Base de datos | BRECHA conocida | No hay MySQL/Postgres en el Sandbox (`spec/features/019-project-root-detection/spec.md:29`: "no se agrega MySQL al Sandbox"). Solo sqlite. Vouchers (Testbench) y doctrine/orm (tests con SQLite en memoria típicamente) pueden funcionar; **DESCONOCIDO** |
| Límites Sandbox | PARCIAL | defaults: memoria 1 GiB, 1 CPU, 128 PIDs, install timeout 180 s, test timeout 120 s, `SANDBOX_CONTAINER_TIMEOUT_MS` 30 s (solo contenedores auxiliares: `smoke`, `acl-recovery`, bootstrap de volúmenes; `container-runner.service.ts:100,263,329,372`; install y tests usan `installTimeoutMs`/`testTimeoutMs` recortados por el tiempo restante del deadline, `clampTimeout`, `:192,231,292,595`),  salida capturada 64 KiB, deadline ejecución 10 min, workspace ≤ 2 GiB, ZIP ≤ 200 MiB, ≤ 20 000 entradas, ≤ 500 MiB descomprimido (`container-limits.config.ts`; `sandbox-limits.config.ts`). Valores efectivos en la VM: DESCONOCIDOS (se fijan por entorno). `composer install` de doctrine/orm con dev-deps (phpunit, phpstan, dbal…) en 180 s/1 CPU: riesgo de `INSTALL_TIMEOUT` en frío, mejor con caché caliente |
| projectRoot (spec 019) | SOPORTADO para raíz `.` | marcador `composer.json` case-sensitive; raíz efectiva contiene el `composer.json` (`spec/features/019-project-root-detection/spec.md:14,19`); cwd de Composer/PHPUnit es la raíz efectiva (`execution-pipeline.service.ts:189-228,438-447`); phpunit busca `phpunit.xml`/`.dist` en esa raíz. Los tres pilotos tienen `composer.json` en la raíz según su naturaleza de librería/paquete (no verificado). Más de un `composer.json` en el repo → candidatos múltiples = `DEC-PHP-ROOT-001` PENDING (spec 019:17): riesgo si algún piloto trae `composer.json` anidados fuera de `vendor/` (p. ej. fixtures en `tests/`); DESCONOCIDO |
| Parser PHP en Core | PARCIAL | `tree-sitter-php 0.24.2` + `web-tree-sitter 0.25.10` (`app/package.json:57,59`); extrae class/interface/trait/enum, métodos, funciones (`php-parser.service.ts:26-31,161-195`). La gramática cubre sintaxis PHP 8.x (atributos, enums, readonly, first-class callables); no hay prueba local que lo demuestre sobre doctrine/orm → DESCONOCIDO; riesgo de nodos con error en un archivo se degrada a "ese archivo con menos chunks", no aborta (`php-parser.service.ts:63-71`, solo salta si no hay árbol) |
| Exclusiones de indexado | PARCIAL | ignora cualquier segmento `node_modules,.git,dist,build,coverage,.next,vendor,storage,cache` (case-sensitive, `indexing.constants.ts:3-14`); `blade.php` fuera; los directorios `Cache/` de doctrine (mayúscula) no se excluyen. Tests (`tests/`, `*Test.php`) se tratan como tests (`isTestFile`, `:50-55`) |
| Límite de indexado | PARCIAL | ZIP ≤ 50 MiB (`INDEXING_MAX_ZIP_SIZE_BYTES=52_428_800`, `env.validation.ts:98`); chunk ≤ 1500 tokens (`:106`). No se encontró tope de número de archivos/chunks en Core (BRECHA de observabilidad, no de funcionalidad); costo de embeddings en `openai-embedding.provider.ts` y `code-chunks.repository.ts` proporcional al número de chunks: doctrine/orm (miles de archivos, `src/` + `tests/`) será el mayor. Duración del **job de indexación**: sin tope propio hallado (la generación sí lo tiene: `ExperimentRun.budget` lleva `maxDurationMs`) (jobs con `maxAttempts`/lock obsoleto, `jobs.repository.ts`). Tamaño real del ZIP de doctrine/orm: DESCONOCIDO |
| Generación/experimento | SOPORTADO con defaults | `DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS=8000`, `DEFAULT_AGENT_MAX_TOOL_CALLS=20`, `DEFAULT_GENERATION_TIMEOUT_MS=120_000` (`config/generation-budget.defaults.ts:8-10`); `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS`, `EXPERIMENT_REPETITION_CONCURRENCY=3`, heartbeat 15 s con umbral calculado ≥ 3× (`env.validation.ts:134,215-229`). Con contexto repartido (doctrine/orm) 8000 tokens y 20 tool calls pueden ser justos para el brazo agente y para RAG; cambiarlos es decisión de protocolo y debe congelarse antes (handoff §4/§8) |
| Core→Sandbox | SOPORTADO | cliente con poll acotado (`SANDBOX_*` en `config`), contract tests C-06/C-07 existentes; E2E de producción documentado por Cross en `harness/reports/errata-pendientes-interop.md` (PR #3 de un proyecto histórico) |

### 2.2 ¿Existe algún smoke hoy?
- Sí, **un script manual de Core** (no ejecutado): `harness/reports/local-php-e2e-smoke-2026-10-12.mjs` (Core→Sandbox PHP/PHPUnit, un solo POST, requiere variables `SUPABASE_*`/`SANDBOX_*` y `SANDBOX_REPO` local). Está fechado y atado a un proyecto previo y a la ruta local del autor; sirve como plantilla, no como qualification por piloto. En Sandbox hay `integration` tests de contenedor (`container-runner.integration.spec.ts`) y contract tests. No hay comando "qualification" unificado.

### 2.3 Comprobaciones del handoff §4 → señal actual y procedimiento manual mínimo (sin endpoints nuevos)
| # | Comprobación | Señal hoy | Procedimiento manual mínimo |
|---|---|---|---|
| 1 | Composer | `DEPENDENCY_INSTALL_FAILED` (cat. `DEPENDENCY`), `INSTALL_TIMEOUT` (cat. `DEPENDENCY`), OOM (`sandbox-fact-error.ts:85-89`; `execution-pipeline.service.ts:241-261`). `COMPOSER_INSTALL_FAILED` **no existe en el código** de Sandbox ni Core; el código emite `DEPENDENCY_INSTALL_FAILED` (`sandbox-fact-error.ts:87`). Sí aparece como valor ilustrativo en `spec/contracts/schemas/examples/sandbox-result.failed.json:11` (`category: DEPENDENCY`), idéntico en los 4 repos y validado por la prueba de contrato (`failureCode` es string libre en el esquema). Usar `DEPENDENCY_INSTALL_FAILED` en protocolos. Si la ronda de CT-01 toca `schemas/`, conviene corregir ese ejemplo (decisión de contrato: aprobación del usuario) | En una VM/entorno con la misma imagen: `docker run --rm -v <clon>:/w -w /w tjc-sandbox-php:8.3-nonroot composer install --no-interaction --no-scripts --prefer-dist` con los mismos límites y cronometrar |
| 2 | Versión de PHP | no hay señal explícita; composer falla por `php` incompatible | `docker run … php -v` y comparar con `require.php` del `composer.json` |
| 3 | PHPUnit | `UNSUPPORTED_RUNNER` si no hay phpunit ni config; `TEST_ENVIRONMENT_CONFIGURATION_INVALID` (cat. `CONFIGURATION`) | `php vendor/bin/phpunit --list-tests` / un test existente con `--log-junit` |
| 4 | Extensiones | falla en composer (platform req) o en runtime (`TEST_EXECUTION_FAILED`, cat. `TEST_RUNTIME`) | `php -m` en la imagen frente a `composer check-platform-reqs` |
| 5 | Parsing | sin señal pública: archivos con error de sintaxis producen menos chunks | ejecutar el análisis de snapshot (job `snapshot-analysis`) y comparar nº de archivos `.php` vs nº de archivos con chunks; inspeccionar `candidates` de los targets (`AbstractHydrator::gatherRowData`, `hydrateAll`) |
| 6 | Indexación | estado del `ProjectVersion`/job (fallido por límite de ZIP o timeout) | crear Project+binding del fork, esperar `ProjectVersion` indexada, contar chunks y registrar duración y costo de embeddings |
| 7 | Project root | `INVALID_PROJECT_ROOT` (`CONFIGURATION`), candidatos múltiples → no ejecutable (`DEC-PHP-ROOT-001`) | confirmar `effectiveProjectRoot` en el `ProjectVersion`/AnalysisRun = `.` |
| 8 | Generación | repetición con `failureType`/`valid`; `promptSha256`, `contextTokens` | una generación de prueba (no oficial) sobre un target y revisar traza (`context-traces`) |
| 9 | Core–Sandbox | `SANDBOX_*` errores, `IMAGE_UNAVAILABLE` (`INFRASTRUCTURE`), `GET /health` | ejecución trivial `php -v` + test vacío vía el flujo normal o el smoke manual de 2.2 |
| 10 | Ejecución Sandbox | `TEST_EXECUTION_FAILED`, `TEST_COMPILATION_FAILED` (`COMPILATION`), `TIMED_OUT` | PHPUnit del repo base sin test generado (línea base verde) |
| 11 | Config de framework | `TEST_ENVIRONMENT_CONFIGURATION_INVALID` (marcador `Validation Error:`, `execution-pipeline.service.ts:585-588`) | Vouchers: correr un test Testbench existente en la imagen; revisar BD/ext requeridas |

Los fallos de esta fase no son resultados experimentales (handoff §4): se registran fuera de `ExperimentRun`. Núcleo de lo no verificable hoy: ext-intl/bcmath/gmp, BD de Vouchers, tiempo y memoria de `composer install` de doctrine/orm, parsing sobre doctrine/orm y volumen de embeddings.

---

## 3. Oráculo congelado

### 3.1 Qué dice ya la spec
- **Ya definido:** el oráculo es previo, no se entrega a RAG ni a GENERALIST_AGENT, no se construye de la prueba generada, CF/CO son externos y humanos, Core "conserva y exporta evidencia" y no deriva CF/CO (`spec/contracts/system-contract.md:203-210`; `spec/transversal/experimental-metrics/spec.md:19`; `spec/features/008-experimental-comparison/spec.md:60,69-75`). Los oráculos "permanecen externos: no se copian ni almacenan en repositorios de producto ni piloto" (008 spec:74).
- **No existe** en Core ninguna columna ni DTO `oracleId`/`caseId`/hash de oráculo/versión de requisito: `ExperimentRun` tiene `targetId`, `analysisRunId` (interno), `commitSha` (interno), `modelConfig`, `budget`, `randomizationSeed` y `executionProfile/runnerHint`; `ExperimentRepetition` tiene `pairId`, `promptSha256`, `artifactHash`, etc. (`app/prisma/schema.prisma:808-844,846-917`). `CreateExperimentDto` recibe `symbolFilePath`/`symbolQualifiedName` (`app/src/experiments/dto/create-experiment.dto.ts:40,45`).
- **Cómo se identifica hoy un caso:** `targetId` (UUID del `TestTarget` de la `ProjectVersion`, único por `ProjectVersion`) + `analysisRunId` + `commitSha` + símbolo (`symbolQualifiedName` / `symbolFilePath`). `pairId` agrupa las dos estrategias de una repetición. Eso basta para reconstruir "qué target/qué commit/qué repetición", no para saber qué requisito/oráculo se aplicó.
- **CF/CO:** se calculan fuera de Core (humana externa, hoja/registro de evidencia); Core expone `results`/`trace`/evidencia (§6.16) como insumo.

### 3.2 Dónde vive y cómo se enlaza (propuesta mínima)
| Pieza | Propuesta | Requiere cambio en Core |
|---|---|---|
| Ubicación | En la **raíz de evidencia externa** de la tesis (tesis §3.3.14, `referencias/tesis.md:1267`: "única raíz externa a los repositorios del producto"; el registro maestro referencia ubicación canónica y hash). Carpeta propia por piloto/caso, fuera de los forks y de Core; acceso del evaluador, no de los brazos | No |
| Identidad | `oracleId` (por piloto/requisito), `caseId` (C1–C3 × 3 pilotos), `oracleVersion`/`sha256` del documento congelado, fecha de congelación | No |
| Enlace a la repetición | **Convención externa**: tabla del registro de evidencia `caseId → (repo, commitSha congelado, analysisRunId, targetId, symbolQualifiedName, experimentId)` + por repetición `pairId`/`repetition`. La clave natural ya existe en Core (`targetId`+`commitSha`+`analysisRunId`); el oráculo se vincula **desde fuera hacia Core**, nunca al revés | No |
| Garantía de no filtración | Que `caseId`/oráculo no figuren en el repo piloto ni en prompts: el oráculo está fuera de los inputs porque Core jamás lo recibe; no hay endpoint que lo acepte | No |

**Recomendación mínima: solución solo con convención externa.** Alcanza para CF/CO y para la checklist CT-08.

**Opcional (funcionalidad nueva, requiere aprobación del usuario):** aceptar un `caseId`/`oracleRef` opaco como metadato de `ExperimentRun` (columna + DTO de `POST /experiments` + respuesta + INTEROP §6.5/§6.16 + migración + prueba). No recomendado ahora: añade contrato, rompe la regla "Core no conoce el oráculo" en espíritu (aunque sea opaco), y el mapeo `targetId↔caseId` externo ya resuelve el trazado. Si más adelante se quiere reducir errores de registro manual, evaluarlo como WI aparte con `DEC`.

---

## 4. Console, Sandbox e Integration

### 4.1 Sandbox
| Aspecto | Qué hay que hacer | Evidencia |
|---|---|---|
| Perfiles | Nada para brick/money y doctrine/orm: mismo `PHP_LARAVEL_PHPUNIT`; sin perfil nuevo | `phpunit-test-runner.adapter.ts:18-19` |
| Imagen/extensiones | **Posible cambio de imagen** (no de contrato) si la qualification muestra `ext-intl/bcmath/gmp` u otra necesaria: ampliar `app/docker/php/Dockerfile` o fijar `SANDBOX_DEFAULT_PHP_IMAGE`; cambio de infraestructura propio, con su WI y aprobación | `Dockerfile:15-23` |
| Límites | Posible ajuste de `SANDBOX_INSTALL_TIMEOUT_MS` (180 s), memoria, `SANDBOX_CONTAINER_TIMEOUT_MS`, `SANDBOX_TEST_TIMEOUT_MS` para doctrine/orm; solo configuración de entorno de la VM, se congela antes del experimento (handoff §4) | `container-limits.config.ts` |
| Contratos | Contract tests C-06/C-07 ya existen (`core-client.contract.spec.ts`, `executions.contract*.spec.ts`); sin cambio. Solo re-espejo si cambia el árbol `schemas/` (§1) | |

### 4.2 Console
- No cambia nada para los pilotos: la Console ya tiene módulos `evidence`, `experiments`, `context-explorer`, `analysis` (`tjc-fe-rag-developer-console/app/src/`); CT-08 es checklist manual sobre 3 AnalysisRuns y no requiere endpoints ni UI nueva (handoff §6).
- Tarea única: re-espejar `spec/contracts` y regenerar tipos si se cambia `schemas/`/INTEROP/GH-INTEROP (§1). No se encontró nada de UI necesario; "mostrar casos/trazas/evidencia" ya existe vía trazas y evidencia.

### 4.3 GitHub Integration y entrada de repos ajenos (crítico para CT-01/CT-08)
Cómo entra un `AnalysisRun`: el webhook de PR llega a Integration; Core solo procesa si existe un `RepositoryBinding` **ENABLED** para ese `repositoryId` y la instalación coincide (`app/src/github-webhooks/github-webhooks.service.ts:93-102`); `opened/reopened` inician Run; `synchronize/edited` cierran el actual y reinician si la rama base no es la integración (`:132-191`); un PR con `createdAt` anterior a `binding.createdAt` se rechaza (`:176`). La publicación usa Checks, Git Data API y companion PRs a través de la GitHub App instalada (`github-integration-contract.md:19,54-56`).

Consecuencias para los tres pilotos (todos repos de terceros, públicos):
| Hallazgo | Detalle |
|---|---|
| El equipo no puede vincular los repos upstream | El propietario de una cuenta/org **sí** puede instalar la App (incluso en un fork propio); lo que el equipo no puede es instalarla en `brick/money`, `doctrine/orm` ni `EscolaLMS/Vouchers`. Crear el binding exige: `installationId` obligatorio verificado contra la App (`repository-bindings.service.ts:65`, `requireInstallation`), `403 GITHUB_APP_ACCESS_REQUIRED` si la App no tiene acceso (`github-repository-access.service.ts:184-190`), `400 REPOSITORY_OUTSIDE_WORKSPACE` si el dueño del repo no es el workspace del Project (`:168-174`) y permiso `maintain/write/admin` del usuario (`:160-166`). Por eso un repo público ajeno no se puede vincular. **Conclusión: forks propios** con la App instalada, **workspace del Project = cuenta u organización dueña de los forks**, y binding creado **antes** de abrir el PR (regla de `createdAt`). Matiz: `github-webhooks.service.ts:93-97` compara la instalación solo si el payload la trae (`!payload.installation ||`) |
| PR/HEAD | El PR debe abrirse **dentro del fork** (base = rama de integración del binding, head = rama del equipo). El HEAD congelado es el `head.sha` del PR; las repeticiones usan ese snapshot (008 spec:71) |
| doctrine/orm #11600 | La necesidad es del issue público, pero la implementación de referencia y el HEAD congelado deben vivir en un fork/branch del equipo; interpretación del issue congelada ex ante (handoff §1, P2). No se abre PR contra `doctrine/orm` upstream (la App no tiene acceso) |
| brick/money y Vouchers | El cambio funcional controlado se materializa en un **branch/PR del fork del equipo**; el requisito y oráculo se congelan antes (handoff §1, §3) |
| Integration | Sin cambios de código previstos. Verificar: repos grandes (descarga de contenido por SHA para doctrine/orm: límites de tamaño de ZIP de GitHub frente a 50 MiB de Core) y rate limit del installation token; ambos DESCONOCIDOS sin ejecutar |
| Riesgo de reproducibilidad | Usar un fork implica que el repo no es literalmente el upstream; hay que registrar commit base upstream + SHA del fork en el registro de evidencia (tesis §3.3.14) |

---

## Resumen por componente
| Componente | Qué tocar | Orden | Tamaño |
|---|---|---|---|
| Core | Esquema `github-webhook-event.schema.json` + ejemplos + manifest + generados + prueba de frontera; `INTEROP-2.20` (+ E-01), `GH-INTEROP-1.9`, opcional `SYSTEM-2.15`; evento Contract Sync; convención de oráculo en doc de evidencia (sin código); runbook de qualification | 1 | M |
| Integration | Regenerar tipos, validar emitido y ejemplos contra el esquema (su WI); forks/instalación de la App y bindings (operativo, no código) | 2 | S |
| Sandbox | Re-espejo de `schemas/` e INTEROP/SYSTEM; **posible** ajuste de imagen/límites tras qualification | 3 (tras qualification) | S–M |
| Console | Re-espejo y regenerar tipos; sin UI nueva | 3 | S |

## (b) Requiere aprobación del usuario vs decide cross
**Requiere aprobación del usuario:**
1. Nuevo esquema `github-webhook-event.schema.json` y las versiones `INTEROP-2.20` / `GH-INTEROP-1.9` (cambio de contrato; D-2 ya aprueba el enfoque, falta aprobar el WI y el alcance exacto de ejemplos).
2. Incluir E-01 y, si se quiere, `SYSTEM-2.15` (mención de `tjc-piloto-ventas`) en la misma ronda.
3. Cualquier campo `oracleRef`/`caseId` en `ExperimentRun` (funcionalidad nueva + migración + contrato): **no recomendado**.
4. Cambio de imagen del Sandbox (extensiones) o de sus límites de producción (infraestructura externa).
5. Crear los forks (propiedad, nombre, organización), instalar la GitHub App en ellos y definir las ramas de integración; el **workspace del Project debe ser la cuenta u organización dueña de los forks** (`REPOSITORY_OUTSIDE_WORKSPACE`).
5b. Si se toca `schemas/` en la ronda de CT-01, corregir el ejemplo `sandbox-result.failed.json:11` (`COMPOSER_INSTALL_FAILED` → `DEPENDENCY_INSTALL_FAILED`): decisión de contrato.
6. Cambiar los presupuestos de generación/experimento (contexto, tool calls, tokens) para doctrine/orm: afecta a la validez del experimento y se congela por protocolo.
7. Decisión sobre `DEC-PHP-ROOT-001` si algún piloto trae más de un `composer.json` fuera de `vendor/`.

**Decide cross (sin aprobación de contrato):** orden de handoffs; secuencia de qualification antes de congelar; formato del registro de evidencia `caseId→targetId/analysisRunId/commitSha/pairId`; ubicación de la raíz externa dentro de lo ya fijado por la tesis; si la tarea de re-espejo de Sandbox/Console se agrupa en un solo ciclo.

## (c) Riesgos principales (foco doctrine/orm)
1. **Tamaño e indexación**: ZIP de doctrine/orm frente al tope de 50 MiB y volumen de chunks/embeddings; sin tope de archivos/chunks ni de duración del job de indexación hallado en Core.
2. **Composer en el Sandbox**: `composer install` con dev-deps en 1 CPU/1 GiB/180 s (default); riesgo de `INSTALL_TIMEOUT` o OOM; límites efectivos de la VM no verificados.
3. **Extensiones y BD**: imagen sin `intl/bcmath/gmp/pdo_mysql/pdo_pgsql`; suite de doctrine/orm y Vouchers puede pedir BD no disponible (solo sqlite).
4. **Parser PHP**: `tree-sitter-php 0.24.2` sobre atributos, enums, readonly y first-class callables de doctrine/orm: no verificado; pérdida silenciosa de chunks/targets.
5. **Contexto distribuido**: targets (`gatherRowData`, `hydrateAll`, `ResultSetMapping`) atraviesan muchas clases; 8000 tokens de contexto y 20 tool calls por defecto pueden sesgar a favor de un brazo; congelar presupuestos antes del experimento.
6. **Entrada por forks**: el equipo no puede instalar la App en los repos upstream y el binding exige instalación, permiso y que el workspace sea el dueño del repo (`github-repository-access.service.ts:160-190`); sin fork propio + binding + PR posterior al binding no hay AnalysisRun (`github-webhooks.service.ts:93-102,176`).
7. **Ubicación de tests generados**: `phpunit.xml.dist` de doctrine/orm (suites por directorio/namespace) frente a la ruta donde Core materializa el test: DESCONOCIDO, verificar en qualification.
8. **Nombre de categoría**: `COMPOSER_INSTALL_FAILED` solo existe como ejemplo ilustrativo en `sandbox-result.failed.json:11`; el código emite `DEPENDENCY_INSTALL_FAILED`. Un protocolo que cite el primero no coincidirá con la señal real.
9. **`--no-scripts`** en Vouchers/Testbench (DESCONOCIDO, §2.1).

## (d) Nota
Análisis por lectura; no se ejecutó nada contra los pilotos.
