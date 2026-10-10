# WI-CORE-007 — Revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Fecha: 2026-10-09. Revisión delegada explícitamente por el usuario (Human Reviewer) en chat. El reviewer no implementó, corrigió ni commiteó nada; este archivo es lo único que creó en el árbol (sin commitear).

- Rango de código: `git diff 9ac7506^..9618e6b -- app` (commits A `9ac7506` y B `9618e6b`) más docs hasta `a3bd704` (HEAD). HU: HU12, HU17.
- Veredicto: **CHANGES_REQUESTED** (0 blockers, 2 importantes, 2 menores). El diseño, la persistencia, la guarda, el DTO y la migración son conformes; los incumplimientos están en el saneado.

## Verificaciones ejecutadas (evidencia)

| Verificación | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm test` x2 | 124 files passed / 3 skipped; 1728 passed / 82 skipped, ambas corridas |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` x2 | 7 files, 237 passed, ambas corridas, sin `socket hang up` |
| `npx tsc --noEmit -p tsconfig.json` (cliente regenerado) | 43 errores, todos en specs/soporte preexistentes (ninguno en archivos del WI salvo el de `experiment-job.handler.spec.ts(596,9)`, ya presente en la base) |
| `node harness/validate-harness.mjs` | `Harness V3 validation passed.` |
| `contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-007` | `relevantPendingSyncIds: []`, `acknowledgedSyncIds: []`; no relevantes CS-20260920-001, CS-20260921-003. No registró nada. |
| Compilación por commit (worktree desechable, `prisma generate` por commit) | `tsc -p tsconfig.build.json`: 0 errores en `9ac7506^`, `9ac7506`, `9618e6b`; `tsc -p tsconfig.json`: 43 en los tres (base 43, sin regresión) |
| PostgreSQL 14.18 desechable (127.0.0.1:55907, shim de pgvector solo en copia de las migraciones: `vector(1536)` -> `double precision[]`, sin HNSW) | Las 44 migraciones se aplican en orden, incluida `20261009180000`; columna `failure jsonb NULL`, sin default; RLS activa en la tabla |
| `prisma migrate diff --from-config-datasource --to-schema` | Sin diferencias para `failure`; solo `embedding` (efecto del shim) y renombres/tipos preexistentes de context_traces, discovered_files e índices de experiment_repetitions (los mismos que ya reportó WI-CORE-026) |
| Rollback documentado (`DROP COLUMN "failure"`) | Ejecutado en `BEGIN ... ROLLBACK`: válido |
| SQL real con el repositorio real (spec temporal, ya eliminado) | 3/3: fila nueva lee `null`; `updateRepetitionById` con hecho persiste el JSON ya saneado (`password=[REDACTED]`, URL sin credenciales ni query); un segundo write sobre intento cerrado devuelve `false` y no sobrescribe; sin hecho la columna queda SQL NULL (`jsonb_typeof` nulo, no JSON `null`); intentos 1 y 2 conservan cada uno su hecho; `closeInterruptedRepetition` deja `failure` NULL |
| Higiene | `git status` limpio; sin ramas ni worktrees nuevos (9 ramas, un solo worktree); PostgreSQL y worktree bajados y borrados |

## Conformidad

- (a) Corrección: `updateRepetitionById` conserva `where: { id, state: RUNNING }` (`experiment-runs.repository.ts:305-313`) y omite la clave sin hecho (no hay `null` explícito, verificado también con SQL real). `closeInterruptedRepetition` y `onExhausted` no tienen cambios en el diff. Excepción del cliente (`catch` interno) y fallo LLM/generación (`catch` externo, `failure` por defecto `null`) no llevan hecho; `TIMED_OUT` sin hecho deja NULL; `COMPLETED` descarta el hecho. `stage`/`category` fuera de dominio, `code` vacío o campos no textuales dan `null`. La política de reintento no se toca (solo líneas añadidas; `externalFailure` sigue calculado de `failureType`/`sandboxTimedOut`).
- (c) DTO: `ExperimentRepetitionResponse` y `TargetRunResult` sin cambios; el mapeo de `experiments.service.ts:~284-300` es campo a campo (sin spread). `findRepetitions` no tiene otro consumidor que lo emita.
- (d) Migración: aditiva (columna nullable), sin backfill, rollback documentado en el encabezado, coincide con `schema.prisma`, orden posterior a `20261009170000`.
- (f) Higiene: los tres commits de código/docs del WI llevan `Refs: HU12, HU17`; A y B con `Co-Authored-By: Claude Haiku 5.5`, docs con Sonnet 5.5; cada commit compila.

