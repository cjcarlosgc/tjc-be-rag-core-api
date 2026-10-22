# WI-CORE-077 — verificación SDD
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Estado: APPROVED (sin decisión nueva del usuario). No se leyó `app/.env`.

## 1. Inventario

Solo hay DOS claves `SANDBOX_POLL_*`. Ninguna está en `EnvironmentVariables`; hoy se leen sin validar con `ConfigService.get<number>(clave, default)`. Como no están en la clase, `plainToInstance` no las convierte: llegan como TEXTO desde process.env (`"3"`), no como número.

| Clave | Lectura (archivo:línea) | Default | Interpretación |
|---|---|---|---|
| SANDBOX_POLL_RETRIES | `app/src/sandbox/sandbox-execution.service.ts:385`; `app/src/experiments/experiment-job.handler.ts:515-518` | `DEFAULT_POLL_RETRIES = 3` (service:111) | `get<number>` = texto. En el servicio `attempt >= retries` compara número con texto (JS coacciona); en `sandboxHttpBoundMs` (`app/src/experiments/attempt-recovery.ts:121-133`) se hace `Number()` y `Math.floor` solo si es finito y > 0 |
| SANDBOX_POLL_RETRY_DELAY_MS | service:386; handler:519-522 | `DEFAULT_POLL_RETRY_DELAY_MS = 500` (service:112) | `baseDelayMs * 2 ** attempt` (service:393), `Number(baseDelayMs)` en attempt-recovery:132, tope `MAX_POLL_AFTER_MS` = 30000 (service:114) |

Claves numéricas del Sandbox ya validadas por class-validator (`env.validation.ts:173-181`): `SANDBOX_DOWNLOAD_TTL_SECONDS` (`@IsInt @Min(1)`, default 300), `SANDBOX_REQUEST_TIMEOUT_MS` (`@IsInt @Min(100)`, 10000), `SANDBOX_MAX_POLL_ATTEMPTS` (`@IsInt @Min(1)`, 120). No hay `SANDBOX_POLL_AFTER_MS` (el `pollAfterMs` viene del Sandbox y se acota con `clampPollAfterMs`, service:117-121). Fuera de alcance: sin tope superior en `SANDBOX_MAX_POLL_ATTEMPTS` y `SANDBOX_REQUEST_TIMEOUT_MS` (pre-existente; solo anotarlo).

Efecto hoy con valor inválido (`SANDBOX_POLL_RETRIES`):
- `"abc"`: servicio `attempt >= NaN` es siempre falso, así que reintenta sin fin ante fallos transitorios; la cota (`Number("abc")` = NaN, `safeRetries` = 0) asume 0 reintentos, por lo que subestima y puede vencer un latido vivo (O2).
- `""`: `ConfigService.get` NO aplica el default a la cadena vacía. `"" >= ...` se evalúa como 0, o sea 0 reintentos silenciosos; la cota usa 0.
- `-1`: `attempt >= -1` verdadero, 0 reintentos; cota 0. `2.5`: el servicio hace 3 reintentos (0,1,2 < 2.5) y la cota usa `floor` = 2 (O1). El log muestra «de 2.5».
- `1e3` o `0x10`: `Number()` los acepta (1000 o 16 reintentos).
- Absurdo (p. ej. 1000000): reintentos con esperas de 30 s y cota enorme.

`SANDBOX_POLL_RETRY_DELAY_MS`:
- `"abc"`: `delayMs` = NaN, `setTimeout(NaN)` espera 1 ms (reintentos sin pausa); `sandboxGetMaxMs` da NaN, `sandboxHttpBoundMs` da NaN, y el umbral de latido queda en NaN (O2). Lo que ocurre con NaN en `resolveHeartbeatStaleMs` (attempt-recovery:147) hay que verificarlo en la implementación.
- `""` o `0`: espera 0 (reintentos inmediatos, cota sin esperas). Negativo: `Math.min(neg, 30000)` es negativo, `setTimeout` lo trata como 1 ms. Decimal: espera fraccionaria sin sentido. Muy grande: se acota a 30000 en la ejecución, pero la cota de latido ya lo acota con el mismo tope (coherente).

