# Runbook operativo de los pilotos
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

> Versión 2 (2026-10-24, WI-CORE-095) del runbook revisado de forma independiente en WI-CORE-092. Actualizada con el resultado del smoke del Sandbox (WI-SANDBOX-021: imagen PHP ampliada). Solo lectura: se leyeron el código de Core, Sandbox, Integration y Console, el SDD, el informe `tjc-be-test-execution-sandbox/harness/reports/wi-sandbox-021-smoke-evidence.md` y los forks `rag-tesis-org/*` con `gh api` (GET). Este documento no ejecutó nada contra los pilotos: los resultados del smoke son los que reporta ese informe (✔ = citado del informe) y se repiten en tu máquina con la checklist 1.4. Rutas de código relativas a `Tesis/<repo>/` (son trazabilidad para el equipo; tú no necesitas abrirlas). Términos internos que verás: **cross** = la sesión coordinadora del trabajo (en la práctica, el usuario te dirá a quién escribir); **WI** = work item (unidad de trabajo interna); **HU** = historia de usuario; **DEC** = decisión registrada; **INTEROP** = contrato entre componentes; **OE5** = objetivo específico 5 de la tesis (el experimento RAG vs agente). Se explican en el glosario (6.2).
> Leyenda: ✔ verificado leyendo (fuente entre paréntesis) · ⚠ solo se confirma ejecutando o depende de una decisión.

