# WI-CORE-071 — Verificación SDD (F3: reintentos de GET en la cota del Sandbox)
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Estado: DECISION_REQUIRED. Solo lectura; no se tocó código, state.json ni work-items.json. Alcance sin aprobar.

## 1. Fórmula y valores

Defaults reales (código y `app/.env.example`): requestTimeoutMs 10_000, maxPollAttempts 120, retries 3, baseDelay 500, MAX_POLL_AFTER_MS 30_000, generationTimeoutMs 120_000, intervalo 15_000. La variable es `EXPERIMENT_HEARTBEAT_STALE_MS` (no `HEARTBEAT_STALE_MS`).

- Actual: `bound = T*(P+2)` = 10_000*122 = 1_220_000 ms. `stale = max(configuredMs ?? G + bound, 3*intervalo)` = 1_340_000 ms (22,3 min).
- Propuesta (A): por cada GET (P de estado + 1 de resultado = 121) se suman hasta R reintentos, cada uno con su timeout T y su espera `min(base*2^k, 30_000)`: `extraPorGET = R*T + sum_{k<R} min(base*2^k, MAX)` = 30_000 + (500+1000+2000) = 33_500 ms. `bound' = T*(P+2) + (P+1)*extraPorGET` = 1_220_000 + 4_053_500 = 5_273_500 ms. `stale' = G + bound'` = 5_393_500 ms (89,9 min), 4,02x el actual.
- `configuredMs` sigue mandando: el cambio solo toca el término por defecto (`G + bound`); el mínimo 3×intervalo (45_000) se conserva. Con `EXPERIMENT_HEARTBEAT_STALE_MS` definido, el cambio no tiene efecto.
- Hallazgo adicional: la cota actual también ignora las esperas de sondeo (`pollAfterMs`, hasta 30 s x 120 = 3_600_000 ms en el peor caso) y el POST no se reintenta. La "cota" ya es heurística, no un máximo teórico.
- Hallazgo clave: un intento vivo renueva su latido cada 15 s (`EXPERIMENT_HEARTBEAT_INTERVAL_MS`, temporizador del handler), así que los GET reintentando no dejan de latir. El vencimiento solo se alcanza si el proceso muere o el event loop se bloquea. F3 es, en la práctica, margen de seguridad y no un defecto activo.

## 2. Cambio observable en relanzamientos

- Intento vivo con GET reintentando: hoy y después, IN_FLIGHT (el latido sigue renovándose). Sin diferencia mientras el proceso viva.
- Intento realmente muerto (proceso caído): hoy se relanza como attempt 2 tras ~22,3 min sin latido; con A, tras ~89,9 min. Costo: +67,6 min de detección por intento muerto (aplica igual a `CLOSE_EXPIRED_SECOND` en attempt 2). El reschedule del job usa `min(staleMs, ...)`, por lo que el job espera más entre revisiones.
- Attempt 2 RUNNING vencido: se cierra como fallo (`CLOSE_EXPIRED_SECOND`), también con retraso de +67,6 min. Una repetición bloqueada tarda más en liberar el run.
- Intento vivo mal declarado vencido hoy: solo posible si el latido no se renueva (event loop bloqueado/GC largo/falla del temporizador) por más de 22,3 min; en ese caso el relanzamiento cierra el intento 1 y ejecuta attempt 2 mientras el proceso original podría seguir ejecutando (posible doble ejecución). A reduce esa ventana, pero no cambia el mecanismo.

## 3. Riesgo frente a tesis 3.3.8

