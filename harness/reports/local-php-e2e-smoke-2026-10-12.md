# Smoke E2E local Core → Sandbox (PHP/PHPUnit)

Modelo: agente principal de la sesión Core · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12. **Estado:** ejecución local completada **con fallo del Sandbox en `PREPARING`**; no es un E2E exitoso. **No es observación oficial del piloto** ni evidencia experimental.

## Autorización y alcance

- Petición de la sesión Cross/Integration («generar el e2e», E2E local reproducible, sin push/PR/infra). La escritura temporal en Supabase Storage la **autorizó Jean en el chat de la sesión Core** (2026-10-12): un objeto temporal, un único `POST /executions`, borrado posterior.
- Core `feature/jean` en `19709f7` (`pnpm build` correcto). Sandbox local ya existente en `127.0.0.1:3001` (`/health/ready` 200, `docker`, `downloadPolicy` y `workspace` en `ok`); **no se reinició ni se tocó su configuración**.
- Sin cambios en `.env`, secretos, código de producto, contratos, CI ni infraestructura remota. Sin push ni PR.

## 1. Base de datos local desechable

El Postgres de compose (`app-postgres-1`, `pgvector/pgvector:pg16`, `localhost:5433`, 0 proyectos) tenía 30 migraciones. Se aplicaron las 16 pendientes **solo ahí**, desde una copia limpia del commit (`git archive HEAD app/prisma app/prisma.config.ts app/package.json`), sin tocar `DATABASE_URL` del `.env`:

```sh
# desde una copia exportada de app/prisma (HEAD) con node_modules enlazado
DATABASE_URL='postgresql://rag_core:rag_core@127.0.0.1:5433/rag_core' npx prisma migrate deploy
```

Resultado: 46 migraciones aplicadas, `Database schema is up to date!`. Última: `20261011100000_project_roots`. La base real de Supabase **no** se tocó y **no** tiene todavía `20261011100000_project_roots` (sigue en 45).

## 2. Smoke

Una sola invocación de `SandboxExecutionService.execute()` (compilado desde `dist/`), perfil `PHP_LARAVEL_PHPUNIT`, runner `PHPUNIT`, `projectRoot: "."`, `scope: BATCH`. Snapshot efímero: la fixture `phpunit-sample-project` del Sandbox envuelta en una carpeta contenedora (patrón de los ZIP de GitHub), subida al bucket `repository-zips` y descargada por URL firmada. Dos artefactos `CREATED`: `tests/Unit/AddTest.php` (usa `App\Math`) y `tests/Unit/RuntimeIdentityTest.php` (comprueba `getmyuid() === 10001` y que `getcwd()` no sea una ruta del host).

| Dato | Resultado |
| --- | --- |
| `POST /executions` | Exactamente 1, aceptado (el token de Core es válido para el Sandbox local) |
| `executionId` | `c24cc736-5ef0-4bc3-b1b2-93da364cfe32` |
| `requestId` | `c7c7b4a6-1968-4c49-bd2e-12c2ee93ece7` |
| `correlationId` | `b7b876e4-3627-4a91-b253-df6d355a55df` |
| Estado | `FAILED` en `PREPARING`, `category=UNKNOWN`, `code=UNKNOWN` |
| `facts` | `null` (no llegó a instalar ni ejecutar PHPUnit) |
| Duración (POST → resultado) | 2061 ms |
| SHA-256 del snapshot demo | `428b271c10fd1f2e60f5dceeca3401ba8b35c8708cd1fdf3ab6cc047fc56a097` |
| Limpieza | 3 objetos escritos (snapshot + 2 artefactos), 3 borrados |

Mensaje del Sandbox: *«Unable to provision isolated workspace ACL for UID 10001; Linux acl utilities (setfacl/getfacl) are required»*.

## 3. Causa y lectura

El Sandbox local corre como proceso en **macOS** y, para aislar el workspace del contenedor con UID 10001, necesita las utilidades Linux `setfacl`/`getfacl`, que macOS no trae. El fallo ocurre dentro del Sandbox, en preparación, **antes** de instalar dependencias o ejecutar PHPUnit; no es un defecto de Core.

Lo que sí quedó demostrado de extremo a extremo en esta corrida: Core construyó y firmó la petición, el Sandbox la aceptó con el token compartido, devolvió un resultado terminal por polling y Core lo recibió y lo mapeó (`status`, `failure`, `executionId`, `correlationId`). **No** se pudo comprobar `projectRoot` ni rutas relativas de `testCases` ni el UID 10001 efectivo, porque no hubo ejecución de pruebas.

