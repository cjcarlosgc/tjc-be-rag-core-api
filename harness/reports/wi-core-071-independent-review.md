# WI-CORE-071 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Commit revisado: 1e768b6 (rama feature/jean). Veredicto: **APPROVED** (con 2 observaciones de gravedad baja, no bloqueantes).

## Verificaciones
1. Fórmula: `sandboxHttpBoundMs = T + (P+1)·perGet`, `perGet = (R+1)·T + Σ_{k<R} min(base·2^k, MAX)`. Coincide con `withTransientRetries` (sandbox-execution.service.ts:380-402: esperas `min(base·2^attempt, MAX_POLL_AFTER_MS)`, corte `attempt >= retries`), con P GET de estado (pollUntilTerminal) + 1 de resultado (fetchResult) y un POST sin reintentos. Recalculo manual: perGet = 40_000+3_500 = 43_500; B = 10_000 + 121·43_500 = 5_273_500; +120_000 = 5_393_500. Con R=0: 1_220_000 y 1_340_000. Coincide con scope-approval.
2. Sin cambio de política: `resolveSlotAction`, POST, reintentos reales y corte C no están en el diff (solo attempt-recovery.ts: función de cota; handler: lectura de 2 claves + constante). Los reintentos de GET no tocan `attempt`: la prueba "reintentos de GET del Sandbox no incrementan attempt" usa el SandboxExecutionService real con fetch simulado (503 en un GET de estado), afirma `transientRetriesByOperation = {status:1, result:0}`, 6 `execute`, requestIds solo de intento 1 y 6 inicios; es real.
3. Normalización con Number(): "120" etc. funciona (probado en unidad y en handler). Handler y servicio usan las mismas constantes exportadas (DEFAULT_POLL_RETRIES, DEFAULT_POLL_RETRY_DELAY_MS, MAX_POLL_AFTER_MS), sin duplicar. Vacío/negativo -> 0 reintentos, coherente con el servicio (`attempt >= retries`). Ver observaciones O1/O2.
4. Fixture 1 h -> 2 h: necesario (umbral por defecto ahora ≈ 89 min con budget 60_000; con 1 h las filas ya no vencerían). No oculta regresión: 2 h sigue vencido y las nuevas pruebas fijan los bordes (83 min vigente con defaults; vencido con R=0, con base 1 ms y con STALE configurado). Los casos "no vencido" no cambian.
5. `.env.example`: fórmula, símbolos y valores (5273500 / 5393500) coherentes con el código; mención de R=0 correcta.
6. Alcance: solo 5 archivos de app (cota, handler, 2 specs, .env.example) + reporte de implementación. Sin DTO, contratos, migraciones ni otros handlers.

## Mutaciones (todas restauradas; `git status` limpio)
| Mutación | Resultado |
|---|---|
| (P+1)->P (quitar GET de resultado) | detectada, 9 fallos |
| exponente k+1 | detectada, 7 fallos |
| (R+1)->R timeouts | detectada, 9 fallos |
| quitar tope MAX en espera | detectada, 1 fallo |
| handler: base de espera -> 0 | detectada, 1 fallo |
| handler: retries -> 0 | detectada, 1 fallo |

## Comandos (desde app/)
pnpm lint OK; pnpm build OK; pnpm contracts:check OK; pnpm test: 155 archivos pasan (7 omitidos), 2527 tests pasan, 104 omitidos. Raíz: sdd-check OK; validate-work-items OK (74 WI); validate-harness OK; validate-completions OK (69).

## Hallazgos
- O1 (baja, attempt-recovery.ts:~133): con `SANDBOX_POLL_RETRIES` no entero (p. ej. 2.5) el servicio hace ceil (reintenta en attempt 0,1,2) y la cota usa floor, subestimando un reintento. Valor no soportado/documentado como entero; no bloqueante.
- O2 (baja, informativa): con valores no numéricos ("abc") en SANDBOX_POLL_RETRY_DELAY_MS la cota da NaN (el umbral deja de vencer); con SANDBOX_POLL_RETRIES="abc" el servicio reintenta sin fin mientras la cota asume 0. Clase de riesgo preexistente (T y P tampoco se validan); recomendable validar estas claves en un WI futuro, no en este.
- O3 (informativa, preexistente, fuera de alcance): la cota no incluye las esperas `pollAfterMs` entre consultas de estado (hasta 30 s × P); ya era así antes de este WI.

## Bloqueos
Ninguno. Pendiente: cierre del WI (state.json W-IN_PROGRESS) por el leader.

Archivos revisados: app/src/experiments/attempt-recovery.ts(.spec.ts), app/src/experiments/experiment-job.handler.ts(.spec.ts), app/.env.example, app/src/sandbox/sandbox-execution.service.ts. No se modificó código ni state.json.
