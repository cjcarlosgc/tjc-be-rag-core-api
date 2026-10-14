# WI-CORE-063 — replay de calibración offline: línea base y cómo ejecutarlo
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14. Herramienta: `harness/calibration/` (no `app/`; sin LLM; sin escritura en la base). Datos fuera del repositorio (código de terceros): este informe solo trae métricas agregadas y números.

## Cómo ejecutarlo
1. **Extraer** (solo `SELECT`, sin imprimir credenciales; aborta si `--out` está dentro del repo): `bash harness/calibration/extract-experiments.sh --out <dir-externo> 951a7bb2 656140e5 cad591d6 5852aeb4 c9948c77 9a905b5a`. Los 9 casos V1 se leen del directorio de replay (`<CASO>.meta/chunks/cands.json`) y sus trials con un `SELECT` análogo por `experiment_runs.id`.
2. **Dependencias reales** (M1 sección, M4): `PHP_DEP_REPLAY_DIR=<dir> PHP_DEP_REPLAY_OUT=<dir>/out.json npx vitest run src/retrieval/php-dependency-replay.spec.ts` (desde `app/`) y copiar `out.json` como `deps.json`.
3. **Calibrar:** `node harness/calibration/calibrate.mjs --data <dir> [--candidate candidate.json] --out <dir-externo>` escribe `report.json`, `report.md` y la plantilla manual `m2-template.md` (R1–R5). Sale con código ≠ 0 si la línea base no reproduce el SELECTED persistido (verificación 10/10). Pruebas: `node --test harness/calibration/*.test.mjs` (26) y `node --test harness/*.test.mjs` (31).

## Línea base — 9 casos V1 (configuración 0.7/0.3, topK 10, minimumScore 0)
| Caso | Target | M1 colaboradores en top-10 | M1 en la sección | M3 tests ajenos % tokens | M3 miembros no referenciados % | M4 tokens seleccionados / sección | M5 vs línea base |
|---|---|---|---|---|---|---|---|
| RES-1 | `AvailabilityService::canReserve` | 3/3 | 3/3 | 0 | 13.8 | 383 / 112 | 10/10 |
| RES-2 | igual | 3/3 | 3/3 | 0 | 13.8 | 385 / 112 | 10/10 |
| RES-3 | `CancellationPolicy::refundAmount` | 0/0 | 0/0 | 48.3 | 8.9 | 559 / 0 | 10/10 |
| SAL-1 | `DiscountPolicy::discountFor` | 2/2 | 2/2 | 0 | 21.5 | 447 / 99 | 10/10 |
| SAL-2 | `DiscountCalculator::applyPercentage` | 0/0 | 0/0 | 0 | 43.4 | 417 / 0 | 10/10 |
| SAL-3 | `OrderLine::total` | 0/0 | 0/0 | 24.7 | 30.8 | 442 / 0 | 10/10 |
| SUB-1 | `RenewalService::renew` | **1/4** | 4/4 | 0 | 15.5 | 595 / 139 | 10/10 |
| SUB-2 | igual | **1/4** | 4/4 | 0 | 15.8 | 584 / 139 | 10/10 |
| SUB-3 | `Subscription::applyPendingPlan` | 1/2 | 2/2 | 0 | 20.0 | 601 / 101 | 10/10 |

Verificaciones no oficiales (6, mismos proyectos con ProjectVersion nueva): misma forma (M1 top-10 1/4 y sección 4/4 en `RenewalService::renew`; M5 10/10 en todas; M4 sección 91 a 139 tokens según tenga o no marca `final`).

## Hallazgos
- **M1:** con la sección de dependencias (WI-057/058) la presencia de colaboradores sube a 100 % en los 9 casos, mientras que en el top-10 solo 1/4 (SUB-1/2) y 1/2 (SUB-3) están presentes: el cambio candidato no necesita mover el ranking para cubrirlos.
- **M3:** el ruido de pruebas ajenas solo aparece en RES-3 (48 %) y SAL-3 (25 %); el ruido de miembros no referenciados oscila entre 9 % y 43 %.
- **M5:** la línea base reproduce el top-10 persistido (10/10) en los 9 casos V1 y en las 6 verificaciones; un candidato `topK 8` baja a 8/10 sin perder colaboradores (ejemplo en `candidate.example.json`).
- **M6 (reglas estáticas sobre el `testContent`, precisión observada contra el resultado real):**
  | Conjunto | Regla | Trials con hit | Hit y válido (posibles FP) | Fallidos con evidencia | Precisión | Sensibilidad |
  |---|---|---|---|---|---|---|
  | V1 (54 trials) | R-FINAL (doble de clase `final`) | 2 | 0 | 2 | 1 | 1 |
  | V1 | R-NS (`use` fuera de contexto) | 6 | 0 | 6 | 1 | 1 |
  | V1 | R-SAME (assertSame sobre objetos de valor) | 0 | 0 | 0 | n/a | n/a |
  | Verificaciones (36 trials) | R-FINAL | 9 | 0 | 9 | 1 | 1 |
  | Verificaciones | R-NS | 5 | 1 | 0 | 0 | n/a |
  | Verificaciones | R-SAME | 0 | 0 | 2 | n/a | 0 |
  R-FINAL es la regla más fiable (9/9 y 2/2). **R-SAME no detecta** las dos fallas reales de identidad (`951a7bb2` rep 2 y 3: `assertSame` sobre el valor devuelto por `$dates->nextDate(...)`, un `DateTimeImmutable` nuevo): la heurística exige `new`/`createFromFormat` y evita los falsos positivos de `assertSame($plan, $subscription->plan)` (identidad legítima), por lo que queda silenciosa. R-NS tiene un hit en un trial válido y 0 evidencias en el conjunto de verificaciones: poco fiable ahí.

## Limitaciones
Muestra pequeña (9 casos V1 + 6 verificaciones, 3 proyectos piloto); proxies y heurísticas (M3, M6) sin referencia externa; M2 es manual; no mide calidad ni validez de pruebas ni llama al LLM; el prompt no se persiste (solo hash), así que M6 opera sobre el test generado y no sobre las instrucciones; no comparar con el piloto sin declarar la versión del resolutor (WI-057/058) y de `inspect_symbol` (WI-059). Decisión abierta: ampliar R-SAME a valores de retorno de métodos (riesgo de falsos positivos) o aceptar que quede silenciosa; la evidencia observada (2 fallos reales) respalda la instrucción de convención del prompt (`WI-CORE-064`) independientemente de la regla estática.