Hallazgo de clasificación: el fallo llegó a Core como `UNKNOWN/UNKNOWN`. Un fallo de plataforma del Sandbox (herramienta del host ausente) podría clasificarse como `INFRASTRUCTURE`; es cosa del dueño del Sandbox y de DEC-INF-001, no se corrige aquí.

## 4. Para completar el E2E

Cualquiera de estas dos vías, a cargo de la sesión/dueño del Sandbox, sin tocar Core:

1. Ejecutar el Sandbox en Linux (la VM o un contenedor Linux) con `acl` instalado.
2. Instalar las utilidades ACL en el host de pruebas, o configurar el Sandbox con un modo de aislamiento compatible con macOS.

Con el Sandbox ya apto, repetir **una** ejecución con el mismo script (sección 5) y registrar `facts.testCases[].suitePath`, `runner` y el resultado de `RuntimeIdentityTest`.

## 5. Reproducción

Desde `app/`, con `SUPABASE_*` y `SANDBOX_SERVICE_TOKEN` exportados desde el `.env` solo en el entorno del proceso (sin imprimirlos) y `SANDBOX_URL=http://127.0.0.1:3001`:

```sh
pnpm -s build
node ../harness/reports/local-php-e2e-smoke-2026-10-12.mjs   # una sola ejecución; no reintenta; borra todo lo que escribió
```

El script, versionado junto a este reporte, instancia `SupabaseObjectStorageAdapter` y `SandboxExecutionService` desde `dist/`, empaqueta la fixture con `zip`, construye la petición descrita arriba, registra las claves escritas y las borra en `finally`, e imprime solo los hechos de la ejecución (sin URL firmadas ni token). Incluye una guarda de proceso que lanza ante un segundo `POST /executions` y reporta `executionPosts` (esperado: 1). Para un intento remoto por túnel IAP se reutiliza tal cual con `SANDBOX_URL` apuntando al túnel; abrir y cerrar el túnel es responsabilidad de la sesión Cross y requiere su aviso «VM lista».

## 6. Observaciones del entorno

- Hay cambios sin commitear de otra sesión en `AGENTS.md` y en `harness/` (perfiles de Codex); este reporte los deja intactos y se commitea solo.
- La base real de Supabase no tiene `20261011100000_project_roots`: pendiente de aplicar cuando Jean lo ordene antes de desplegar Core con esa migración.

## 7. Intento remoto único a la VM (2026-10-12, 13:40 -05)

Autorización: Jean confirmó en el chat de la sesión Core «Sí, un único POST»; Cross avisó «VM lista» (WI-SANDBOX-005 desplegado, Sandbox `9e2d1b0`, código `0c2b43a`) y abrió el túnel IAP en `127.0.0.1:3101`. `/health/ready` por el túnel: `200` (`docker`, `downloadPolicy`, `workspace` en `ok`). Mismo script, `SANDBOX_URL=http://127.0.0.1:3101`. El Sandbox local de macOS en `:3001` no se tocó.

| Dato | Resultado |
| --- | --- |
| `POST /executions` | Exactamente 1 (`executionPosts=1`), aceptado; sin reintento |
| `executionId` | `d6f8a87e-273f-4e6f-8d8f-a3b6fbac138b` |
| `requestId` | `686deefd-0c5e-4711-b123-5296689f212d` |
| `correlationId` | `19d6ee85-700e-410e-95d6-2167bd377bed` |
| Estado | `FAILED` en `PREPARING`, `CONFIGURATION` / `UNSUPPORTED_RUNNER` |
| Mensaje | `project does not declare or configure PHPUNIT` |
| `facts` | `null` (no llegó a instalar ni a ejecutar PHPUnit) |
| Duración | 4827 ms |
| SHA-256 del snapshot demo | `985b45cafe24f5f941eb41b18703d68093481bc13d4035530281340d61bfc338` |
| Limpieza de Storage | 3 objetos escritos, 3 borrados |

**Avance respecto del intento anterior:** ya no aparece el fallo de ACL del UID 10001 ni de `composer.json` por permisos del workspace: WI-SANDBOX-005 hizo su efecto y el aprovisionamiento terminó. El resultado llegó a Core como `CONFIGURATION`, no como `UNKNOWN`.

**Causa probable (inferida del código, no confirmada en la VM):** el adaptador PHPUnit (`phpunit-test-runner.adapter.ts`, `0c2b43a`) busca `composer.json` con `phpunit/phpunit` o `phpunit.xml[.dist]` en la raíz resuelta por `projectRoot`. El `SafeArchiveExtractor` de ese commit **no aplana** una carpeta contenedora (sin lógica de renombrado ni de prefijo). El smoke empaquetó la fixture dentro de una carpeta `tjc-demo-php-0000001/` y envió `projectRoot: "."`, así que `composer.json` y `phpunit.xml.dist` quedaban un nivel más abajo. Es un error de empaquetado del smoke frente al contrato (la raíz efectiva debe coincidir con la ubicación del manifiesto en el snapshot), no un defecto demostrado de Core ni del Sandbox. El script se corrigió para empaquetar plano; **no se ha vuelto a ejecutar**.

