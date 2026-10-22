# WI-CORE-077 — implementación: validar SANDBOX_POLL_* al arrancar
Modelo: implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

Informe del implementer (transcrito por el leader). Alcance aprobado por el usuario: `wi-core-077-scope-approval.md`.

## Reglas finales (`app/src/config/env.validation.ts`, `validateSandboxPollSettings(config, validated)`, invocada tras `validateLlmSettings`)

Se valida el texto crudo de la variable. Ausente = default; se recorta con `trim`; vacío o solo espacios = error; regex `^\d+$` sobre el texto recortado, `Number.isSafeInteger` y rango. `SANDBOX_POLL_RETRIES`: entero 0..10, default 3. `SANDBOX_POLL_RETRY_DELAY_MS`: entero 1..30000 (`MAX_POLL_AFTER_MS`), default 500. El número normalizado se escribe en el objeto validado (como `LLM_REASONING_EFFORT`) y las dos claves se declaran en `EnvironmentVariables` con `@IsOptional()` sin `@IsInt`.

## Mensajes finales

- `Configuración de entorno inválida: SANDBOX_POLL_RETRIES no puede estar vacío; si no la define se usa el valor por defecto 3.`
- `Configuración de entorno inválida: SANDBOX_POLL_RETRY_DELAY_MS no puede estar vacío; si no la define se usa el valor por defecto 500.`
- `Configuración de entorno inválida: SANDBOX_POLL_RETRIES="<valor>" no es válido; debe ser un entero entre 0 y 10.`
- `Configuración de entorno inválida: SANDBOX_POLL_RETRY_DELAY_MS="<valor>" no es válido; debe ser un entero entre 1 y 30000 (ms).`
El valor se recorta a 40 caracteres; sin secretos.

## Defaults movidos

Nuevo `app/src/config/sandbox-poll.defaults.ts` con `DEFAULT_POLL_RETRIES = 3`, `DEFAULT_POLL_RETRY_DELAY_MS = 500` y `MAX_POLL_AFTER_MS = 30_000`; `experiment-job.handler.ts` y `sandbox-execution.service.ts` los importan de ahí (el servicio también los re-exporta para que los specs existentes sigan importándolos desde el servicio).

## Pruebas (10 nuevas en `env.validation.spec.ts`, bloque «SANDBOX_POLL_* al arrancar (WI-CORE-077)»)

Ausentes → 3 y 500; bordes válidos 0/10 y 1/30000; `trim`; no numérico; vacío y solo espacios; negativo, decimal, `+3`, `1e3`, `0x10`; absurdos (11, 999999, 30001, DELAY 0 y un número enorme); recorte a 40 caracteres; sin secretos; valor normalizado visible vía `ConfigService.get` (`ConfigModule.forRoot` con `validate`). Las pruebas existentes no se tocaron y siguen en verde.

## Evidencia (desde `app/`, Node 22)

| Comando | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm contracts:check` | exit 0 |
| `pnpm test` | 157 archivos pasan, 7 omitidos; 2628 tests pasan, 104 omitidos (antes 2618, +10) |
| `pnpm test:e2e` | 9 archivos, 259 tests pasan |

## Desvíos y notas

El servicio re-exporta las constantes movidas (sin efecto en comportamiento). Las funciones de validación y parseo no se exportan (patrón de `validateLlmSettings`) y se prueban a través de `validateEnv`. Único cambio observable: `1e3`, `0x10`, `2.5`, vacío y negativos, antes aceptados por `Number()`, ahora fallan al arrancar. Fuera de alcance: `pollAfterMs` del Sandbox (O3), `SANDBOX_MAX_POLL_ATTEMPTS` y `SANDBOX_REQUEST_TIMEOUT_MS` sin tope superior. **Revisar en Render las dos variables antes de desplegar**: fallarían solo con `SANDBOX_POLL_RETRY_DELAY_MS=0`, `SANDBOX_POLL_RETRIES>10`, `SANDBOX_POLL_RETRY_DELAY_MS>30000`, valores vacíos o con unidad.
