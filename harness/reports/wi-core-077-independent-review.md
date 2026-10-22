# WI-CORE-077 — revisión independiente (ciclo 1)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Veredicto: **APPROVED** (sin bloqueantes; 1 observación baja no bloqueante).

Commit revisado: `cbb57db` (comparado con `cbb57db~1`). Alcance contrastado con `wi-core-077-scope-approval.md`.

## 1. Reglas
`app/src/config/env.validation.ts:381-427` (`validateSandboxPollSettings` / `parseSandboxPollInteger`): ausente (`undefined`) = default (3 / 500); `trim` y vacío = error; `^\d+$` sobre el texto recortado + `Number.isSafeInteger` + rango. RETRIES 0..10, DELAY 1..30000 (`MAX_POLL_AFTER_MS`). Rechazados: no numérico, negativo, decimal, `+3`, `1e3`, `0x10`, 11/999999, 30001, DELAY 0 y números enormes (no seguros). Mensajes con nombre de variable y valor recortado a 40 caracteres tras el trim; no incluyen otras variables ni secretos.

## 2. Sin cambio de comportamiento
- Servicio `sandbox-execution.service.ts` (`withTransientRetries`, línea 384-392): lógica intacta; solo cambia el origen del import y un re-export. `attempt-recovery.ts` sin diff; `experiment-job.handler.ts` solo cambia la línea de import.
- Defaults idénticos (3, 500, 30000), movidos a `app/src/config/sandbox-poll.defaults.ts` (sin imports: no hay ciclos ni duplicados; el re-export del servicio apunta a la misma fuente).
- `validated` recibe números normalizados; `ConfigModule.forRoot({validate: validateEnv})` (`app.module.ts:32-34`) los expone a `ConfigService.get`; probado por el spec «ConfigService.get».
- Cambio observable declarado: `1e3`, `0x10`, `2.5`, vacío y negativos, antes aceptados por `Number()`, ahora fallan al arrancar.

## 3. Compatibilidad
Ninguna referencia a `SANDBOX_POLL` en `.github/`, `scripts/` ni `app/scripts/`; `vitest.config.e2e.ts` no las define (default). `.env.example` mantiene 3 y 500 (válidos). No se leyó `app/.env` (el entorno lo bloqueó y no era necesario). Specs de resiliencia, recuperación y handler pasan sin tocarlos.

## 4. Pruebas y mutaciones
Las 10 nuevas son reales. Mutaciones sobre `env.validation.ts`, todas detectadas y restauradas:
| Mutación | Resultado |
|---|---|
| aceptar vacío | falla 1 test |
| RETRIES máx 11 | fallan 2 |
| DELAY mín 0 | fallan 2 |
| no normalizar RETRIES en `validated` | falla 1 |
| quitar `trim` | fallan 3 |
| no recortar a 40 | falla 1 |
| quitar regex `^\d+$` | falla 1 |

## 5. Gates (desde `app/`, Node 22)
`pnpm lint` 0; `pnpm build` 0; `pnpm contracts:check` 0; `pnpm test` 157 archivos / 2628 tests pasan (104 omitidos); `pnpm test:e2e` 9 archivos / 259 tests pasan. Raíz: `sdd-check`, `validate-work-items`, `validate-harness`, `validate-completions` exit 0.

## 6. Alcance
Sin cambios de contrato, DTO, rutas ni de `SANDBOX_MAX_POLL_ATTEMPTS`/`SANDBOX_REQUEST_TIMEOUT_MS`. Sin secretos. `git status` limpio tras restaurar mutaciones (solo queda este informe).

## Hallazgos
- **L1 (baja, no bloqueante)** `app/src/config/env.validation.ts:425`: el valor se repite en el mensaje sin escapar; un valor con saltos de línea interiores (el trim solo quita extremos) o caracteres de control podría partir la línea de log. Requiere controlar el entorno del despliegue y es el mismo patrón que `LLM_REASONING_EFFORT`; recomendable sanear (p. ej. `JSON.stringify` o reemplazar `[\x00-\x1f]`) en un WI futuro, sin afectar el aceptar/rechazar.

## Siguiente paso
Cerrar WI-CORE-077 (revisión 1 aprobada); recordar revisar en Render las dos variables antes de desplegar.