Patrón de validación existente (`env.validation.ts`): (a) class-validator con `@IsInt/@Min/@Max` sobre campos con default (la conversión implícita transforma `""` en 0 y `"abc"` en NaN); (b) funciones propias post-validación (`validateExperimentLlmSettings`, `validateLlmSettings`) que lanzan `Error('Configuración de entorno inválida: ...')`, recortan con `REASONING_EFFORT_MAX_LOG_LENGTH = 40` y ESCRIBEN el valor normalizado en `validated` (LLM_MODEL, LLM_REASONING_EFFORT); (c) `EXPERIMENT_LLM_MAX_OUTPUT_TOKENS` valida texto con regex `^[1-9]\d*$`.

## 2. Regla propuesta

Validar sobre el TEXTO crudo (`config[clave]`), no con `@IsInt`: la conversión implícita de class-transformer convierte `""` en 0 y lo aceptaría en silencio, y también hay que rechazar `1e3`, `0x10`, `+3`, `2.5`, `-1`. Regex sobre el valor con trim.

| Clave | Regla | Default (ausente) |
|---|---|---|
| SANDBOX_POLL_RETRIES | entero decimal `^\d+$`, 0 ≤ n ≤ 10 | 3 |
| SANDBOX_POLL_RETRY_DELAY_MS | entero decimal `^\d+$`, 1 ≤ n ≤ 30000 (`MAX_POLL_AFTER_MS`) | 500 |

Justificación de topes: con R=10 el peor GET dura 11·T más la suma de esperas acotadas a 30 s por reintento (la espera crece 2^k y ya se satura en el 7.º); más de 10 hace la cota de latido (que se suma por cada uno de P+1 GET) inmanejable y es un error de configuración plausible (p. ej. milisegundos en lugar de conteo). RETRY_DELAY 0 no tiene sentido (reintento sin pausa, golpea al Sandbox); superar 30000 no tiene efecto (el código ya acota a `MAX_POLL_AFTER_MS`), así que se rechaza para no aparentar algo que no ocurre. Con R=0 el delay no se usa pero igualmente se valida (una variable mal escrita debe fallar siempre).

Vacío (`""` o solo espacios): ERROR, no equivale a ausente. Razón: coherente con LLM_MODEL (WI-CORE-076), `ConfigService.get` no aplica el default a `""` y hoy produce 0 silencioso (0 reintentos o 0 ms), que es justo el tipo de fallo silencioso que este WI cierra. Ausente (`undefined`) = default. Mensajes (los números 1 y 2 de RETRIES se cambian por el nombre; valor recortado a 40 caracteres, sin secretos; para vacío se omite el valor):
- Vacío RETRIES: `Configuración de entorno inválida: SANDBOX_POLL_RETRIES no puede estar vacío; si no la define se usa el valor por defecto 3.`
- Vacío DELAY: `Configuración de entorno inválida: SANDBOX_POLL_RETRY_DELAY_MS no puede estar vacío; si no la define se usa el valor por defecto 500.`
- No entero/fuera de rango RETRIES: `Configuración de entorno inválida: SANDBOX_POLL_RETRIES="<valor40>" no es válido; debe ser un entero entre 0 y 10.`
- No entero/fuera de rango DELAY: `Configuración de entorno inválida: SANDBOX_POLL_RETRY_DELAY_MS="<valor40>" no es válido; debe ser un entero entre 1 y 30000 (ms).`

Compatibilidad de valores en uso: `.env.example` (`app/.env.example:76-77`) tiene 3 y 500; defaults 3/500; los specs usan 2/1 y 0 (`sandbox-execution.resilience.spec.ts:13,156`: pasan config al ConfigService mockeado, no por `validateEnv`); e2e (`app/vitest.config.e2e.ts`) y `.github/workflows/ci.yml` NO definen `SANDBOX_POLL_*` (usan defaults); `scripts/local-php-env.mjs:92-93` no los define. Todos siguen válidos. Render: el usuario no conoce los valores. Plausibles (ausente, 3/500, 5/1000, 0/…) pasan; fallarían solo `RETRY_DELAY_MS=0`, retries > 10, delay > 30000, vacío o con unidad («500ms»). Riesgo bajo: el servicio falla al arrancar con mensaje claro, no en caliente. Recomendación (no bloqueante): antes del despliegue revisar las dos variables en el panel de Render.

## 3. Dónde y cómo