## Calidad de pruebas: mutaciones (worktree desechable, ya eliminado)

Se corrieron los 5 specs del WI contra cada mutación. Todas **detectadas**:

| # | Mutación | Pruebas que fallan |
|---|---|---|
| M1 | `updateRepetitionById` sin guarda `RUNNING` | 4 |
| M2 | `failure: failure ?? null` (null explícito) | 2 |
| M3 | Sin redacción | 16 |
| M4 | Truncar antes de redactar | 4 |
| M5 / M5b | Aceptar `category` inválida / `stage` inválido | 1 / 2 |
| M5c / M5d | Aceptar `code` vacío / no truncar `code` | 2 / 2 |
| M6 / M6b | `closeInterruptedRepetition` escribe un hecho / escribe null | 2 / 2 |
| M7 / M7b | DTO expone `failure` / spread de la fila en el DTO | 1 / 1 |
| M8 | Escribir hecho también con `COMPLETED` | 1 |
| M9 | Sintetizar hecho ante excepción del cliente | 1 |
| M10 | No pasar el hecho a `recordRepetition` | 6 |

## Hallazgos

### 1. importante — Backtracking cuadrático en `SENSITIVE_PAIR` (bloqueo del event loop con un mensaje del Sandbox)
- `app/src/common/sanitize-failure-message.util.ts:23-24`: el prefijo `\b[\w-]*(?:password|...|key|...)` reintenta desde cada frontera `\b` (cada `-` crea una) y recorre hasta el final de la corrida: O(n^2).
- Medido (ejecutado): `'a-'.repeat(n/2)` tarda 17 ms (2 000), 105 ms (5 000), 399 ms (10 000), 1,6 s (20 000), 3,7 s (30 000) y 53 s (100 000). Un blob base64url de 200 000 caracteres tarda 3,5 s. `sanitizeFailureMessage` se llama de forma síncrona en el handler (`toExperimentRepetitionFailure`) antes de truncar; el redactar-antes-de-truncar exige procesar el mensaje entero y `failure.message` del Sandbox no tiene tope en `SandboxFailureFact` (`sandbox.types.ts:44`).
- Escenario: el Sandbox devuelve un `failure.message` de unos 100 KB con guiones (salida de compilador o de un test con una cadena larga tipo `a-b-c-`); el worker del job queda bloqueado decenas de segundos, el latido (`lastHeartbeatAt`) vence y la repetición puede cerrarse como interrumpida por otro worker.
- Corrección posible: acotar la entrada antes de las regex a un tope generoso (p. ej. 8-16 KB, documentado, sin romper "redactar antes de truncar" porque el secreto ya cortado no se vuelve a ver) o reescribir el prefijo sin `[\w-]*` (p. ej. anclar en la palabra sensible con `(?:password|...)` y lookbehind acotado).

### 2. importante — Fugas en patrones que la spec promete cubrir
Ejecutadas con una batería propia (61 + 27 casos; 12 fugas del primer lote, ver menores y deuda):
- `sanitize-failure-message.util.ts:24` (`(?!\[)`): `password=[hunter2]`, `token=[abc123def456]` y `{"password":["hunter2","other"]}` salen **sin redactar** (la excepción de «ya es un marcador» deja pasar cualquier valor que empiece por `[`). La spec lista «pares `password|token|secret|api[_-]?key|authorization = valor»`. Corrección posible: la excepción solo para el literal `[REDACTED]`.
- `sanitize-failure-message.util.ts:32` (`[^\s/?#@]+@`): `git clone https://user:p@ssw0rd@github.com/o/r` produce `https://[REDACTED]@ssw0rd@github.com/o/r` (fuga parcial `ssw0rd`); `https://user:pa/ss1234@host/x` no se toca (fuga completa). La spec lista «credenciales `user:pass@`». Corrección posible: consumir hasta el último `@` antes del primer espacio del authority, o tratar `/` como parte del userinfo si hay un `@` posterior en el mismo token.
- `sanitize-failure-message.util.ts:24` (`"[^"]*"`): `password="ab\"cd efgh"` deja `cd efgh"` (fuga parcial; valor con comilla escapada).
- Escenario: un `failure.message` del Sandbox con `{ token: [ 'x' ] }` o con una URL de clone con contraseña que contiene `@` llega al hecho persistido y luego a la evidencia de WI-CORE-027 con el secreto en claro.
- La batería también confirmó que están bien cubiertos (sin fuga, idempotentes): Bearer (mayúsc/minúsc), JWT de 3 partes, `sk-…`, `ghp_/gho_/ghs_/ghu_/ghr_/github_pat_`, `AKIA/ASIA`, PEM (RSA, OPENSSH, ENCRYPTED, sin cierre), `password/token/secret/apikey/api_key/api-key/x-api-key` con `=`/`:`/JSON, `OPENAI_API_KEY=`, URL con userinfo, query y fragmento firmados, multilínea (`\n`, `\r\n`, tab), Unicode (`пароль123`) y NUL embebido. Redactar-antes-de-truncar probado con 8 familias de secreto en 11 posiciones de corte (0 a 499): sin fuga parcial, longitud <= 500 e idempotente en todas.