**Pregunta abierta para el contrato real:** cómo congela Core `projectRoot` cuando el snapshot de GitHub trae carpeta contenedora, y si el Sandbox debe aplanarla o Core debe emitir el prefijo. No se inventa cierre aquí.

**Siguiente paso:** un segundo POST remoto con el ZIP plano requiere una autorización nueva, distinta de la del «único POST» ya gastado. El túnel lo cierra Cross.

## 8. Segundo POST remoto a la VM, con ZIP plano (2026-10-12, 13:46 -05): COMPLETED

Autorización: Jean confirmó en el chat de la sesión Core «Sí, un POST adicional» (alcance: un solo `POST /executions`, ZIP plano, `projectRoot "."`, sin reintento, sin push ni infraestructura). Mismo script corregido (`SANDBOX_URL=http://127.0.0.1:3101`, túnel de Cross, Sandbox `9e2d1b0`/código `0c2b43a`). `/health/ready` por el túnel: `200` justo antes. El Sandbox local `:3001` no se tocó.

| Dato | Resultado |
| --- | --- |
| `POST /executions` | Exactamente 1 (`executionPosts=1`), sin reintento |
| `executionId` | `d1ed72b9-b1f2-4477-b220-05dff0078647` |
| `requestId` | `497cd174-2e1c-4f3a-94de-83e8398b820c` |
| `correlationId` | `d8093f4c-b1f5-4ada-8367-98b0f6ae6997` |
| Estado | `COMPLETED`, `failure: null` |
| Perfil / runner | `PHP_LARAVEL_PHPUNIT` / `PHPUNIT` |
| `facts` | `compiled=true`, `executed=true`, `passed=true`; `totalTests=3`, `passedTests=3`, `failedTests=0` |
| Etapas (ms) | `PREPARING` 747 · `INSTALLING_DEPENDENCIES` 3441 · `RUNNING_TESTS` 668 |
| Duración (POST → resultado) | 14079 ms |
| SHA-256 del snapshot demo (ZIP plano) | `29898019dba98a01985b81c2329be141d509db427af615d5424e470aad49ce2b` |
| Limpieza de Storage | 3 objetos escritos, 3 borrados |

Casos (`testCases`): `Tests\Unit\AddTest::testAddsTwoNumbers` PASSED; `Tests\Unit\RuntimeIdentityTest::testRunsAsSandboxUser` PASSED; `Tests\Unit\RuntimeIdentityTest::testWorkingDirectoryIsNotTheHostPath` PASSED. Los tres con `failureKind: null`.

**Qué demuestra:**
- Core → Sandbox remoto por IAP de extremo a extremo con PHP/PHPUnit: aceptación, `composer install`, ejecución de los artefactos CREATED y resultado terminal mapeado por Core.
- **`projectRoot "."` con ZIP plano funciona**: el adaptador encontró `composer.json` y PHPUnit. Confirma la causa del §7: el fallo anterior fue de empaquetado del smoke.
- **UID 10001**: `getmyuid() === 10001` dentro del contenedor (el test pasó). WI-SANDBOX-005 efectivo en la VM.
- **Aislamiento del host**: `getcwd()` sin ruta del host (`/Users/`).
- Solo se ejecutaron los artefactos generados (3 tests; la fixture trae además `MathTest`, que no figura).

**Matices honestos (no se maquillan):**
- `suitePath` llega como **nombre de clase** (`Tests\Unit\AddTest`), no como ruta de archivo repo-relativa. La comprobación de «paths repo-relative» sobre `testCases` queda abierta: lo que sí está probado es que los artefactos se aplicaron en `tests/Unit/...` relativos a `projectRoot`.
- Se ejercitó `projectRoot "."`. No se probó un subproyecto (`projectRoot` anidado, p. ej. `backend`).
- Es un proyecto de demo (fixture de PHPUnit), **no** un repositorio Laravel ni un PR real: no hay Run de Core, ni generación por LLM, ni Check de GitHub. No es una observación oficial del piloto.
- Una sola ejecución: no estima variabilidad ni estabilidad.

**Siguiente paso posible (requiere decisión de Jean):** repetir con un `projectRoot` anidado y con un repositorio piloto real (flujo PR → AnalysisRun → Sandbox). El túnel lo cierra Cross.