Función pura exportada en `env.validation.ts` (patrón de `validateLlmSettings`), p. ej. `validateSandboxPollSettings(config: Record<string, unknown>, validated)`, invocada tras `validateLlmSettings(validated)` en `validateEnv`. Lee de `config` (crudo; el objeto `validated` no tiene esas claves tipadas). Normaliza y ESCRIBE en `validated` los números ya validados (`validated.SANDBOX_POLL_RETRIES = n`; con ausente, el default exportado por el servicio o constantes compartidas). Para ello declarar las dos claves en `EnvironmentVariables` como `@IsOptional() SANDBOX_POLL_RETRIES?: number` (sin `@IsInt`, que ya haría la conversión a NaN), o añadirlas como propiedades sueltas del objeto retornado. Verificar en la implementación (prueba con `ConfigModule` real o `ConfigService`) que el valor normalizado que devuelve `validate` es el que lee `ConfigService.get`; con eso servicio y `attempt-recovery` ven números. Importante: evitar importación circular — `DEFAULT_POLL_*` están en `sandbox-execution.service.ts`; moverlos a `app/src/config/generation-budget.defaults.ts` o a un `sandbox-poll.defaults.ts` y reexportar desde el servicio (el handler importa los símbolos del servicio; no romper imports).

Sin cambios de comportamiento con valores válidos, sin tocar contrato ni DTO. `sandboxHttpBoundMs` mantiene su normalización defensiva (no tocar). O1 queda resuelto (decimal rechazado). O3 (esperas `pollAfterMs` fuera de la cota) NO entra en este WI.

## 4. Pruebas y documentación

Existentes que fijan lo actual (deben seguir en verde sin cambios): `app/src/sandbox/sandbox-execution.resilience.spec.ts` (valores numéricos pasados al ConfigService), `app/src/experiments/attempt-recovery.spec.ts` (líneas 123, 166), `app/src/experiments/experiment-job.handler.spec.ts` (~5030, «cota HTTP»). Ninguna asume entrada inválida.

Nuevas en `app/src/config/env.validation.spec.ts` (nuevo `describe('SANDBOX_POLL_* (WI-CORE-077)')`): ausentes → 3 y 500 en el validado; válidos (`'0'`, `'10'`, `'1'`, `'30000'`, `' 5 '` con trim) → números; falla con no numérico (`abc`), vacío y solo espacios (ambas), negativo (`-1`), decimal (`2.5`), notación `1e3`/`0x10`, absurdo (`11`, `999999`, `30001`, DELAY `0`); el mensaje contiene el nombre de la variable; eco recortado a 40 caracteres; mensaje sin secretos; el valor numérico normalizado es el que ve `ConfigService`. Opcional: una prueba de integración mínima de que `AppModule`/`ConfigModule` arranca con valores válidos (los e2e ya cubren arranque con defaults).

Documentación: `app/.env.example` (líneas 74-77: reglas «entero 0–10» y «entero 1–30000», vacío = error, ausente = default) y su fórmula de cota (115-119) intacta; `spec/transversal/providers/spec.md` NO aplica (es de LLM); `spec/contracts/interoperability-contract.md:117` solo nombra las variables, sin cambio (no es contrato; no requiere Contract Sync, es config interna); `spec/features/008-experimental-comparison/tasks.md` (ST-CORE-084, ya T-READY) marcar al cierre; `CHANGELOG.md` entrada Unreleased «Validación de arranque de SANDBOX_POLL_*». Registrar la regla también en la sección de Sandbox/despliegue de `app/README` o runbook si existe (no verificado).

## 5. Decisiones, riesgos, decisión nueva

- Decisiones PENDING/PROPOSED con Blocks que alcancen este WI: ninguna encontrada (grep en `spec/` solo da el contrato y tasks; no se inspeccionó el registro de decisiones fuera de `spec/`). Alcance aprobado por el usuario (wi-core-077-scope-approval.md).
- Riesgos: (1) Render con valor no plausible → arranque falla (mitigado: mensaje claro, aviso arriba); (2) el valor normalizado puede no ser el que lee `ConfigService` si se escribe solo en el objeto equivocado → probar; (3) imports circulares al mover defaults; (4) `SANDBOX_MAX_POLL_ATTEMPTS` y `SANDBOX_REQUEST_TIMEOUT_MS` sin tope (anotar como observación, fuera de alcance); (5) `0x10`/`1e3` hoy se aceptan por `Number()`: pasan a error (cambio intencionado, valores no plausibles).
- Decisión nueva del usuario: NINGUNA. Los topes (0–10, 1–30000) y vacío = error entran en «tope razonable si el análisis lo justifica» y «el análisis lo propone» del alcance aprobado; el implementer puede aplicarlos.