### 3. menor — PEM insensible a mayúsculas y bloque PGP
- `sanitize-failure-message.util.ts:15-16`: `-----begin private key-----` (minúsculas) y `-----BEGIN PGP PRIVATE KEY BLOCK-----` (exige `PRIVATE KEY-----` pegado) no se redactan. Corrección: flag `i` y admitir `PRIVATE KEY(?: BLOCK)?-----`.

### 4. menor — La prueba de «fallo LLM deja NULL» no existe
- `experiment-job.handler.spec.ts` (bloque `failure fact`, ~2332-2520) cubre excepción del cliente, `TIMED_OUT` sin hecho, `COMPLETED`, stage/code inválidos, pero ningún caso fuerza el `catch` externo (generación LLM fallida) y afirma `!('failure' in write)`. El comportamiento es correcto por construcción (el valor por defecto de `recordRepetition` es `null`), pero la regla (a) de la spec queda sin prueba que la rompa.

## Deuda (fuera de alcance, no bloquea)
- IDEA-015 (ya registrada): `map-sandbox-result.ts` copia `failure.message` crudo a `errorSummary`, que sale en `ExperimentRepetitionResponse`.
- `sandbox-execution.service.ts:224` registra `result.failure.message` crudo en el log (mismo riesgo, canal de logs); usar `sanitizeFailureMessage`.
- Familias de secreto sin patrón y sin fuga cubierta (la spec no las lista): Slack `xox[bpas]-…`, Stripe `sk_live_/sk_test_`, Google `AIza…`, npm `npm_…`, `Cookie:`/`Set-Cookie:` (`session=`), claves `credential|auth|signature=`, secretos en la ruta de una URL (webhooks de Slack) y `password hunter2` sin `=`/`:`. Conviene ampliar la lista cuando WI-CORE-027 reutilice el helper.
- `code` se trunca pero no se redacta (ya anotado en el reporte de implementación).
- `ExperimentRepetitionInput` (usado también por `insertRepetition` con spread) ahora admite `failure`; hoy ningún caller lo pasa, pero un futuro uso escribiría el hecho fuera de la escritura guardada.

## Resumen para el leader
- status: CHANGES_REQUESTED
- blockers: ninguno (los dos importantes no exponen datos hoy: `failure` es interno hasta WI-CORE-027)
- filesAffected: `app/src/common/sanitize-failure-message.util.ts` (hallazgos 1-3), `app/src/common/sanitize-failure-message.util.spec.ts` y `app/src/experiments/experiment-job.handler.spec.ts` (pruebas nuevas para 1, 2 y 4)
- evidence: tabla de verificaciones y mutaciones arriba (lo ejecutado) y, razonado, la corrección por construcción de los caminos LLM/`onExhausted`
- recommendedNextStep: corte corrector de Haiku High sobre el helper (acotar entrada o reescribir el prefijo; excepción `[` solo para `[REDACTED]`; userinfo hasta el último `@`; PEM `i` + PGP) con pruebas de regresión para cada caso de este informe y una de rendimiento (p. ej. `'a-'.repeat(50000)` < 100 ms), más la prueba del camino LLM; después segunda pasada (ciclo 2 de 2) y cierre con confirmación humana. El veredicto no sustituye la aprobación humana de alcance, que el usuario ya confirmó en chat para 007.