- `resolveSlotAction` nunca devuelve un tercer intento y el intento 2 vencido se cierra: el tope de 2 por slot no depende de `staleMs`. Subir `staleMs` no puede aumentar los intentos; solo retrasa el relanzamiento. No reduce reintentos de trial.
- Doble ejecución: el riesgo existente (ver arriba) disminuye con un umbral mayor; el cambio no lo agrava.
- Los reintentos de GET viven dentro de `SandboxExecutionService.withTransientRetries` (un solo `runAttempt`, mismo `executionId`); no crean fila `ExperimentRepetition` ni incrementan `attempt`. El reintento de trial solo lo dispara `runAttempt` retornando fallo externo en attempt 1 o el relanzamiento por latido vencido. El POST no se reintenta, así que un trial no se duplica por transporte.
- Nota de tesis: el relanzamiento por latido vencido (proceso muerto) consume el único reintento aunque no haya "fallo externo demostrable" estricto. Es comportamiento previo (WI-CORE-025), fuera de este WI; conviene que el usuario lo tenga presente.

## 4. Pruebas

- `app/src/experiments/attempt-recovery.spec.ts` fija `sandboxHttpBoundMs(10_000, 120) = 1_220_000`, el default `1_340_000` (con bound = 1_220_000 explícito), `configuredMs = 600_000` y el piso 45_000. Las dos últimas no cambian; las dos primeras cambian en A.
- Los demás tests de `resolveSlotAction` usan STALE = 60_000 y no dependen de la fórmula. `experiment-job.handler.ts` (única llamada) pasa `SANDBOX_*` por `ConfigService`; hay que verificar si el spec del handler asume el default (no se halló referencia a `HEARTBEAT_STALE` en specs).
- Nuevas: firma ampliada de `sandboxHttpBoundMs(T, P, R, base)`; valores por defecto (5_273_500 / 5_393_500); R=0 equivale a la fórmula actual; esperas acotadas por 30_000 (base grande); `configuredMs` sigue mandando; el handler lee `SANDBOX_POLL_RETRIES` y `SANDBOX_POLL_RETRY_DELAY_MS` con los mismos defaults que el servicio (idealmente reutilizando `DEFAULT_POLL_RETRIES`/`DEFAULT_POLL_RETRY_DELAY_MS`/`MAX_POLL_AFTER_MS` exportados); un test que fije que reintentos de GET no incrementan `attempt`.
- Actualizar el comentario de `.env.example` (líneas 119-121) y la documentación de la fórmula.

## 5. Opciones

- A. Sumar el máximo teórico (121 GET x 33_500 ms): default 5_393_500 ms (89,9 min). Corrige F3 por completo; costo: +67,6 min para detectar un intento muerto. Requiere decisión del usuario sobre el valor (aceptar ~90 min).
- B. Sumar solo una cota parcial (p. ej. los reintentos de un GET, +33_500 ms, o un presupuesto fijo): stale 1_373_500 ms, +33,5 s. Casi sin costo, pero la cota no es exacta; requiere decisión del usuario sobre el criterio y el valor.
- C. No cambiar la fórmula; documentar F3 como margen heurístico y dejar `EXPERIMENT_HEARTBEAT_STALE_MS` a ajuste operativo. Cero cambios de comportamiento; no cierra F3 como código.

Recomendación: B si se quiere cerrar F3 con riesgo mínimo (sumar los reintentos de un solo GET porque los GET son secuenciales y el latido sigue vivo); A solo si el usuario prioriza no relanzar nunca mientras haya GET en reintento y acepta ~90 min de detección. En todos los casos, la tesis 3.3.8 queda intacta. El valor final lo decide el usuario (A y B); C no requiere valor.

## 6. Decisiones PENDING/PROPOSED que alcanzan este WI

- Ninguna decisión PENDING/PROPOSED con Blocks alcanza el comportamiento de latido ni la cota (se buscó en `spec/` y `harness/`). `DEC-VAL-001` está PENDING pero solo afecta retención/alcance de datos, no este WI; `DEC-AUTH-001` aplica solo a la configuración de SANDBOX_URL/token. La spec 008 solo exige no convertir decisiones PENDING en implementación definitiva. No hay redacción de tesis 3.3.8 en `spec/` más allá de `harness/reports/wi-core-071-scope.md` y `tasks.md` (ST-CORE-078).
