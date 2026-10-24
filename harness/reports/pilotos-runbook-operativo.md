# Runbook operativo de los pilotos
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

> Versión revisada de forma independiente (2026-10-24, WI-CORE-092). Solo lectura: se leyeron el código de Core, Sandbox, Integration y Console, el SDD y los forks `rag-tesis-org/*` con `gh api` (GET). No se ejecutó nada contra los pilotos. Rutas de código relativas a `Tesis/<repo>/` (son trazabilidad para el equipo; tú no necesitas abrirlas). Términos internos que verás: **cross** = la sesión coordinadora del trabajo (en la práctica, el usuario te dirá a quién escribir); **WI** = work item (unidad de trabajo interna); **HU** = historia de usuario; **DEC** = decisión registrada; **INTEROP** = contrato entre componentes; **OE5** = objetivo específico 5 de la tesis (el experimento RAG vs agente). Se explican en el glosario (6.2).
> Leyenda: ✔ verificado leyendo (fuente entre paréntesis) · ⚠ solo se confirma ejecutando o depende de una decisión.

Para quién es: una persona que sabe PHP, que opera desde su máquina con la Console (https://tjc-fe-rag-developer-console.onrender.com) y el Core en Render, y que NO necesita leer el SDD ni tocar `harness/` ni `spec/`.

---

## 0. Antes de empezar

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

### 0.4 Herramientas locales
| Herramienta | Para qué | Nota |
|---|---|---|
| Git | clonar el fork, crear rama y push | |
| `gh` (GitHub CLI) autenticada con tu cuenta | abrir el PR contra `develop` del fork | opcional si lo haces desde la web |
| PHP 8.3 y Composer 2 | reproducir localmente el smoke de la sección 1 | el Sandbox usa PHP 8.3 y Composer 2 ✔ (`tjc-be-test-execution-sandbox/app/docker/php/Dockerfile:10-11,19`) |
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
| Imagen PHP | `php:8.3-cli` + `acl` + `unzip` + Composer 2; usuario no-root `sandbox` (UID 10001); imagen gestionada `tjc-sandbox-php:8.3-nonroot`. Puede cambiarse con `SANDBOX_DEFAULT_PHP_IMAGE` (decisión de infraestructura, no tuya) | ✔ `tjc-be-test-execution-sandbox/app/docker/php/Dockerfile:10-23`; `src/container/container-limits.config.ts` |
| Extensiones | Solo las de la imagen base oficial: ctype, dom, fileinfo, mbstring, openssl, tokenizer, xml, pdo, pdo_sqlite, sqlite3, curl, iconv, json, sodium, zlib. **No** hay `intl`, `gd`, `zip`, `bcmath`, `gmp`, `pdo_mysql`, `pdo_pgsql`. La imagen no instala ninguna extensión adicional | ✔ `Dockerfile:5-8,16-18` (comentario + comandos); lista completa de la imagen base ⚠ (se comprueba con `php -m`, sección 1.4) |
| Instalación | `composer install --no-interaction --no-progress --prefer-dist --no-scripts`; respeta `composer.lock` si existe; con red solo en esta etapa; caché Composer compartida (volumen) | ✔ `container-runner.service.ts:219-240` |
| **`--no-scripts`** | No corre ningún script de Composer (`post-autoload-dump`, `post-install-cmd`, etc.). Los *plugins* de Composer sí se cargan | ✔ `container-runner.service.ts:203,227` |
| PHPUnit | `php vendor/bin/phpunit --log-junit <archivo> [rutas de test]`; el runner se elige si `composer.json` declara `phpunit/phpunit` o existe `phpunit.xml(.dist)` en la raíz efectiva | ✔ `src/runner-adapters/phpunit-test-runner.adapter.ts:14-37` |
| Perfiles | Un solo perfil PHP, `PHP_LARAVEL_PHPUNIT` (se usa también para PHP «puro»; el nombre dice Laravel, la imagen y el comando son genéricos) | ✔ `phpunit-test-runner.adapter.ts:18-19` |
| Raíz del proyecto | Se busca `composer.json` (mayúsculas/minúsculas exactas); si hay varios candidatos, la ejecución no es posible (decisión interna aún pendiente, `DEC-PHP-ROOT-001`). Composer y PHPUnit corren en esa raíz | ✔ `spec/features/019-project-root-detection/spec.md:14,17,19`; WI-085 §2.1 |
| Límites por defecto (los efectivos en la VM no se conocen) | memoria 1 GiB, 1 CPU, 128 procesos, instalación 180 s, tests 120 s, salida capturada 64 KiB, deadline total 10 min, workspace ≤ 2 GiB, descarga ≤ 200 MiB | ✔ `container-limits.config.ts`, `tjc-be-test-execution-sandbox/app/.env.example` (líneas `SANDBOX_*`); valores reales ⚠ |
| Red en tests | La instalación tiene red; la **ejecución de tests no** | ✔ `.env.example` («Timeouts propios para instalación (con red) y ejecución (sin red)») |
| Base de datos | No hay MySQL ni Postgres en el Sandbox; solo SQLite | ✔ `spec/features/019-project-root-detection/spec.md:29` |
| Concurrencia del Sandbox | 2 ejecuciones simultáneas por defecto; las demás esperan en `PENDING` | ✔ `.env.example` (`SANDBOX_MAX_CONCURRENT_EXECUTIONS=2`), `src/executions/execution-pipeline.service.ts:51,103` |
| Parser PHP en Core | `tree-sitter-php 0.24.2`; extrae clases, métodos y funciones; un archivo con error de sintaxis da menos fragmentos, no aborta | ✔ WI-085 §2.1 (`php-parser.service.ts`); comportamiento sobre estos repos ⚠ |
| Indexación | ZIP del repo ≤ 50 MiB; se ignoran carpetas `vendor`, `node_modules`, `.git`, `storage`, `cache`, etc. (en minúscula) | ✔ `app/src/config/env.validation.ts:98`; `indexing.constants.ts:3-14` |

### 1.2 ¿La brecha de extensiones BLOQUEA a cada piloto?
Lo siguiente sale de leer `composer.json`, `phpunit.xml(.dist)` y los workflows de la rama `develop` de cada fork (consultados con `gh api repos/rag-tesis-org/<repo>/contents/...?ref=develop`, solo lectura). Ninguno de los tres forks trae `composer.lock` en la raíz ✔ (listado del contenido raíz): Composer resolverá las **versiones más recientes permitidas** el día de la corrida, así que **registra las versiones realmente instaladas** (sección 3.d).

| | P1 `brick/money` | P2 `doctrine/orm` | P3 `EscolaLMS/Vouchers` |
|---|---|---|---|
| PHP requerido | `^8.2` ✔ (`composer.json`) → compatible con 8.3 | `^8.1` ✔ | `>=7.4` ✔ (pero ver dependencias) |
| PHPUnit | `^11.0` (necesita PHP ≥ 8.2) ✔ | `^10.5 \|\| ^11.5` ✔ | `^9.0` ✔ |
| Extensiones declaradas | `require-dev`: `ext-dom`, `ext-pdo` (ambas presentes en la imagen). `ext-intl` solo como `suggest` ✔ | `require`: `ext-ctype` (presente) ✔; `suggest`: `ext-dom`, `ext-deepclone` | ninguna directa; **transitivas**: ver abajo |
| Config de PHPUnit | `phpunit.xml`, bootstrap `phpunit-bootstrap.php`, suite `tests/` ✔ | `phpunit.xml.dist`, bootstrap `tests/Tests/TestInit.php`, suite `tests/Tests/ORM`; BD por defecto `pdo_sqlite` en memoria ✔; `failOnWarning/Notice/Risky` activados | `phpunit.xml` con BD **`pgsql` en host `postgres`** (usuario/clave de prueba), bootstrap `vendor/autoload.php` ✔; existen variantes `env/mysql`, `env/postgres`, `env/codecov` |
| CI propio del fork | `ci.yml`: PHPUnit en PHP 8.2–8.6 con `shivammathur/setup-php` (trae `intl`, `pdo`, etc.), `ubuntu-24.04` fijado «porque los tests de `intl` afirman datos CLDR que dependen de la versión de ICU» | `continuous-integration.yml`: instala `apcu`, `pdo`, `sqlite3`/`pdo_sqlite`; solo corre en ramas `*.x` | `test.yml`: contenedor `escolalms/php` + servicio **MySQL**; `migrate:fresh` antes de PHPUnit |
| **¿La brecha bloquea?** | **SÍ, muy probable (alta confianza).** `phpunit-bootstrap.php` ejecuta `printf("ICU version: %s\n", INTL_ICU_VERSION)`: esa constante solo existe con `ext-intl`, que la imagen NO tiene → el bootstrap falla y PHPUnit no arranca para ningún test (síntoma esperado en el Sandbox: `TEST_EXECUTION_FAILED` con «runner results file is missing/empty», NO `TEST_ENVIRONMENT_CONFIGURATION_INVALID`; ver 1.3). `composer install` sí pasa (intl es solo «sugerida») ✔. Aunque se agregara `intl`, los tests de formato pueden fallar por diferencias de ICU frente a las cadenas esperadas ⚠ | **NO bloquea, riesgo operativo.** Solo exige `ext-ctype`; sqlite en memoria está soportado ✔. Riesgos ⚠: `composer install` con muchas dev-deps y sin lock en 1 CPU/1 GiB/180 s (`INSTALL_TIMEOUT` o falta de memoria); tests que usen `apcu` se saltan o fallan; `failOnWarning/Risky` convierte avisos en fallos de la línea base | **SÍ, muy probable (alta confianza).** (a) Los tests dependen de BD: `phpunit.xml` fija `DB_CONNECTION=pgsql`/`DB_HOST=postgres`; el Sandbox no tiene Postgres, ni `pdo_pgsql`, ni red en la fase de tests ✔; el síntoma NO está confirmado ⚠: puede ser `TEST_EXECUTION_FAILED` (si PHPUnit no llega a escribir resultados) o, con Testbench, que PHPUnit sí escriba el JUnit y salga un resultado con pruebas falladas o con error por la conexión rechazada, indistinguible a simple vista de un fallo de la estrategia; por eso el smoke del paso 1.4 es condición previa de cualquier corrida oficial. El pedido a Core no puede inyectar variables (las variables `DB_*` que fija `phpunit.xml` se respetan, `container-runner.service.ts:585`; el Sandbox solo inyecta `APP_ENV` y un `APP_KEY` aleatorio) ✔. (b) La instalación probablemente falla: `escolalms/cart` arrastra `maatwebsite/excel` → `phpoffice/phpspreadsheet`, que exige `ext-gd` y `ext-zip` (tampoco están en la imagen) (consulta a Packagist: `maatwebsite/excel 4.0.6` y `phpspreadsheet 5.10.0`) ⚠ Composer podría elegir versiones antiguas, pero todas piden `gd`; se confirma ejecutando. (c) El script `post-autoload-dump` (`testbench package:discover`) no corre con `--no-scripts`; el `TestCase` del fork registra los providers a mano, así que quizá no sea necesario ⚠ |

**Conclusión honesta:** con la imagen actual del Sandbox, **P1 (money) y P3 (Vouchers) no pasarían la qualification**; P2 (orm) debería pasar salvo tiempos/memoria de instalación. Esto NO lo resuelves tú: ampliar la imagen del Sandbox (`intl`, `gd`, `zip`, `pdo_pgsql`, un servicio Postgres) o cambiar la configuración del fork (p. ej. `phpunit.xml` con SQLite) son decisiones de infraestructura/alcance que toman el usuario y cross antes de congelar. Lo que sí haces es **ejecutar la checklist 1.4 y reportar el resultado exacto**. Los casos marcados ⚠ se confirman únicamente ejecutando.

### 1.3 Qué señales verás si falla (para entender el informe del Sandbox)
Códigos reales del Sandbox/Core: `DEPENDENCY_INSTALL_FAILED` (Composer falló), `INSTALL_TIMEOUT`, `TIMED_OUT`, `TEST_EXECUTION_FAILED`, `TEST_COMPILATION_FAILED`, `TEST_ENVIRONMENT_CONFIGURATION_INVALID`, `INVALID_PROJECT_ROOT`, `UNSUPPORTED_RUNNER`, `IMAGE_UNAVAILABLE`, `OOM_KILLED` ✔ (`tjc-be-test-execution-sandbox/app/src/common/errors/sandbox-fact-error.ts`, `src/executions/execution-pipeline.service.ts:241-261`; WI-085 §2.3). `COMPOSER_INSTALL_FAILED` NO existe en el código (solo aparece como ejemplo en un archivo de contrato): no lo busques.

**Ojo con dos códigos:** `TEST_ENVIRONMENT_CONFIGURATION_INVALID` solo sale cuando la salida de error contiene el marcador de Jest «Validation Error:» (no aplica a PHP) (`execution-pipeline.service.ts:560,585-593`). Un fatal de PHP sin archivo de resultados (bootstrap roto, extensión o BD ausente) sale como **`TEST_EXECUTION_FAILED`** (categoría `TEST_RUNTIME`; `:570-573`), y un error de sintaxis como `TEST_COMPILATION_FAILED` (`:564-569`). En una corrida oficial esos dos códigos se conservan como resultado de la estrategia y no se repiten (4.2.3); por eso **no se lanza ninguna corrida oficial en un repo que no tenga smoke verde (1.4)**: en un repo sin smoke verde, un `TEST_EXECUTION_FAILED` es un fallo de qualification (se corrige y se repite), no un resultado.

### 1.4 Checklist de smoke que puedes ejecutar tú solo
Hazlo sobre el **SHA base** del fork (money `93f145c`, orm `b44f3df`, Vouchers `546f871`) y luego, cuando exista, sobre el HEAD del PR. Necesitas Docker. No hace falta el repo del Sandbox: esta imagen reproduce la suya.

**Diferencias con el Sandbox real (el smoke es ejecutable y representativo, pero no idéntico):** el Sandbox monta el repo en `/app`, corre como usuario `sandbox` con `CapDrop ALL` y `no-new-privileges`, inyecta `APP_ENV=testing` y un `APP_KEY` aleatorio, y en el flujo real ejecuta solo los archivos de prueba generados (no la suite completa). El smoke sirve para detectar brechas de instalación y de arranque, no para reproducir al 100 % una corrida.

**Paso A. Construir una imagen equivalente a la del Sandbox** (una sola vez; mismo contenido que `app/docker/php/Dockerfile`, sin el script interno):
```bash
mkdir -p ~/tesis-smoke && cd ~/tesis-smoke
cat > Dockerfile <<'EOF'
FROM composer:2 AS composer
FROM php:8.3-cli
RUN apt-get update && apt-get install -y --no-install-recommends acl unzip && rm -rf /var/lib/apt/lists/*
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
RUN groupadd --gid 10001 sandbox && useradd --uid 10001 --gid sandbox --create-home --shell /usr/sbin/nologin sandbox
EOF
docker build -t smoke-php83 .
```
⚠ La imagen real del Sandbox añade además un script `restore-workspace-acl` que no cambia PHP ni las extensiones. Si ya tienes el repo del Sandbox: `docker build -t tjc-sandbox-php:8.3-nonroot -f <sandbox>/app/docker/php/Dockerfile <sandbox>/app/docker/php`.

**Paso B. Clonar el SHA base** (ejemplo money; cambia repo y SHA):
```bash
cd ~/tesis-smoke && rm -rf money && git clone https://github.com/rag-tesis-org/money.git && cd money && git checkout 93f145c
```

**Paso C. Inspeccionar versión y extensiones**
```bash
docker run --rm smoke-php83 php -v
docker run --rm smoke-php83 php -m | sort > ../ext-imagen.txt
```

**Paso D. Instalar como lo hace el Sandbox** (1 CPU, 1 GiB, 128 procesos, red habilitada, mide el tiempo):
```bash
time docker run --rm --cpus=1 --memory=1g --pids-limit=128 \
  --user "$(id -u):$(id -g)" -e COMPOSER_HOME=/tmp -e COMPOSER_CACHE_DIR=/tmp/cc \
  -v "$PWD":/w -w /w smoke-php83 \
  composer install --no-interaction --no-progress --prefer-dist --no-scripts
```
Si Composer se queja de una extensión (`ext-...` missing) → anota el nombre exacto: es la brecha de extensiones. Luego:
```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w smoke-php83 composer check-platform-reqs
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w smoke-php83 composer show > ../versiones-instaladas-money.txt
```
(`composer show` es tu registro de las versiones realmente resueltas porque no hay `composer.lock`.)

**Paso E. Ejecutar PHPUnit sin red, con los límites de tests** (120 s):
```bash
time docker run --rm --network none --cpus=1 --memory=1g --pids-limit=128 \
  --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w smoke-php83 \
  timeout 120 php vendor/bin/phpunit --log-junit /tmp/junit.xml 2>&1 | tail -40
```
Para `orm` (suite enorme) no corras toda: elige un archivo de la suite, p. ej. `php vendor/bin/phpunit tests/Tests/ORM/Hydration` (⚠ la ruta exacta es tuya; solo importa que corra bajo los límites). Los tests que ya fallen en la **línea base verde** (sin el cambio del PR) se anotan; un repo con la línea base roja no es apto.

**Paso F. Interpretar el resultado**
| Resultado | Significa | Qué hacer |
|---|---|---|
| Instala y PHPUnit corre en verde (o con fallos propios de upstream documentados) | El Sandbox debería poder con el repo | Anota tiempos (instalación y tests), versión de PHP y `composer show`. Sigue con la sección 2 |
| Composer falla por `ext-X` | Brecha de extensiones | **Para.** Anota `ext-X` exacto, el SHA y los comandos. Avisa al usuario/cross (sección 6). No cambies el repo ni «arregles» tú el Sandbox |
| PHPUnit falla al arrancar (error de bootstrap, constante o clase indefinida) | Extensión faltante en ejecución (caso esperado de `money` por `INTL_ICU_VERSION`). El Sandbox lo reportaría como `TEST_EXECUTION_FAILED`, no como error de configuración | Igual: anota el mensaje literal (primeras 20 líneas) y avisa. Es un fallo de qualification, no un resultado |
| Tests dependen de BD y fallan por conexión (caso esperado de `Vouchers`) | Falta servicio de BD | Anota el driver/host que pide `phpunit.xml`; avisa |
| Instalación > 180 s o `Killed` por memoria | `INSTALL_TIMEOUT` / OOM probable en el Sandbox | Anota tiempos y memoria; avisa (se decide subir límites o precalentar la caché, no tú) |
| Distinto en Docker que en tu PHP local | Tu PHP local no es la referencia | Vale lo que diga la imagen de Docker |

**Qué documentar siempre:** repo, SHA, fecha, comandos usados, salida relevante, decisión tomada y quién la tomó. Un fallo corregido se vuelve a probar desde cero. Nada de esto entra a las métricas del experimento.

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

### 3.f Convención de nombres y carpeta de trabajo (propuesta; el usuario/cross la integra)
No se inventan rutas del repo. Propuesta de **carpeta local de trabajo** (luego se copia a la raíz externa de evidencia que la tesis define en §3.3.14 y Anexo L: `05_OE5_EXPERIMENTO`):
```
pilotos-trabajo/<piloto>/              # p1-money | p2-orm | p3-vouchers
  00_qualification/    smoke-<fecha>-<sha>.txt, ext-imagen.txt, versiones-instaladas-<piloto>.txt, notas.md
  01_caso-<id>/
    pr-info.md                          # URL del PR, HEAD SHA, fecha
    evidence-analysis-run-<analysisRunId>.json
    evidence-experiment-<experimentId>.json
    modelconfig-<experimentId>.png      # captura de «Proveedor y modelo/Esfuerzo/Presupuestos»
    resultados-<experimentId>.png
    trace-<analysisRunId>.png
    hashes.sha256                       # shasum -a 256 de todo lo anterior
```
Nombres: conserva los de la Console (`evidence-...-<id>.json`); no los renombres, para poder verificarlos. Anota un `caseId` externo en `pr-info.md`: es solo tu clave para unir con el oráculo (que vive aparte y que tú no copias aquí).

---

## 4. Fallos esperables y qué NO hacer

### 4.1 Tabla de fallos
| Síntoma | Causa probable | Qué hacer | A quién avisar |
|---|---|---|---|
| Run/experimento falla con `DEPENDENCY_INSTALL_FAILED` | `composer install` falló: extensión PHP faltante, dependencia sin versión compatible, red del Sandbox ✔ | No relances. Reproduce con el smoke (1.4) para ver el mensaje de Composer; anota extensión/paquete | Usuario/cross (decide imagen o repo) |
| `INSTALL_TIMEOUT` | Instalación > 180 s (por defecto; caché fría, repo grande como orm) ✔ | No relances en bucle. Anota repo y hora | Usuario/cross |
| `TIMED_OUT` en tests | La prueba generada (o la suite) superó el tiempo; para Core es un fallo **de la prueba generada**, no externo ✔ (INTEROP §6.5.1) | **No se repite.** Conserva el resultado | Solo registro; avisa si es sistemático |
| `OOM_KILLED` (proceso matado, 1 GiB) | memoria del contenedor (instalación o tests); categoría `INFRASTRUCTURE` ✔ (`sandbox-fact-error.ts:144-147`) | Core reintenta una vez automáticamente los resultados `INFRASTRUCTURE` del Sandbox (incluidos `OOM_KILLED` e `IMAGE_UNAVAILABLE`, salvo `TIMED_OUT`; INTEROP §6.5.1), así que verás un segundo intento sin haber hecho nada. Anota el caso; no relances | Usuario/cross |
| `TEST_EXECUTION_FAILED` («runner results file is missing/empty») | Un fatal de PHP sin archivo de resultados: bootstrap roto (money, `INTL_ICU_VERSION`), extensión o BD ausente (Vouchers), según 1.2 ⚠ (se confirma ejecutando); es el código que el Sandbox emite en estos casos (`execution-pipeline.service.ts:570-573`) | **En un repo sin smoke verde es un fallo de QUALIFICATION, no un resultado**: detén el piloto, corrige y repite la habilitación. En un repo con smoke verde y una prueba generada que falla en ejecución es resultado de la estrategia: se conserva y no se repite | Usuario/cross (si es qualification) |
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
- **WI (work item):** unidad de trabajo interna del equipo (p. ej. WI-CORE-092 es este runbook). **HU:** historia de usuario del backlog. **DEC:** decisión registrada (aprobada o pendiente). **INTEROP:** documento de contrato entre componentes (Core, Console, Integration, Sandbox). **OE5:** objetivo específico 5 de la tesis (comparar RAG con el agente generalista).
- **CT-08:** auditoría manual de la trazabilidad de 9 enlaces sobre 3 AnalysisRuns (uno por piloto).
- **Evidence ID:** identificador `EV-...` del registro de evidencia (lo asigna el equipo, no el sistema).

### 6.3 Límites de este borrador
- No se ejecutó ningún smoke ni se leyó ningún `.env`; las conclusiones de bloqueo de money y Vouchers son inferencias de lectura de `composer.json`, `phpunit.xml` y `phpunit-bootstrap.php` (alta confianza) que se confirman con la checklist 1.4.
- No existen hoy: consulta inversa del trace, estado de enlace inconsistente, descarga de la prueba generada, descarga de la salida completa de Composer/PHPUnit, pantalla de ocupación del Sandbox, bloqueo automático de configuración (`low` vs `medium`) y campo `caseId`/oráculo en el experimento.
- Los tiempos reales (indexación, instalación, experimento), tamaño de la evidencia y límites efectivos de la VM del Sandbox son desconocidos (⚠).