Para quién es: una persona que sabe PHP, que opera desde su máquina con la Console (https://tjc-fe-rag-developer-console.onrender.com) y el Core en Render, y que NO necesita leer el SDD ni tocar `harness/` ni `spec/`.

---

## 0. Antes de empezar

### 0.0 Resumen de estado (leer primero)
| Tema | Estado | Fuente |
|---|---|---|
| Imagen PHP del Sandbox | **Ampliada** (intl, gd, zip, bcmath, gmp; ICU 76.1; PHP 8.3.36; `memory_limit` 512M). El cambio está en el repo del Sandbox (commit `a4231d7`, rama `feature/jean`) ✔. **⚠ No está desplegado en la VM**: el informe lo dice (§5.6) y hay que confirmar con el usuario/cross que la VM ya usa la imagen nueva antes de cualquier smoke o corrida. Este runbook describe la imagen NUEVA | ✔ `tjc-be-test-execution-sandbox/app/docker/php/Dockerfile`, `zz-sandbox.ini`, `harness/reports/wi-sandbox-021-smoke-evidence.md` |
| P1 `brick/money` | **PASA el smoke** (suite completa: 1060 tests OK) | ✔ informe §3.1 |
| P2 `doctrine/orm` | **PASA el smoke** (suite completa: 3686 tests OK con avisos) | ✔ informe §3.2 |
| P3 `EscolaLMS/Vouchers` | **NO APTO según el smoke; EN REVISIÓN.** El usuario decide si se sustituye P3; NO está descartado. No es un tema de imagen | ✔ informe §3.3 |
| Primer acceso del compañero a los Projects de la organización | Bloqueo conocido (503) cuando Integration/Core están dormidos o la verificación falla; ver 0.3 y 0.3 bis | ✔ `AGENTS.md` raíz (arranque en frío) ⚠ causa exacta |

### 0.1 Qué se hace en este experimento (en 5 líneas)
- Se trabaja sobre un fork de un repositorio PHP (`rag-tesis-org/money`, `orm` o `Vouchers`), rama `develop`.
- Se abre un Pull Request (PR) con un cambio funcional ya definido por el equipo investigador; la herramienta lo detecta y crea un **AnalysisRun** (una "corrida de análisis" de ese PR en ese commit).
- Desde la Console se lanza un **ExperimentRun** (un "experimento"): para un método/función cambiado se genera una prueba con dos estrategias, **RAG** (el sistema completo: busca contexto relevante en el código y lo arma) y **GENERALIST_AGENT** (un agente que solo lee el repo con herramientas y propone la prueba), 3 repeticiones cada una (6 generaciones en total).
- Cada prueba generada se ejecuta en un **Sandbox** (contenedor Docker aislado con PHP y PHPUnit).
- Se descarga la evidencia y se registra a mano en una hoja de evidencia. Las métricas **CF/CO/VT** (ver glosario) las califica una persona fuera del sistema contra el **oráculo** (la especificación "correcta", congelada antes; ver glosario).

### 0.2 Acceso que necesitas
| Requisito | Detalle | Fuente |
|---|---|---|
| Cuenta de GitHub | Con la que inicias sesión en la Console | ✔ `tjc-fe-rag-developer-console/app/src/router.tsx:23` (ruta `/login`) |
| Ser miembro ACTIVO de la organización `rag-tesis-org` | Core decide tu acceso con GitHub: «GitHub es la fuente de verdad de la autorización» y «nadie invita» (el registro de acceso se crea al entrar) | ✔ `spec/contracts/interoperability-contract.md` §6.13 («Alta del acceso») |
| Rol suficiente en el Project | **Ser miembro no basta:** el rol sale de tu permiso sobre el repositorio del fork en GitHub (`write` → Writer; `maintain`/`admin` → Maintainer; `triage`/`read` → Reader; solo el owner de la organización es Admin). Lanzar un experimento exige **Writer** o más; ver Runs, trace y evidencia exige **Reader**; responder las preguntas funcionales exige **Maintainer** o Admin. Un miembro con solo `read` verá el Project pero no podrá lanzar; pide al usuario el permiso `write` sobre el fork que te toque | ✔ `app/src/project-access/project-access.service.ts` (`deriveRole`/`roleForPermission`); `interoperability-contract.md` §6.5.1 y matriz rol→operación §6.13 |
| Membresía activa (no colaborador externo) | Un colaborador externo del repo, aunque tenga `write`, no recibe acceso (responde 404, regla `DEC-ORG-002`: membresía activa Y permiso). Una invitación todavía pendiente tampoco cuenta: el Project responde 404 `PROJECT_NOT_FOUND`, no 503 | ✔ `app/src/project-access/organization-access.resolver.ts:193-194`; `interoperability-contract.md` §6.13 |

### 0.3 BLOQUEO CONOCIDO: primer acceso sin registro previo (503)
- **Síntoma:** al abrir un Project de la organización por primera vez, al abrirlo directamente (enlace o id), la Console muestra «No pudimos verificar el permiso en GitHub ahora; inténtalo de nuevo.» y la API responde `503 GITHUB_VERIFICATION_UNAVAILABLE` ✔ (`tjc-fe-rag-developer-console/app/src/control-plane/errors.ts:20`; `app/src/project-access/project-access.errors.ts:31`; `project-access.service.ts` método `require`). Ojo: el listado de Projects sin filtro de organización **no** da 503: simplemente omite los Projects aún no verificados (`app/src/projects/projects.service.ts:99-106`), así que «no aparece en la lista» es ambiguo (puede ser esto, o falta de membresía/permiso).
- **Qué hace Core:** para un usuario SIN registro de acceso previo verifica en vivo con GitHub (`grantOnEntry`); si GitHub no se puede consultar (red, 5xx, límite de tasa, instalación suspendida, permiso `Members: read` sin aceptar) no concede el acceso. ✔ (`interoperability-contract.md` §6.13, «Caída de GitHub»). Si ya tienes registro de acceso, Core lo conserva y no vuelve a fallar por eso ✔.
- **Causa:** hoy esa verificación falla para usuarios nuevos. La causa concreta **no está confirmada** ⚠: el contrato nombra como candidatas el permiso `Members: read` de la GitHub App sin aceptar por la organización, instalación suspendida o límite de tasa; el código además devuelve el mismo resultado si la verificación del alta agota el tiempo de su transacción (`project-access.service.ts:194-196`). Una invitación pendiente NO es causa del 503 (da 404, ver 0.2). No lo adivines.
- **Qué hacer:**
  1. Confirma que eres miembro activo de `rag-tesis-org` (github.com/orgs/rag-tesis-org/people) y que tu sesión es de esa cuenta.
  2. Cierra sesión y entra de nuevo UNA vez; espera 1 minuto y reintenta UNA vez más.
  3. **No reintentes en bucle** (cada intento consume el límite de tasa de GitHub y puede empeorarlo).
  4. Si persiste: avisa al usuario (dueño del proyecto) o a cross (la sesión coordinadora; ver glosario) con: tu usuario de GitHub, la hora, la pantalla y el texto exacto del error. Mientras tanto no uses la API a mano para evitarlo.
- **Quién lo desbloquea:** el usuario o cross (aceptar permisos de la App en la organización o crear/forzar tu registro de acceso desde el lado de Core); tú no tienes acceso a Render ni a la base de datos y no debes.

### 0.3 bis AVISO: despertar Integration y Core antes de cada sesión y de cada PR de caso
Core e Integration están en el plan gratuito de Render: se duermen tras ~15 min sin tráfico y la primera petición tarda ≈ 30 s (22–33 s medidos por el equipo). Consecuencias reales:
- Con Integration dormido, Core no puede verificar el acceso a GitHub y lo marca no verificable: **el compañero (sin registro de acceso previo) solo puede abrir los Projects de la organización con Integration despierto.** Es la causa más probable del 503 de 0.3 ⚠ (no confirmada por el código; sí por los logs de Render que cita el equipo).
- **Un webhook de GitHub que llegue con Integration dormido puede perderse** (GitHub no lo reintenta y corta a ~10 s): el PR no crearía Run.

Antes de CADA sesión y de abrir CADA PR de caso:
1. Abre en el navegador `https://tjc-be-github-integration-api.onrender.com/health` y `https://tjc-be-rag-core-api.onrender.com/health` (ambos existen: `GET /health` público en cada servicio ✔ `tjc-be-rag-core-api/app/src/common/health/health.controller.ts`, `tjc-be-github-integration-api/app/src/health/health.controller.ts`; sin prefijo de ruta). Espera un 200 (el `/health` de Integration puede responder 503 `not_ready` si le falta configuración: en ese caso avisa; la respuesta puede tardar ≈ 30 s la primera vez; no recargues en bucle).
2. Solo con ambas respondiendo, abre el PR.
3. Tras abrir el PR, confirma en la Console que el Run aparece (2.b). Si no aparece en unos minutos, avisa; **no abras otro PR ni empujes commits** para «forzarlo».
4. La VM del Sandbox también puede estar fría: si el experimento no avanza, avisa (no tienes acceso a ella).
El usuario puede mantener los servicios despiertos con un monitor externo durante las ventanas de captura de evidencia; eso lo activa y pausa él/cross, no tú.

### 0.4 Herramientas locales
| Herramienta | Para qué | Nota |
|---|---|---|
| Git | clonar el fork, crear rama y push | |
| `gh` (GitHub CLI) autenticada con tu cuenta | abrir el PR contra `develop` del fork | opcional si lo haces desde la web |
| PHP 8.3 y Composer 2 | reproducir localmente el smoke de la sección 1 | el Sandbox usa PHP 8.3 y Composer 2 ✔ (`tjc-be-test-execution-sandbox/app/docker/php/Dockerfile:18-19`) |
| Docker | smoke «igual al Sandbox» (sección 1.4) | recomendado: es la forma de ver lo mismo que verá el Sandbox |
| Navegador | Console | |

### 0.5 Qué NO necesitas
`AGENTS.md`, el SDD (`spec/`), el harness, acceso a Render, a Supabase, ni ninguna clave (API key de OpenAI, tokens de GitHub, etc.). **Si algo te pide una clave, para y avisa.** No edites variables de entorno de ningún servicio (ver sección 5).

---

## 1. Qualification / smoke por piloto (antes de congelar y de cualquier corrida oficial)

**Regla de oro:** esta fase comprueba que el repositorio puede instalarse y probarse con el Sandbox. **Sus fallos NO son resultados experimentales**: se corrigen y se repite hasta que pase, y cada intento queda documentado (qué falló, qué se cambió, fecha). Solo después se congela repo/commit/PR/HEAD/targets/oráculos/modelo/presupuestos y recién entonces empiezan las corridas oficiales. ✔ (handoff del usuario; `spec/features/008-experimental-comparison/spec.md` «Repositorios piloto del experimento»).

### 1.1 Qué soportan hoy Core y Sandbox
| Capacidad | Hoy | Fuente |
|---|---|---|
| Imagen PHP | **Imagen NUEVA** `tjc-sandbox-php:8.3-nonroot` (WI-SANDBOX-021): base `php:8.3-cli` (Debian 13), PHP **8.3.36**, ICU **76.1**, Composer 2.10.3, `acl` + `unzip`, usuario no-root `sandbox` (UID 10001) y `memory_limit = 512M` (`zz-sandbox.ini`). Digest de la imagen verificada en el smoke: `sha256:e41aa91aca5d4eb00e8228c4ebbc16d516fcb7ba8fe94a9038bbbe203694fbc7`. La base `php:8.3-cli` no está fijada por digest: una reconstrucción futura puede variar (ICU/PHP). ⚠ **No desplegada aún en la VM** (informe §5.6): confirma con el usuario/cross que la VM tiene esta imagen antes de usar este runbook. Se puede cambiar con `SANDBOX_DEFAULT_PHP_IMAGE` (decisión de infraestructura, no tuya) | ✔ `tjc-be-test-execution-sandbox/app/docker/php/Dockerfile`, `zz-sandbox.ini` (commit `a4231d7`, rama `feature/jean`); informe `harness/reports/wi-sandbox-021-smoke-evidence.md` §2 |
| Extensiones | Las de la base (ctype, dom, fileinfo, mbstring, openssl, tokenizer, xml, pdo, pdo_sqlite, sqlite3, curl, iconv, json, sodium, zlib…) **más** `intl`, `gd` (jpeg, freetype, webp), `zip`, `bcmath` y `gmp`. **Ausentes a propósito:** `pdo_pgsql` y `pdo_mysql` (`mysqlnd` viene en la base) | ✔ `Dockerfile` (cabecera y `docker-php-ext-install`); `php -m` en informe §2 |
| Instalación | `composer install --no-interaction --no-progress --prefer-dist --no-scripts`; respeta `composer.lock` si existe; con red solo en esta etapa; caché Composer compartida (volumen) | ✔ `container-runner.service.ts:219-240` |
| **`--no-scripts`** | No corre ningún script de Composer (`post-autoload-dump`, `post-install-cmd`, etc.). Los *plugins* de Composer sí se cargan | ✔ `container-runner.service.ts:204,228` |
| PHPUnit | `php vendor/bin/phpunit --log-junit <archivo> [rutas de test]`; el runner se elige si `composer.json` declara `phpunit/phpunit` o existe `phpunit.xml(.dist)` en la raíz efectiva | ✔ `src/runner-adapters/phpunit-test-runner.adapter.ts:14-37` |
| Perfiles | Un solo perfil PHP, `PHP_LARAVEL_PHPUNIT` (se usa también para PHP «puro»; el nombre dice Laravel, la imagen y el comando son genéricos) | ✔ `phpunit-test-runner.adapter.ts:18-19` |
| Raíz del proyecto | Se busca `composer.json` (mayúsculas/minúsculas exactas); si hay varios candidatos, la ejecución no es posible (decisión interna aún pendiente, `DEC-PHP-ROOT-001`). Composer y PHPUnit corren en esa raíz | ✔ `spec/features/019-project-root-detection/spec.md:14,17,19`; WI-085 §2.1 |
| Límites por defecto (los efectivos en la VM no se conocen) | memoria 1 GiB, 1 CPU, 128 procesos, instalación 180 s, tests 120 s, salida capturada 64 KiB, deadline total 10 min, workspace ≤ 2 GiB, descarga ≤ 200 MiB | ✔ `container-limits.config.ts`, `tjc-be-test-execution-sandbox/app/.env.example` (líneas `SANDBOX_*`); valores reales ⚠ |
| Red en tests | La instalación tiene red; la **ejecución de tests no** | ✔ `.env.example` («Timeouts propios para instalación (con red) y ejecución (sin red)») |
| Base de datos | No hay MySQL ni Postgres en el Sandbox; solo SQLite; y los tests corren sin red. No se añadió `pdo_pgsql`/`pdo_mysql` (decisión del leader del Sandbox) | ✔ `spec/features/019-project-root-detection/spec.md:29`; informe §4 |
| Concurrencia del Sandbox | 2 ejecuciones simultáneas por defecto; las demás esperan en `PENDING` | ✔ `.env.example` (`SANDBOX_MAX_CONCURRENT_EXECUTIONS=2`), `src/executions/execution-pipeline.service.ts:51,103` |
| Parser PHP en Core | `tree-sitter-php 0.24.2`; extrae clases, métodos y funciones; un archivo con error de sintaxis da menos fragmentos, no aborta | ✔ WI-085 §2.1 (`php-parser.service.ts`); comportamiento sobre estos repos ⚠ |
| Indexación | ZIP del repo ≤ 50 MiB; se ignoran carpetas `vendor`, `node_modules`, `.git`, `storage`, `cache`, etc. (en minúscula) | ✔ `app/src/config/env.validation.ts:98`; `indexing.constants.ts:3-14` |

### 1.2 Resultado de la qualification por piloto (smoke del Sandbox, WI-SANDBOX-021)
Fuente: `tjc-be-test-execution-sandbox/harness/reports/wi-sandbox-021-smoke-evidence.md` §3 (✔ = citado de ese informe). Se ejecutó en clones de trabajo de los SHA base (money `93f145c`, orm `b44f3dff4`, Vouchers `546f871`) con los límites del Sandbox (1 GiB, 1 CPU, 128 procesos, `--cap-drop ALL`, usuario 10001, tests con `--network none`, `APP_ENV=testing`, `APP_KEY` aleatorio) y la **imagen nueva**. No se probó el flujo real Core → Sandbox con estos repos (informe §5.7), y el smoke **no fue ejecutado por este runbook**: se repite en tu máquina (1.4). Ninguno de los tres forks trae `composer.lock` ✔ (listado del contenido raíz de `develop`): el Sandbox resuelve las versiones más recientes permitidas el día de la corrida, así que **registra las versiones realmente instaladas** (3.d). El smoke generó un `composer.lock` por fork en un clon de trabajo; ese lock no está en los forks.

| | P1 `brick/money` | P2 `doctrine/orm` | P3 `EscolaLMS/Vouchers` |
|---|---|---|---|
| Resultado del smoke | **PASA** ✔ | **PASA** ✔ | **NO APTO** ✔ (**EN REVISIÓN**, no descartado) |
| Instalación (sin lock, red habilitada) | exit 0, 11 s, pico ≈ 63 MiB; 2 paquetes + 29 dev | exit 0, 19 s, pico ≈ 79 MiB; 22 paquetes + 46 dev | exit 0, 40 s, pico ≈ 287 MiB; 139 + 48 paquetes; `laravel/framework` resuelve a `10.x-dev` (rama de desarrollo: poca reproducibilidad) |
| Tests (sin red, 120 s) | exit 0, 2 s; **1060 tests, 2079 aserciones, OK**; bootstrap imprime `ICU version: 76.1`; sin fallos CLDR/ICU | exit 0, 16 s, pico ≈ 175 MiB, sin OOM; **3686 tests, 12431 aserciones, OK con avisos** (3 deprecaciones, 78 omitidos, 2 incompletos) | exit 2, **37 errores** `SQLSTATE[HY000]: General error: 1 no such table: roles` (con una variante SQLite de `phpunit.xml` hecha solo para el smoke) |
| Memoria de PHP | n/a | **Con `memory_limit` 128M (valor por defecto de php-cli) la suite completa fallaba** al ≈ 52 % con «Allowed memory size of 134217728 bytes exhausted»; con 512M pasa. No era OOM del contenedor | n/a |
| Causa / comentario | El bootstrap (`INTL_ICU_VERSION`) ya no falla porque la imagen tiene `intl`; el CI del fork fija ICU 74 y con 76.1 pasa entera | — | El CI del fork ejecuta `testbench migrate:fresh` antes de PHPUnit; el Sandbox no migra. `testbench.yaml` fuerza `pgsql` y sin `pdo_pgsql` falla con `could not find driver`; con SQLite las migraciones fallan (`SQLite doesn't support multiple calls to dropColumn / renameColumn`). **Añadir `pdo_pgsql` no lo arregla** (no hay servidor de BD, no hay red en tests y SQLite no sirve para sus migraciones) |
| Qué NO prueba | Solo PHP 8.3.36 y ICU 76.1 (no PHP 8.2, ni ICU 74) ⚠ | Solo suite completa en este entorno; no el flujo real Core → Sandbox ⚠ | No mide el código de ningún PR |
| Fuente | informe §3.1 | informe §3.2 y §2 (`memory_limit`) | informe §3.3 y §4 |

**Qué significa para ti:**
- **P1 y P2:** la línea base es verde con la imagen nueva (sujeto a que la imagen nueva esté desplegada, ⚠). Aun así repite el smoke 1.4 antes de congelar: no sustituye la repetición en tu máquina ni el flujo real Core → Sandbox, que sigue sin probarse (⚠).
- **P3 (Vouchers):** **NO APTO según el smoke; EN REVISIÓN.** El usuario decide si se sustituye P3 por otro repositorio; **no lo des por descartado ni por aprobado**. Mientras tanto, **NO**:
  1. toques el fork `Vouchers` para «arreglarlo» (ni `phpunit.xml`, ni `testbench.yaml`, ni migraciones, ni añadir un `phpunit.sqlite.xml`);
  2. lances corridas oficiales de P3 (ni abras PR de caso en ese fork);
  3. pidas que se instale `pdo_pgsql` ni propongas cambios de imagen: no resolvería el problema.
  Si te piden ejecutar algo en P3, solo es la checklist 1.4 de solo lectura (en tu máquina, sin cambiar el fork) y reportar el resultado.
- Lo que **no** se ha verificado: money en PHP 8.2 y otras versiones de su CI; paridad con ICU 74; tiempos medidos con muestreo de 1 s (picos cortos pueden no verse); límite total de 10 min del Sandbox (informe §5).

### 1.3 Qué señales verás si falla (para entender el informe del Sandbox)
Códigos reales del Sandbox/Core: `DEPENDENCY_INSTALL_FAILED` (Composer falló), `INSTALL_TIMEOUT`, `TIMED_OUT`, `TEST_EXECUTION_FAILED`, `TEST_COMPILATION_FAILED`, `TEST_ENVIRONMENT_CONFIGURATION_INVALID`, `INVALID_PROJECT_ROOT`, `UNSUPPORTED_RUNNER`, `IMAGE_UNAVAILABLE`, `OOM_KILLED` ✔ (`tjc-be-test-execution-sandbox/app/src/common/errors/sandbox-fact-error.ts`, `src/executions/execution-pipeline.service.ts:241-261`; WI-085 §2.3). `COMPOSER_INSTALL_FAILED` NO existe en el código (solo aparece como ejemplo en un archivo de contrato): no lo busques.

**Ojo con dos códigos:** `TEST_ENVIRONMENT_CONFIGURATION_INVALID` solo sale cuando la salida de error contiene el marcador de Jest «Validation Error:» (no aplica a PHP) (`execution-pipeline.service.ts:560,585-593`). Un fatal de PHP sin archivo de resultados (bootstrap roto, extensión o BD ausente) sale como **`TEST_EXECUTION_FAILED`** (categoría `TEST_RUNTIME`; `:570-573`), y un error de sintaxis como `TEST_COMPILATION_FAILED` (`:564-569`). En una corrida oficial esos dos códigos se conservan como resultado de la estrategia y no se repiten (4.2.3); por eso **no se lanza ninguna corrida oficial en un repo que no tenga smoke verde (1.4)**: en un repo sin smoke verde, un `TEST_EXECUTION_FAILED` es un fallo de qualification (se corrige y se repite), no un resultado.

**Memoria:** el Sandbox acota el contenedor a 1 GiB, pero PHP tiene además su propio `memory_limit`, que en la imagen nueva es **512M** (antes 128M, el valor por defecto de php-cli, con el que orm fallaba). Un `Allowed memory size of … bytes exhausted` es del límite de PHP, no un `OOM_KILLED` del contenedor. `memory_limit` forma parte del entorno que se congela con el protocolo (modelo, presupuestos, imagen).

### 1.4 Checklist de smoke que puedes ejecutar tú solo
Hazlo sobre el **SHA base** del fork (money `93f145c`, orm `b44f3df`) y luego, cuando exista, sobre el HEAD del PR. **No lo hagas en Vouchers** mientras esté EN REVISIÓN (ver 1.2). Necesitas Docker. Usa la **imagen NUEVA** del Sandbox: si usas una imagen vieja o genérica, el resultado no vale.

**Diferencias con el Sandbox real (el smoke es ejecutable y representativo, pero no idéntico):** el Sandbox solo fija `Memory` (no `MemorySwap`: el `--memory-swap=1g` de los comandos reproduce la corrida del informe del Sandbox), monta el repo en `/app`, corre como usuario `sandbox` con `CapDrop ALL` y `no-new-privileges`, inyecta `APP_ENV=testing` y un `APP_KEY` aleatorio, y en el flujo real ejecuta solo los archivos de prueba generados (no la suite completa). El smoke sirve para detectar brechas de instalación y de arranque, no para reproducir al 100 % una corrida.

**Paso A. Obtener/construir la imagen nueva** (una sola vez). Necesitas tres archivos del repo del Sandbox (`app/docker/php/Dockerfile`, `restore-workspace-acl`, `zz-sandbox.ini`, commit `a4231d7`, rama `feature/jean`). Si no tienes acceso a ese repo, pídeselos al usuario/cross (⚠ no los copies de memoria). Luego:
```bash
docker build -t tjc-sandbox-php:8.3-nonroot <carpeta-con-los-3-archivos>
docker image inspect --format '{{.Id}}' tjc-sandbox-php:8.3-nonroot   # anota el digest
```
⚠ La imagen verificada en el smoke tiene digest `sha256:e41aa91a…fbc7` (ver 1.1). Una reconstrucción puede dar otro digest porque la base `php:8.3-cli` no está fijada: anota el tuyo y las versiones de abajo, y dile al usuario si difieren.

**Paso B. Clonar el SHA base** (ejemplo money; cambia repo y SHA):
```bash
mkdir -p ~/tesis-smoke && cd ~/tesis-smoke && rm -rf money && git clone https://github.com/rag-tesis-org/money.git && cd money && git checkout 93f145c
```

**Paso C. Verificar que la imagen es la nueva** (si no coincide, PARA y avisa):
```bash
IMG=tjc-sandbox-php:8.3-nonroot
docker run --rm $IMG php -v                                   # esperado: PHP 8.3.36
docker run --rm $IMG php -r 'echo INTL_ICU_VERSION, PHP_EOL;'  # esperado: 76.1
docker run --rm $IMG php -m | sort > ../ext-imagen.txt         # deben estar intl, gd, zip, bcmath, gmp; NO pdo_pgsql/pdo_mysql
docker run --rm $IMG php -r 'echo ini_get("memory_limit"), PHP_EOL;'   # esperado: 512M
```

**Paso D. Instalar como lo hace el Sandbox** (1 CPU, 1 GiB, 128 procesos, red habilitada). Como los forks no tienen `composer.lock`, esto equivale a resolver y escribir un lock local (no lo subas al fork):
```bash
time docker run --rm --cpus=1 --memory=1g --memory-swap=1g --pids-limit=128 \
  --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" -e COMPOSER_HOME=/tmp -e COMPOSER_CACHE_DIR=/tmp/cc \
  -v "$PWD":/w -w /w $IMG \
  composer install --no-interaction --no-progress --prefer-dist --no-scripts
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w $IMG composer check-platform-reqs
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w $IMG composer show > ../versiones-instaladas-money.txt
```
Tiempos de referencia del smoke del Sandbox: money ≈ 11 s, orm ≈ 19 s (informe §3). Si Composer se queja de una extensión (`ext-...` missing) con la imagen nueva, anótala: no es esperable en money ni orm.

**Paso E. Ejecutar PHPUnit sin red, con los límites de tests** (120 s):
```bash
time docker run --rm --network none --cpus=1 --memory=1g --memory-swap=1g --pids-limit=128 \
  --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" -e APP_ENV=testing -v "$PWD":/w -w /w $IMG \
  timeout 120 php vendor/bin/phpunit --log-junit /tmp/junit.xml 2>&1 | tail -40
```
Referencia: money debe dar 1060 tests OK en ≈ 2 s; orm 3686 tests OK (con avisos) en ≈ 16 s con 512M de `memory_limit` ✔ informe §3. Si tus números difieren mucho, o falla algo que el informe da como verde, anótalo y avisa. Los tests que ya fallen en la **línea base** (sin el cambio del PR) se anotan; un repo con la línea base roja no es apto.

**Paso F. Interpretar el resultado**
| Resultado | Significa | Qué hacer |
|---|---|---|
| Instala y PHPUnit corre en verde (como en el informe) | El Sandbox debería poder con el repo | Anota tiempos, digest de la imagen, versión de PHP/ICU y `composer show`. Sigue con la sección 2 |
| Composer falla por `ext-X` | La imagen que usas no es la nueva, o falta una extensión nueva | **Para.** Revisa el paso C; anota `ext-X`, el SHA y los comandos; avisa al usuario/cross. No cambies el repo ni «arregles» tú el Sandbox |
| PHPUnit falla al arrancar (bootstrap, constante o clase indefinida) | Imagen incorrecta o problema nuevo; con la imagen nueva NO es esperable en money ni orm | Anota el mensaje literal (primeras 20 líneas) y avisa. El Sandbox lo reportaría como `TEST_EXECUTION_FAILED`: es un fallo de qualification, no un resultado |
| `Allowed memory size of … exhausted` | `memory_limit` de PHP demasiado bajo (p. ej. imagen sin `zz-sandbox.ini`: 128M) | Comprueba el paso C (`512M`); si no es 512M, la imagen es incorrecta: avisa |
| Instalación > 180 s o `Killed` por memoria | `INSTALL_TIMEOUT` / `OOM_KILLED` probable en el Sandbox | Anota tiempos y memoria; avisa (se decide subir límites o precalentar la caché, no tú) |
| Tests dependen de BD y fallan (`no such table`, `could not find driver`) | Caso de Vouchers (EN REVISIÓN) | No lo arregles; ver 1.2 |
| Distinto en Docker que en tu PHP local | Tu PHP local no es la referencia | Vale lo que diga la imagen de Docker |

**Qué documentar siempre:** repo, SHA, fecha, comandos usados, digest de la imagen, salida relevante, decisión tomada y quién la tomó. Un fallo corregido se vuelve a probar desde cero. Nada de esto entra a las métricas del experimento.

### 1.5 Otras comprobaciones de qualification (las hace el sistema; tú solo confirmas en la Console)
| Qué | Cómo lo ves | Lo esperado |
|---|---|---|
| Indexación del repo | En el Project, estado de la versión indexada | Completada; ⚠ duración y tamaño real desconocidos (doctrine/orm es el mayor: tope del ZIP 50 MiB) |
| Raíz efectiva del proyecto | Debe ser la raíz `.` | ⚠ Si algún fork trae varios `composer.json` fuera de `vendor/`, no es ejecutable (decisión pendiente): avisa |
| Parsing / targets | En el Run, la lista de símbolos cambiados (métodos/funciones) | Que aparezca el método objetivo del caso; si falta, avisa |
| Generación de prueba y flujo Core–Sandbox | Una corrida de **prueba** (esfuerzo `low`, sin valor de evidencia; ver 2.d) | Solo si el usuario la pide, y **nunca sobre el PR, el Run ni el caso oficial/congelado**: usa un PR y un Project aparte. Cambiar el esfuerzo es un cambio global de Core con redeploy que solo hace el usuario, y mezclar clases `low`/`medium` invalida la evidencia |

---

## 2. Cómo se crea un caso y se lanza el experimento

### 2.a Trabajar sobre `develop` del fork
0. **Antes de empezar, despierta Integration y Core con `GET /health` (ver 0.3 bis)** y espera la respuesta (≈ 30 s la primera vez). Un webhook que llegue con Integration dormido puede perderse.

1. Clona el fork y trabaja sobre `develop` (ya existe, creada desde main/3.7.x). Crea una rama de trabajo desde `develop`, p. ej. `caso-<id>-<descripcion>`.
2. Aplica **exactamente** el cambio controlado que te entregó el equipo investigador (P1/P3) o la implementación basada en el issue público #11600 (P2). Tú no decides el cambio ni el oráculo: los define el equipo y te los entrega (el oráculo NO se te entrega para copiarlo al repo; ver abajo).
3. **Nunca** pongas el oráculo (la especificación esperada), ni su identificador, ni notas sobre qué debe probar la prueba, en el repo, en el título/descripción/comentarios del PR ni en mensajes de commit. Esas entradas las lee el sistema; el oráculo debe quedar fuera de lo que ven RAG y GENERALIST_AGENT ✔ (`spec/features/008-experimental-comparison/spec.md`, «Repositorios piloto»: «no se copian ni almacenan en repositorios de producto ni piloto»).
4. Abre el PR **contra `develop` del fork** (base = `develop`, head = tu rama). No lo abras contra el repo original (upstream): la App solo está instalada en los forks y los repos ajenos no se pueden vincular ✔ (WI-085 §4.3).
5. **Fija el HEAD.** Una vez abierto el PR y creado el Run, **no empujes más commits a ese PR**: un commit nuevo (`synchronize`, incluido force-push) crea otro Run y deja el anterior como obsoleto (`OBSOLETE`), y los experimentos del Run viejo quedan sin vigencia ✔ (`spec/features/013-pr-driven-analysis/spec.md:15`; Console: el botón «Comparar RAG vs GA» no aparece si el Run es `OBSOLETE`, `AnalysisRunDetailPage.tsx:285`). Si te equivocaste, avisa en vez de arreglar con otro commit. **Tampoco** cierres, mergees, reabras ni conviertas a borrador el PR hasta terminar las descargas y la auditoría CT-08: cerrar, mergear o pasar a borrador deja el Run sin vigencia, y reabrir crea un Run nuevo (`tjc-be-rag-core-api/app/src/github-webhooks/github-webhooks.service.ts:145-150,186-196`); CT-08 exige un Run finalizado y vigente.
6. Orden importante: el Project/binding del fork debe existir **antes** de abrir el PR; un PR anterior al binding se ignora ✔ (WI-085 §4.3; Core: `tjc-be-rag-core-api/app/src/github-webhooks/github-webhooks.service.ts:176`). Los tres Projects ya están vinculados.

### 2.b Cómo se crea el AnalysisRun
- **Automático:** al abrir el PR, GitHub avisa a la integración (webhook → **GitHub Integration** → **Core**), que crea el AnalysisRun para ese repo/PR/HEAD ✔ (`tjc-be-github-integration-api/app/src/github-webhooks/github-webhook-core-client.ts:21-37`; Core: `tjc-be-rag-core-api/app/src/github-webhooks/github-webhooks.service.ts:93-102`). Tú no haces nada más. Un PR en borrador o con rama base distinta a la de integración **no inicia** un Run ✔ (`github-webhooks.service.ts:186-196`): confirma que tu PR va contra `develop` y no es borrador.
- **Dónde verlo:** Console → menú «Runs» (`/analysis-runs`) o Project → Runs; entra al Run (`/projects/<projectId>/runs/<analysisRunId>`).
- **Estados:** `QUEUED` y `PROCESSING` (en curso, la página se actualiza sola), y terminales `SUCCESS`, `BEHAVIORAL_MISMATCH`, `TECHNICAL_GENERATION_FAILURE`, `INFRASTRUCTURE_FAILURE`, `BASELINE_FAILED`, `NO_ADDITIONAL_TESTS_REQUIRED`, `NO_TEST_RELEVANT_CHANGES`, y además `ACTION_REQUIRED` y `OBSOLETE` ✔ (`app/prisma/schema.prisma:145-157`). Tiempos: ⚠ no hay valor medido; indexación + análisis pueden tardar de minutos a decenas de minutos en repos grandes. Si pasan 30 minutos en `QUEUED`/`PROCESSING` sin cambio, avisa (no vuelvas a empujar ni a abrir PR).
- **ACTION_REQUIRED:** el sistema detectó una regla de negocio que necesita confirmación humana y se detiene hasta tenerla. La pregunta aparece en la bandeja «Action required» (`/action-required`). Solo **Maintainer o Admin** puede responder (incluida la opción «No lo sé», que no desbloquea) ✔ (`013 spec.md:22-24`; matriz rol §6.13). **Tú no inventes la respuesta**: avisa al usuario y que él (o quien tenga autoridad funcional) responda. Mientras el Run esté en `ACTION_REQUIRED` no se puede lanzar el experimento (la Console oculta el botón) ✔ (`AnalysisRunDetailPage.tsx:284`).
- Los resultados con `BASELINE_FAILED` o `INFRASTRUCTURE_FAILURE` se tratan como fallos de qualification o externos (sección 4), no como resultado.

### 2.c Lanzar el experimento RAG vs GENERALIST_AGENT
1. En el Run (estado terminal y vigente, con al menos un método/función cambiado) pulsa exactamente **«Comparar RAG vs GA»** (lleva a `/projects/<projectId>/experimental?analysisRunId=<id>`) ✔ (`AnalysisRunDetailPage.tsx:315-321`; ruta `router.tsx:46`). En la misma página hay otros dos botones parecidos, «Comparación de estrategias →» y «Comparar recuperación SE vs SEM», que **no** son este experimento. Ese botón no depende de tu rol: se oculta si el Run está `ACTION_REQUIRED`/`OBSOLETE` o no tiene método/función elegible. El rol Writer se exige en la pantalla siguiente: si no eres Writer, no podrás pulsar «Ejecutar comparación» (`ExperimentPage.tsx:37,190`).
2. Pantalla «Comparar RAG vs Agente generalista»: eliges **solo el «Target experimental»** (el método/función del caso) y pulsas **«Ejecutar comparación»** ✔ (`ExperimentPage.tsx:168-199`). Elige el target exacto que el equipo definió para el caso.
3. **Repeticiones:** fijas en 3 por estrategia (no se elige; la API solo acepta 3) → 6 repeticiones, 3 pares ✔ (`app/src/experiments/dto/create-experiment.dto.ts` `@IsIn([3])`; INTEROP §6.5.1). El orden RAG/GA dentro de cada par es aleatorio y reproducible desde la `randomizationSeed` que queda registrada ✔.
4. **Budgets (presupuestos)** = topes iguales para ambos brazos para que la comparación sea justa: tope de llamadas a herramientas del agente (`toolCallCap`), presupuesto de tokens de contexto (`contextTokenBudget`) y duración máxima por generación (`maxDurationMs`). Valores por defecto: **20 llamadas, 8 000 tokens, 120 000 ms** ✔ (`app/src/config/generation-budget.defaults.ts:8-10`). Se fijan en Core por variables de entorno `AGENT_MAX_TOOL_CALLS`, `RETRIEVAL_MAX_CONTEXT_TOKENS`, `GENERATION_TIMEOUT_MS` (si no existen, rige el valor por defecto) ✔ (`experiment-job.handler.ts:351-359`; `experiments.service.ts:368`). **No los eliges tú** y no se pueden cambiar desde la Console; **los 20/8 000/120 000 son solo los valores por defecto del código**: Core toma las variables de entorno vigentes al crear el experimento (`experiments.service.ts:355-363`), así que Render puede tener otros. Compara siempre lo que muestra la pantalla con los valores CONGELADOS por el protocolo que te entregue el equipo, no con estos defaults; cambiarlos es decisión de protocolo (afecta la validez) y se congela antes. Al crearse el experimento quedan guardados y se ven en la pantalla («Tope de tool calls», «Presupuesto de contexto», «Duración máxima») ✔ (`ExperimentComparison.tsx:69-71`).
5. **HU17 / HU18** (historias de usuario del backlog interno, `spec/backlog.md:42-43`):
   - **HU17 (Must, Sprint 4):** «comparar RAG con GENERALIST_AGENT bajo condiciones experimentales externas controladas; ambos brazos comparten snapshot, target y entorno y guardan resultados por trial». Es lo que haces con el botón anterior. Estado en backlog: `H-BACKLOGGED` (el backlog no se actualizó, pero la funcionalidad existe en Core y Console ✔).
   - **HU18 (Could):** «capturar el siguiente PR elegible… La captura se desarma al reservar el Run y no publica Checks experimentales». En la Console existe un panel **«Capturar el próximo PR»** (botón «Armar captura») pero está marcado como **propuesta sin contrato aprobado y sin adaptador real** («HU49 — propuesta… sin adapter live todavía», `run-comparison/CaptureNextPrPanel.tsx:44-50`). **No lo uses** en los pilotos: el flujo oficial es abrir el PR y lanzar el experimento sobre su Run.
6. Una sola pulsación. La Console genera una `Idempotency-Key` NUEVA en cada pulsación (`ExperimentPage.tsx:87`, `api/idempotency.ts:4-6`), así que **no hay protección por llave entre pulsaciones distintas**. El botón se deshabilita mientras la creación está en curso y cuando la URL ya trae `experimentId` (`ExperimentPage.tsx:196`), pero si recargas la pantalla con solo `?analysisRunId=…` el botón se rehabilita y crearía un segundo experimento. Antes de volver a pulsar tras una recarga, comprueba en el Run si ya existe uno. Para reabrir uno existente: `/projects/<projectId>/experimental?experimentId=<id>` (`ExperimentPage.tsx:31-32`).
7. Seguimiento: la pantalla muestra «Preparando experimento» / «Ejecutando estrategias pareadas» y el avance `completedRepetitions/6` (se actualiza sola por WebSocket). El experimento termina en `COMPLETED` o `FAILED` ✔ (INTEROP §6.5, `ExperimentStatusResponse`). Un `FAILED` con código `EXPERIMENT_FAILED` o `EXPERIMENT_WORKER_LOST` puede reanudarse (`failureCode` en la pantalla) ✔ (INTEROP §6.5): **no lo reanudes por tu cuenta**; avisa.
8. Ruta de API equivalente (solo referencia, no es necesario usarla): `POST /experiments` (cuerpo: `analysisRunId`, `symbolFilePath`, `symbolQualifiedName`, `repetitions: 3`; cabecera `Idempotency-Key`), `GET /experiments/{id}`, `GET /experiments/{id}/results`, `GET /analysis-runs/{id}/experiments` ✔ (INTEROP §6.5 líneas 275-278; `create-experiment.dto.ts`).

### 2.d Verificar el modelo y el esfuerzo: antes de lanzar (entorno) y después (`modelConfig`)
**Antes de lanzar:** el operador no ve Render, así que pide al usuario/cross confirmación explícita de que `LLM_REASONING_EFFORT=medium` (y `gpt-6-luna`) están vigentes en Core antes de crear el experimento; la spec exige verificar el entorno ANTES de crear un experimento de evidencia (`spec/features/008-experimental-comparison/spec.md:91`). No lances las 6 generaciones sin esa confirmación.

**Después:** la configuración de modelo es **global de Core** (variables `LLM_MODEL` y `LLM_REASONING_EFFORT`), la misma para todos; **no la puedes cambiar ni la ves en Render**. El valor que importa es el que quedó **guardado en ese experimento** (`modelConfig`), que sí puedes ver:
1. Console, pantalla del experimento (`/projects/<projectId>/experimental?...`): el bloque de condiciones solo se muestra con el experimento en estado **`COMPLETED`** (`ExperimentPage.tsx:292-299`); en curso o en `FAILED` NO aparece (en ese caso no descargues como definitiva y avisa). Bloque de condiciones con **«Proveedor y modelo»**, **«Versión del modelo»**, **«Esfuerzo de razonamiento»**, **«Temperatura»**, **«Máximo de tokens de salida»**, y los tres presupuestos ✔ (`experiments/ExperimentComparison.tsx:64-71`).
2. Equivalente en API: `GET /experiments/{id}` → campos `model.provider`, `model.model`, `model.modelVersion`, `model.reasoningEffort`, `model.temperature`, `model.maxOutputTokens` y `budget` ✔ (`app/src/experiments/experiment-status.presenter.ts:25-26,42-60`; INTEROP §6.5.1). El **endpoint** (URL del proveedor) **no se expone**: ⚠ no hay forma de verlo desde la Console; el contrato solo guarda proveedor y modelo. Si necesitas confirmarlo, pídelo a cross.
3. También queda en la evidencia descargada (`generation[].provider/model/modelVersion/reasoningEffort`) ✔ (`evidence-bundle.assembler.ts:303-306`).
4. **Debe decir:** modelo `gpt-6-luna` y esfuerzo `medium` (config oficial para evidencia). Con `low` es solo prueba económica sin valor de evidencia; `medium` es evidencia oficial y ambas clases no se mezclan ✔ (`spec/features/008-experimental-comparison/spec.md` «Corridas de prueba y corridas de evidencia», WI-CORE-075). No hay marca ni bloqueo automático: **lo compruebas tú cada vez**.
5. **Si no coincide** (otro modelo, otro esfuerzo, `null` donde debería haber valor): **no continúes**: no descargues como definitiva, no relances, no cambies nada. Avisa a cross/usuario con el `experimentId` y una captura de la pantalla. Un experimento con configuración distinta no es evidencia del protocolo.

---

## 3. Qué exportar y dónde

Todo lo descargable se hace con el rol Reader o superior, **solo cuando el proceso ya terminó** (antes responde `409 EVIDENCE_NOT_FINISHED` y el botón avisa «La evidencia estará disponible cuando termine el proceso») ✔ (`evidence/EvidenceDownload.tsx:14-16`; INTEROP §6.16).

### 3.a «Descargar evidencia (JSON)»
| Dónde | Ruta Console | Endpoint | Archivo |
|---|---|---|---|
| Del **AnalysisRun** | Detalle del Run (`/projects/<p>/runs/<id>`), botón **«Descargar evidencia (JSON)»** ✔ (`AnalysisRunDetailPage.tsx:478`) | `GET /analysis-runs/{id}/evidence` | `evidence-analysis-run-<id>.json` |
| Del **ExperimentRun** | Pantalla del experimento, sección «Evidencia versionada», mismo botón ✔ (`ExperimentPage.tsx:308-312`) | `GET /experiments/{id}/evidence` | `evidence-experiment-<id>.json` |
- Nombre del archivo: lo genera la Console (`evidenceFileName` en `evidence/download.ts`) ✔.
- **Los dos paquetes NO tienen el mismo contenido** (`EvidenceBundleResponse`, `schemaVersion '1'`, `interoperability-contract.md:1305-1377`):
  - **Paquete del Run** (`evidence-analysis-run-…json`): repositorio/PR/HEAD (`repositoryName`, `pullRequestNumber`, `headSha`), `analysisRunId`, `projectVersionId`, `snapshotRef`, targets y `publication`.
  - **Paquete del experimento** (`evidence-experiment-…json`): `analysisRun: null` y `publication: null` (`app/src/evidence/evidence-bundle.assembler.ts:369-379`). NO trae repo/PR/HEAD, `analysisRunId`, `projectVersionId`, `snapshotRef`, targets ni `targetId`; trae `subjectId` (= `experimentId`), `generatedAt`, `generation`, `agentExploration`, `sandbox` y `experimental`, y `retrieval`/`context` solo del brazo RAG.
  - **Para unir un experimento con su Run/HEAD/target** anota aparte: `analysisRunId` (está en la URL de la Console, `?analysisRunId=`), `projectVersionId` y `targetId` (de `GET /experiments/{id}` o `/results`, `app/src/experiments/experiment-status.presenter.ts:15-30`) y el `headSha` (del JSON del Run).
- Contenido común (por target)  `retrieval` (modo, candidatos), `context` (chunks elegidos/descartados, reglas funcionales usadas), `generation` (estrategia, repetición, intento, proveedor, modelo, esfuerzo, tokens, duración, `artifactHash`), `agentExploration` (pasos de herramientas, archivos inspeccionados, tope), `sandbox` (`executionId`, perfil, hechos del runner: compiló, ejecutó, pasó, pruebas totales/pasadas/falladas, etapa de fallo; `requestId`, `correlationId`), `experimental` (`pairId`, `pairPosition`, `attempt`, `randomizationSeed`, `technicallyEvaluable`) y `publication` (solo en el paquete del Run) ✔. No incluye razonamiento interno ni credenciales; los fragmentos de código son datos potencialmente confidenciales: guárdalos solo en la carpeta de evidencia compartida ✔.
- Tamaño: ⚠ no está documentado; el paquete lleva datos por repetición, por lo que puede llegar a cientos de KiB; no hay tope documentado.
- Lo que **no** incluye: el texto del prompt ni su hash (el hash del prompt es interno y no se exporta; el JSON sí trae `artifactHash`, el SHA-256 de la prueba enviada al Sandbox), el oráculo, CF/CO, el veredicto (no hay ganador automático) ✔.

### 3.b Resultados del ExperimentRun (CF, CO, VT)
- **Lo que da el sistema** (pantalla «RESULTADO»/tabla de repeticiones y `GET /experiments/{id}/results`): por estrategia y repetición, `valid`, `failureType`, duraciones, tokens, costo estimado, y agregados (`validRate`, `compilationRate`, `executionRate`, `passedRate`, `technicallyValidRate`, `assertionFailureCount`, `evaluableRepetitions`, `nonEvaluableRepetitions`, `toolCalls`, etc.) ✔ (INTEROP §6.5, `StrategyMetricsResponse` y `ExperimentRepetitionResponse`). **No hay CF ni CO**: no se derivan de `valid`/`passed` y **no hay ganador automático** ✔ (`spec/transversal/experimental-metrics`; `noAutomaticVerdict.test.tsx` en Console).
- **IDs a anotar:** `experimentId`, `pairId`, `repetition` (1-3) y `executionId` (Sandbox) de cada fila ✔ (JSON del experimento); `analysisRunId` (URL de la Console), `projectVersionId` y `targetId` (`GET /experiments/{id}`/`/results`) y `headSha` (JSON del Run) ✔ — no están en el JSON del experimento.
- **CF, CO y VT** los asigna una persona (el evaluador definido por el equipo) comparando la prueba generada con el oráculo y se registran fuera del sistema (hoja de evidencia). **VT** (validez técnica) puede apoyarse en `technicallyValidRate`/`compiled`+`executed` ✔ (INTEROP §6.5.1); CF y CO son solo humanos. Cómo se rellenan es del equipo; este runbook no los define.
- La prueba generada (contenido exacto) hoy **no se descarga por la Console**; Core la guarda internamente (≤ 256 KiB, con `testContentSha256`) pero no la expone en la API ni en el JSON de evidencia ✔ (`008 spec.md` «Evidencia privada por repetición», WI-CORE-053). ⚠ Para que el evaluador califique CF/CO necesita ver la prueba generada: **hoy no hay un botón ni endpoint para obtenerla**; pregunta a cross cómo la entregará (hay un hash `artifactHash` en la evidencia para verificar después). Esto es una brecha real.

### 3.c Trace de los 9 enlaces para CT-08
- **Dónde:** Detalle del Run → sección **«Traza operativa»** (`OperationalTraceSection.tsx:353`), con HEAD, `analysisRunId`, retrieval/context/generation/ejecuciones por target y bloque de publicación ✔. API: `GET /analysis-runs/{id}/trace` (Reader; `409 EVIDENCE_NOT_FINISHED` si el Run sigue en curso) ✔ (INTEROP §6.16).
- **Qué muestra:** por cada enlace solo `PRESENT` o `NOT_APPLICABLE` con sus identificadores: (1) repo/PR/HEAD, (2) `analysisRunId`, (3) changeset/targets, (4) `retrievalId`, (5) `contextId` (+ reglas funcionales), (6) `proposalIds`, (7)-(8) `executionId`+`outcome`, (9) publicación/Check (`PRESENT` si hay Check o publicación de pruebas; `freshness` CURRENT/STALE) ✔ (INTEROP §6.16, mapeo de los nueve enlaces).
- **Qué se comprueba a mano** (el sistema NO lo hace): ⚠ **no existe consulta inversa** (de resultado hacia PR/HEAD) ni un estado «enlace inconsistente» o «faltante»: solo `PRESENT/NOT_APPLICABLE`. La comprobación **directa** (PR/HEAD → publicación) se lee en la traza; la **inversa** la haces tú: partiendo del `executionId`/`proposalId`/`contextId`/`retrievalId` de la traza, verifica en el JSON de evidencia y en GitHub que cada identificador lleva de vuelta al mismo `analysisRunId`, `headSha`, PR y repositorio. Registra en la checklist (Tabla 54 de la tesis) por enlace: aplicabilidad, directa, inversa, resultado (CUMPLE / NO CUMPLE / N/A justificado) y el Evidence ID. Un enlace 7-9 puede ser N/A justificado solo si el Run terminó legítimamente antes (p. ej. `ACTION_REQUIRED`, sin targets); un enlace obligatorio que falta es incumplimiento ✔ (tesis Tabla 54; `harness/reports/arch-v1.0-aserciones-ct-propuesta.md` CT-08-A2/A4/A6).
- CT-08 audita **3 AnalysisRuns, uno por piloto** (decisión del usuario). No agregues funcionalidad ni endpoints para esto.
- Los Runs anteriores a la implementación del trace constan como `NOT_APPLICABLE` sin relleno; usa Runs nuevos ✔.

### 3.d Logs y hashes (qué hay y dónde)
| Dato | Dónde | Estado |
|---|---|---|
| Commit SHA (HEAD del PR) | JSON de evidencia **del Run** y traza: `headSha` (no está en el JSON del experimento); también en GitHub (PR → commits) | ✔ |
| SHA base del fork | tabla de `develop` en este runbook (money 93f145c, orm b44f3df, Vouchers 546f871) y GitHub | ✔ dado por el equipo |
| Hash del artefacto generado | `generation[].artifactHash` en la evidencia | ✔ (solo repeticiones nuevas; antes `null`) |
| `executionId`, `requestId`, `correlationId` del Sandbox | `sandbox[]` en la evidencia | ✔ |
| Salida de `composer`/PHPUnit del Sandbox | Core guarda **acotado y saneado** (≤ 8 KiB por entrada, 40 KiB total) pero no lo expone; el Sandbox **no devuelve stdout/stderr completos** | ✔ `008 spec.md` WI-CORE-060/053: **no es descargable por la Console** ⚠ |
| Logs de servidores (Render / VM del Sandbox) | solo cuentas con acceso a esas consolas | ⚠ no es tu acceso: pídelo a cross si se necesita |
| Registro de `jobs` (cola interna de Core) | tabla interna; no hay pantalla ni API | ⚠ |
| Versiones realmente instaladas por Composer | tu `composer show` del smoke (1.4 paso D) | ✔ (tuyo; necesario porque no hay `composer.lock`) |
| Versión de PHP/ extensiones de la imagen | `php -v`, `php -m` del smoke | ✔ (tuyo) |
| Hash de los archivos que entregas | `shasum -a 256 <archivo>` | ✔ (tuyo; anótalo en la hoja) |

### 3.e Registro de evidencia (Anexo L, Tabla 70 de la tesis)
Columnas reales (`referencias/tesis.md`, Anexo L, «Tabla 70. Estructura del evidence-register»): **evidence_id · OE / indicador · Fecha · Proyecto / snapshot / Run · Tipo · Ubicación maestra · Estado · Qué demuestra.** Estados válidos: PLANIFICADA, DISPONIBLE, VERIFICADA, NO DISPONIBLE (tesis §3.3.14; VERIFICADA solo cuando se comprobó que sustenta la afirmación).

| Campo | Se puede automático | De dónde / cómo se llena |
|---|---|---|
| evidence_id (p. ej. `EV-OE5-03`) | **MANUAL** | Core explícitamente NO genera identificadores `EV-OE*` (INTEROP §6.16). Lo asigna el equipo |
| OE / indicador | **MANUAL** | Decisión del equipo (OE5 para estos pilotos; CT-08 para el checklist) |
| Fecha | **AUTO (parcial)** | `generatedAt` del JSON de evidencia; si no, fecha de descarga |
| Proyecto / snapshot / Run | **AUTO solo combinando archivos** | JSON del **Run**: `analysisRun.repositoryName`, `pullRequestNumber`, `headSha`, `snapshotRef`, `projectVersionId`, `analysisRunId`. JSON del **experimento**: solo `experimentId` (`subjectId`) y `generatedAt`; `targetId` y `projectVersionId` salen de `GET /experiments/{id}`; `analysisRunId` de la URL |
| Tipo | **MANUAL** | Elegir: dataset / log / acta / hash / captura / configuración / commit-PR-tag / otro |
| Ubicación maestra | **MANUAL** | Ruta en la carpeta compartida (p. ej. bajo `05_OE5_EXPERIMENTO`) |
| Estado | **MANUAL** | Lo cambia quien verifica |
| Qué demuestra | **MANUAL** | Redactar la afirmación concreta |

Resultado: 2 de 8 campos se pueden rellenar automáticamente (Fecha, y Proyecto/snapshot/Run); los otros 6 son manuales. Detalles de CT-08: la checklist (Tabla 54) lleva su propio Evidence ID por enlace y es manual.

### 3.f Estructura de carpetas, EV-OE5-xxx y sellado SHA-256: los define el handoff de cross
**Esta sección reemplaza la propuesta anterior.** La estructura de carpetas de evidencia, los identificadores `EV-OE5-xxx` y el sellado con SHA-256 los define el handoff que te entregará cross; este runbook **no** inventa una convención propia. Sigue ese handoff al pie de la letra.

Lo único que este runbook afirma, por ser un hecho del software (✔):
- **Qué se descarga y de dónde:** el JSON del Run («Descargar evidencia (JSON)» en el detalle del Run → `evidence-analysis-run-<id>.json`) y el JSON del experimento (mismo botón en la pantalla del experimento → `evidence-experiment-<id>.json`), solo cuando el proceso ya terminó; ver 3.a. La Console genera el nombre (`evidence-<tipo>-<id>.json`): no lo renombres sin instrucción del handoff.
- Los dos paquetes no tienen el mismo contenido (3.a): el del experimento no trae repo/PR/HEAD ni `analysisRunId`; anota esos datos aparte (3.a y 3.e).
- Core no genera identificadores `EV-OE*` (INTEROP §6.16): los asigna el equipo.
- Capturas que conviene guardar (si el handoff las pide): el bloque de condiciones del experimento (solo visible con el experimento `COMPLETED`), la tabla de resultados y la «Traza operativa» del Run.

---

## 4. Fallos esperables y qué NO hacer

### 4.1 Tabla de fallos
| Síntoma | Causa probable | Qué hacer | A quién avisar |
|---|---|---|---|
| Run/experimento falla con `DEPENDENCY_INSTALL_FAILED` | `composer install` falló: extensión PHP faltante (con la imagen nueva no esperable en money/orm; sí si la VM tiene la imagen vieja), dependencia sin versión compatible, red del Sandbox ✔ | No relances. Reproduce con el smoke (1.4) para ver el mensaje de Composer; anota extensión/paquete | Usuario/cross (decide imagen o repo) |
| `INSTALL_TIMEOUT` | Instalación > 180 s (por defecto; caché fría, repo grande como orm) ✔ | No relances en bucle. Anota repo y hora | Usuario/cross |
| «Allowed memory size of … bytes exhausted» en la salida de tests | `memory_limit` de PHP: 128M en la imagen vieja (orm fallaba al ≈ 52 %), 512M en la nueva ✔ informe §3.2 | Si ocurre con la imagen nueva, anota repo/SHA; si la VM tuviera la imagen vieja, avisa para que la actualicen. No relances | Usuario/cross |
| Integration/Core dormido (webhook perdido, Run que no aparece, 502/503 al abrir un Project) | Plan gratuito de Render: arranque en frío ≈ 30 s ✔ (`AGENTS.md` raíz); un webhook con Integration dormido puede perderse | Despierta con `GET /health` (0.3 bis); no abras otro PR ni empujes commits; avisa si el Run no aparece | Usuario/cross |
| Intentas P3 (Vouchers) y fallan tests con `no such table` o `could not find driver` | P3 NO APTO según el smoke (EN REVISIÓN) ✔ informe §3.3 | No toques el fork ni lances corridas oficiales; espera la decisión del usuario | Usuario |
| `TIMED_OUT` en tests | La prueba generada (o la suite) superó el tiempo; para Core es un fallo **de la prueba generada**, no externo ✔ (INTEROP §6.5.1) | **No se repite.** Conserva el resultado | Solo registro; avisa si es sistemático |
| `OOM_KILLED` (proceso matado, 1 GiB) | memoria del contenedor (no confundir con el `memory_limit` de PHP, 512M en la imagen nueva: un «Allowed memory size … exhausted» es de PHP y sale como fallo de ejecución, no como `OOM_KILLED`) (instalación o tests); categoría `INFRASTRUCTURE` ✔ (`sandbox-fact-error.ts:144-147`) | Core reintenta una vez automáticamente los resultados `INFRASTRUCTURE` del Sandbox (incluidos `OOM_KILLED` e `IMAGE_UNAVAILABLE`, salvo `TIMED_OUT`; INTEROP §6.5.1), así que verás un segundo intento sin haber hecho nada. Anota el caso; no relances | Usuario/cross |
| `TEST_EXECUTION_FAILED` («runner results file is missing/empty») | Un fatal de PHP sin archivo de resultados: con la **imagen nueva ya no es esperable en la línea base de money ni de orm** (ambas pasan el smoke ✔ informe §3); sí lo sería en P3/Vouchers (BD y migraciones ausentes; EN REVISIÓN) o si la VM aún corre la imagen vieja (sin `intl`, `memory_limit` 128M) ⚠. Es el código que el Sandbox emite en estos casos (`execution-pipeline.service.ts:570-573`) | **En un repo sin smoke verde es un fallo de QUALIFICATION, no un resultado**: detén el piloto, corrige y repite la habilitación. En un repo con smoke verde, una prueba generada que falla en ejecución es resultado de la estrategia: se conserva y no se repite. Si aparece en money/orm sin que el cambio lo explique, **primero** pregunta al usuario/cross si la VM tiene la imagen nueva | Usuario/cross (si es qualification) |
| `TEST_ENVIRONMENT_CONFIGURATION_INVALID` | Solo con el marcador de Jest «Validation Error:» (no esperable en estos repos PHP) ✔ | Es de qualification | Usuario/cross |
| `TEST_COMPILATION_FAILED` (prueba generada no compila) | error de la estrategia (sintaxis/uso de clases) | Es un **resultado de la estrategia**: se conserva, no se repite | Registro |
| Parser/indexación: el método objetivo no aparece como target, o la indexación no termina | gramática PHP o límites (ZIP 50 MiB, volumen de chunks) ⚠ | No cambies el PR. Anota repo/SHA y qué falta | Usuario/cross |
| Run `OBSOLETE` / botón «Comparar RAG vs GA» ausente | se empujó un commit nuevo (HEAD obsoleto) o el Run no es el vigente ✔ | No continúes sobre el Run viejo; **no empujes más commits**. Si fue un error, avisa antes de abrir otro PR | Usuario/cross |
| `503 GITHUB_VERIFICATION_UNAVAILABLE` | verificación de acceso a GitHub no disponible (0.3) ✔ | Una sola reconexión; no bucle | Usuario/cross |
| `403 PROJECT_ROLE_INSUFFICIENT` | tu rol es menor al mínimo (p. ej. Reader intentando lanzar) ✔ | No fuerces; no uses cuentas de otros | Usuario |
| `404 PROJECT_NOT_FOUND` / Project no aparece | no eres miembro activo o no hay registro de acceso ✔ | Verifica membresía; ver 0.3 | Usuario |
| `422 REASONING_EFFORT_UNSUPPORTED` al crear experimento | la temperatura configurada es incompatible con razonamiento activo ✔ (INTEROP §6.5.1) | No se creó nada; no reintentes | Usuario/cross (configuración de Core) |
| `422 UNSUPPORTED_PROJECT` al crear experimento | la versión no tiene framework de test detectado (PHPUnit) ✔ | No continúes | Usuario/cross |
| `503 LLM_PROVIDER_UNAVAILABLE` al crear experimento | modelo no disponible ✔ | No reintentes en bucle | Usuario/cross |
| Repeticiones fallan por el proveedor LLM (HTTP 429, 5xx, error de conexión) | fallo externo ✔ (INTEROP §6.5.1; `providers/openai-llm.provider.ts`) | Core reintenta **una sola vez** automáticamente (mismo par y configuración); un segundo fallo marca la repetición `technicallyEvaluable: false`. **No relances tú** | Registro; avisa si afecta varias repeticiones |
| Fallo de la llamada porque el proveedor rechaza el modelo o el esfuerzo | configuración inválida ✔ (INTEROP §6.5.1: la repetición falla con `failureType UNKNOWN`, sin reintento) | Para: el `modelConfig` no es válido | Usuario/cross |
| Experimento `FAILED` (`EXPERIMENT_FAILED` / `EXPERIMENT_WORKER_LOST`) | error del job o caída del worker de Core ✔ | No reanudes ni relances tú | Usuario/cross |
| `409 EVIDENCE_NOT_FINISHED` al descargar | el proceso no terminó ✔ | Espera al estado terminal | — |
| Run en `ACTION_REQUIRED` | requiere respuesta funcional de un Maintainer/Admin ✔ | No inventes la respuesta | Usuario (o quien tenga autoridad funcional) |
| Experimento lleva mucho tiempo en `PENDING`/`RUNNING` | Sandbox ocupado (2 ejecuciones a la vez) o cola de Core; ver sección 5 ⚠ | Espera; no lances otro | — (si pasan ≥ 30 min sin avance, avisa) |

### 4.2 Reglas del protocolo (obligatorias)
1. **Antes de congelar:** si algo falla, se corrige y se repite la habilitación. Todo queda documentado. No cuenta como resultado.
2. **Después de iniciar las corridas oficiales:** si un fallo obliga a **cambiar las condiciones** (imagen, límites, modelo, presupuestos, versión de dependencias, etc.), se **detienen los casos afectados**, se **preserva toda la evidencia ya generada**, se versiona y se abre una nueva versión (**«Pilot v2»**) **sin mezclar versiones**. Esa decisión la toman el usuario y cross, no tú.
3. **Fallo atribuible a la estrategia** (la prueba generada no compila, falla la aserción, se pasa del tiempo, respuesta sin `<?php`, timeout del agente): el resultado **se CONSERVA**. **No se repite para mejorar la salida.** ✔ (tesis §3.3.8: «nunca se repite un trial porque el test haya salido mal»; INTEROP §6.5.1).
4. **Fallo externo demostrable** (proveedor LLM 5xx/429/conexión, Sandbox inaccesible, `INFRASTRUCTURE` del Sandbox salvo `TIMED_OUT`): **un solo reintento**, con la **misma configuración, mismo caso y misma estrategia**, registrando la causa; un segundo fallo → «no evaluable técnicamente», se reporta aparte ✔ (tesis §3.3.8; INTEROP §6.5.1). Hoy **Core ya hace ese único reintento automáticamente**: no lances otro experimento para «arreglarlo».
5. **No modifiques** requisitos, oráculos, presupuestos, configuración ni puntuación (CF/CO/VT) **después de ver resultados**. Ambos brazos comparten repo, HEAD, target, requisito, modelo, configuración, Sandbox y presupuestos (decisión del usuario).
6. **No copies el oráculo** al repositorio ni a ningún lugar que vea RAG o GENERALIST_AGENT. No se lo des a ninguna estrategia ni lo pegues en prompts, PR, issues o commits.
7. `ACTION_REQUIRED` se resuelve **antes** de completar un trial; una abstención «No lo sé» no es un fallo de generación sino un caso pendiente hasta contar con conocimiento autorizado (tesis §3.3.8).
8. Las 54 ejecuciones del diseño OE5 son 3 repos × 3 casos × 2 estrategias × 3 repeticiones (27 pares). Cada caso/Run se corre una vez por protocolo; no repitas casos «para ver si sale mejor».

---

## 5. Qué NO puede hacer una segunda persona a la vez

| Qué | Por qué | Qué hacer | Fuente |
|---|---|---|---|
| Usar el Sandbox en paralelo sin saber que está compartido | El Sandbox acepta **2 ejecuciones simultáneas** (por defecto) en toda la VM; las demás esperan en `PENDING`; un solo experimento de Core ya puede lanzar hasta 3 repeticiones a la vez (`EXPERIMENT_REPETITION_CONCURRENCY=3`) | Coordina turnos: un experimento a la vez en todo el sistema | ✔ `sandbox/.env.example` (`SANDBOX_MAX_CONCURRENT_EXECUTIONS=2`), `execution-pipeline.service.ts:51,103`; `core/app/src/config/env.validation.ts:215` |
| Dos experimentos al mismo tiempo (aunque sean de Projects distintos) | Mezcla tiempos y colas (la latencia en cola no se aísla); los tiempos de ejecución del Sandbox forman parte de la evidencia (`durationMs`, esperas antes de `PREPARING`) | Un experimento a la vez, de principio a fin, y avisa por chat al empezar y al terminar | ✔ WI-CORE-061 (marcas de tiempo por etapa), `008 spec.md` |
| Cambiar el modelo o el esfuerzo | `LLM_MODEL`/`LLM_REASONING_EFFORT` son **únicos y globales** de Core; cambiarlos exige redeploy en Render y mezcla evidencia de distintas configuraciones; el protocolo exige una única configuración | No lo toques ni lo pidas sin avisar; solo el usuario | ✔ `env.validation.ts:477-507`; `AGENTS.md` (decisión de modelos) |
| Cambiar variables de Render (Core, Integration, Console) | Cualquier cambio reinicia el servicio y puede alterar la corrida de otra persona (budgets, modelo, CORS) | No tienes acceso y no lo necesitas | ✔ |
| Empujar commits a un PR con Run activo | Crea otro Run, obsoleta el actual y los experimentos pierden vigencia (2.a.5) | Una vez fijado el HEAD, solo lectura; para otro cambio, otro PR **con acuerdo previo** | ✔ `013 spec.md:15` |
| Lanzar dos experimentos del mismo Project/target a la vez | La Console envía una llave nueva en cada pulsación, así que no hay protección entre pulsaciones (solo ayuda reabrir con `?experimentId=`); se crean **dos experimentos independientes** que gastan dinero y ensucian el conjunto de evidencia. No hay un bloqueo «uno por Project» en el código leído | No lo hagas; si ocurre, avisa y **no borres** ninguno | ✔ `experiments.service.ts:155` (alcance `EXPERIMENT_CREATE`); ⚠ ausencia de otro bloqueo = no encontrado en lectura |
| Abrir/cerrar/mergear/reabrir/pasar a borrador un PR mientras otro corre o antes de terminar CT-08 | Cada evento crea, reemplaza o deja sin vigencia el Run del PR (cerrar, mergear o pasar a borrador → sin vigencia; reabrir → Run nuevo) y encola trabajo en Core | Coordina el orden de los PR en cada fork y no los toques hasta cerrar descargas y CT-08 | ✔ Core `tjc-be-rag-core-api/app/src/github-webhooks/github-webhooks.service.ts:132-196` |
| Cola de jobs de Core (poller) | Core procesa los jobs **de uno en uno por instancia** (el poller toma el siguiente job solo si no hay otro en curso): los experimentos de dos personas se **serializan** en cola sin avisar (el segundo espera) | Si ves que tu experimento no avanza, **no lo relances**: probablemente hay otro en curso | ✔ `app/src/jobs/jobs.service.ts:21,110-119`; `claimNext` con `SKIP LOCKED` y `LIMIT 1` (`jobs.repository.ts:120-135`) |
| Responder preguntas funcionales (ACTION_REQUIRED) por otro | Es autoridad funcional (Maintainer/Admin) y queda auditada con tu identidad; una respuesta equivocada pasa a conocimiento ACTIVE | No respondas por cuenta ajena ni «por probar» | ✔ INTEROP §6.13 |
| Descargar evidencia mientras el experimento sigue | `409`; además un paquete incompleto no sirve | Espera estado terminal | ✔ |
| Reanudar/relanzar un experimento `FAILED` | Puede reanudarse (limpia el fallo), pero altera el registro de lo ocurrido | Solo con autorización | ✔ INTEROP §6.5 nota `failureCode` |

**Cómo saber si el Sandbox está ocupado:** Console no muestra la ocupación. Señales: tu experimento tarda en pasar de `PENDING` y no avanza `completedRepetitions`; ⚠ no existe pantalla de ocupación. `GET <Sandbox>/health/ready` informa Docker y capacidad, pero el Sandbox no tiene URL pública registrada y requiere token (no tienes acceso) ✔ (`health.controller.ts:23-25`, `INTEROP §7.5`; `AGENTS.md`, sin URL pública). Pregúntale al usuario o a cross.

**Regla práctica de coordinación:** (1) un solo experimento «en vuelo» en todo el sistema; (2) antes de lanzar, avisa en el chat del equipo «Lanzo experimento <piloto/caso>» y espera el visto bueno de quien esté usando el sistema; (3) al terminar el estado terminal, avisa «Terminó <piloto/caso>, libre»; (4) los PR se abren de a uno por fork y se esperan hasta que el Run esté terminal; (5) turnos: P1 (compañero) y P3 (usuario) se alternan; P2 después, entre los dos; (6) ante la duda, espera y pregunta, no relances.

---

## 6. Anexo

### 6.1 Qué avisar y a quién (paras y avisas)
| Situación | Para y avisa |
|---|---|
| Antes de abrir un PR o iniciar sesión no pudiste despertar Integration/Core (`/health` no responde) | Usuario/cross; no abras el PR |
| Te piden tocar el fork de Vouchers o lanzar corridas de P3 | Para: P3 está EN REVISIÓN; confirma con el usuario |
| El smoke en money/orm no coincide con el informe (digest, versión de PHP/ICU, `memory_limit`, extensión) | Usuario/cross: puede que la VM no tenga la imagen nueva |
| 503 de verificación de GitHub, no ves el Project o tu rol es insuficiente | Usuario/cross |
| Smoke: falla de Composer, extensión faltante, bootstrap de PHPUnit roto, BD requerida, instalación lenta/OOM | Usuario/cross con el SHA, comandos y salida |
| El Run queda `QUEUED`/`PROCESSING` ≥ 30 min, o `INFRASTRUCTURE_FAILURE`/`BASELINE_FAILED` | Usuario/cross |
| `ACTION_REQUIRED` | Usuario (quien responde) |
| El `modelConfig` no es `gpt-6-luna` / `medium`, o aparece `null` | Cross/usuario; no continúes |
| El Run se volvió `OBSOLETE` o se empujó un commit por error | Usuario/cross |
| Experimento `FAILED`/`EXPERIMENT_WORKER_LOST`, o muchas repeticiones fallan por 429/5xx | Cross/usuario |
| Algo te pide una clave, token, o acceso a Render/Supabase | Usuario; no lo introduzcas |
| Necesitas la prueba generada para calificar CF/CO y no hay forma de verla (3.b) | Cross |
| Duda de si algo es fallo de la estrategia o externo | Cross: no repitas por tu cuenta |
| Alguien más está usando el sistema al mismo tiempo | Coordinación en el chat del equipo (sección 5) |

### 6.2 Glosario mínimo
- **AnalysisRun / Run:** análisis de un PR en un commit concreto (HEAD): extrae qué métodos cambiaron, busca contexto, genera pruebas y las ejecuta; queda vinculado a repo+PR+HEAD.
- **ExperimentRun / experimento:** comparación de las dos estrategias para un método cambiado de un Run: 3 repeticiones por estrategia (6 en total, 3 pares).
- **RAG:** estrategia «completa» del producto: recupera fragmentos de código relevantes (SE = semántico + estructural), los ordena con un `ContextBuilder` dentro de un presupuesto de tokens y usa el conocimiento funcional confirmado, y luego pide la prueba al modelo.
- **GENERALIST_AGENT (GA):** agente de solo lectura con herramientas (listar/leer archivos, buscar texto, inspeccionar símbolos); sin retriever RAG ni conocimiento funcional persistente; sin shell ni Internet.
- **Oráculo:** especificación «correcta» del comportamiento del cambio, definida y congelada **antes** de ver resultados, que NO se entrega a ninguna estrategia; contra ella una persona califica las pruebas.
- **CF / CO / VT:** métricas de evaluación. CF = calidad funcional (principal), CO = métrica secundaria, VT = validez técnica (guardarraíl: compila y se ejecuta); CF/CO son humanas, externas; las define el protocolo de la tesis (no se derivan de `valid`/`passed`).
- **Sandbox:** servicio aislado que ejecuta `composer install` y PHPUnit en Docker y devuelve hechos técnicos.
- **Project / binding:** Project = el repositorio gestionado en la Console; binding = su vínculo a GitHub (instalación de la App).
- **HEAD:** último commit del PR; un HEAD nuevo crea un Run nuevo y deja el anterior obsoleto.
- **ACTION_REQUIRED:** el Run espera una respuesta funcional humana.
- **Budget (presupuesto):** topes comunes de llamadas a herramientas, tokens de contexto y duración.
- **modelConfig:** proveedor, modelo, esfuerzo de razonamiento, temperatura y tokens guardados en el experimento.
- **Qualification / smoke:** prueba previa de que el repo se instala y se prueba en el Sandbox; sus fallos no son resultados.
- **Pilot v2:** nueva versión del protocolo cuando hay que cambiar condiciones tras iniciar; no se mezcla con la anterior.
- **cross:** la sesión coordinadora que reparte el trabajo entre los componentes; cuando este runbook dice «avisa a cross», avisa al usuario o a quien él te indique.
- **WI (work item):** unidad de trabajo interna del equipo (p. ej. WI-CORE-095 es la versión 2 de este runbook). **HU:** historia de usuario del backlog. **DEC:** decisión registrada (aprobada o pendiente). **INTEROP:** documento de contrato entre componentes (Core, Console, Integration, Sandbox). **OE5:** objetivo específico 5 de la tesis (comparar RAG con el agente generalista).
- **ICU / `intl`:** biblioteca y extensión PHP de internacionalización; money la exige (su bootstrap imprime la versión de ICU). En la imagen nueva: `intl` con ICU 76.1.
- **`memory_limit`:** límite de memoria de PHP (distinto del límite de 1 GiB del contenedor). 512M en la imagen nueva; 128M (por defecto de php-cli) era insuficiente para orm. Se congela con el entorno del protocolo.
- **Arranque en frío (Render):** los servicios gratuitos se duermen y tardan ≈ 30 s en responder la primera vez; por eso se despierta `GET /health` antes de abrir un PR.
- **CT-08:** auditoría manual de la trazabilidad de 9 enlaces sobre 3 AnalysisRuns (uno por piloto).
- **Evidence ID:** identificador `EV-...` del registro de evidencia (lo asigna el equipo, no el sistema).

### 6.3 Límites de este documento
- Los resultados del smoke de money, orm y Vouchers y los datos de la imagen (versiones, extensiones, `memory_limit`, digest, tiempos) provienen del informe `tjc-be-test-execution-sandbox/harness/reports/wi-sandbox-021-smoke-evidence.md` (✔ citado); este runbook no los reprodujo. El informe declara sus propios límites (§5): P3 sin BD, muestreo de memoria de 1 s, límite total de 10 min no aplicado, money solo en PHP 8.3.36 e ICU 76.1, y **imagen no desplegada en la VM ni flujo real Core → Sandbox probado**.
- ⚠ Hay que confirmar que la imagen nueva está desplegada en la VM del Sandbox antes del smoke y de cualquier corrida; la base `php:8.3-cli` no está fijada por digest, así que una reconstrucción puede variar.
- No existen hoy: consulta inversa del trace, estado de enlace inconsistente, descarga de la prueba generada, descarga de la salida completa de Composer/PHPUnit, pantalla de ocupación del Sandbox, bloqueo automático de configuración (`low` vs `medium`) y campo `caseId`/oráculo en el experimento.
- Los tiempos reales (indexación, instalación y experimento en el flujo real), el tamaño de la evidencia y los límites efectivos de la VM del Sandbox son desconocidos (⚠). La estructura de evidencia y los identificadores EV-OE5-xxx los define el handoff de cross (3.f).
- No se leyó ningún `.env` ni se usó ninguna clave.
