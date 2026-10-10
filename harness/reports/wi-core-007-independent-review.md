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

## Segunda pasada (ciclo 2 de 2)

Fecha: 2026-10-09. Revisión delegada por el usuario; el reviewer no modificó código, spec ni harness (solo esta sección, sin commitear). Rango revisado: `aa141ce` (corte C: helper, su spec y `experiment-job.handler.spec.ts`) y docs `b090cc5`, `890e8d4`. HEAD: `890e8d4`.

Veredicto: **APPROVED** (0 blockers, 0 hallazgos nuevos que bloqueen).

### Hallazgos del ciclo 1
| # | Estado | Evidencia propia (ejecutada) |
|---|---|---|
| 1 Coste cuadrático | Resuelto | `'a-'` x50 000 (100 000 car.): 38 ms (antes 53 s); `'a-'` x1 000 000: 8 ms; base64url 200k: 13 ms (antes 3,5 s). Peores casos nuevos, cada uno a 20k y 200k caracteres: `password=[`, `password="`, `password='`, `https://u:p@`, `token: `, `key=`, `password=["`, `password=["\`, `https://`, `a://b/@`, mezcla, `Bearer `, `-----BEGIN PRIVATE KEY-----`, `password="\`, `password=[]`, `eyJ.a.`, `sk-`, `key=key=`, comilla sin cierre seguida de 50 000 `key=`, lista con 50 000 comillas escapadas, token único de 2 000 000: todos <= 65 ms. Sin ReDoS residual. |
| 2 Fugas | Resuelto | `password=[hunter2]`, `token=[abc123def456]`, `{"password":["hunter2","other"]}`, `https://user:p@ssw0rd@github.com/..`, `https://user:pa/ss1234@host/x`, `password="ab\"cd efgh"`: ninguno filtra y todos son idempotentes. Las 12 fugas restantes de la batería de 61 y las 5 de la de 27 son exactamente la deuda ya declarada (Slack, Stripe, Google, npm, Cookie, `credential/auth/signature=`, ruta de URL, `password x` sin separador, fullwidth, `ghp_short`, `sk_test_`, scp, JWT de 2 partes, zero-width); ninguna es un patrón de la spec. |
| 3 PEM/PGP | Resuelto | Bloque en minúsculas, `ENCRYPTED`, `OPENSSH`, `PGP PRIVATE KEY BLOCK` y bloque sin cierre quedan redactados. |
| 4 Camino LLM | Resuelto | Prueba nueva en `experiment-job.handler.spec.ts` (corte C, 20 líneas) afirma `failure` ausente en la escritura. |

### (b) Tope sin fugas
Secretos de 10 familias (password, Bearer, sk-, ghp_, userinfo, AKIA, JWT, PEM, `token=[..]`, `password="a b`) colocados con relleno para cruzar el límite de 16 384 en cada posición de -len-3 a +2, con y sin espacio previo: 0 fugas. Token sin espacios de 16 380 caracteres + secreto: salida de 500, sin secreto. Redactar antes de truncar a 500 intacto (cortes 470 a 499: 0 fugas; salida idempotente, longitud 500). Un secreto en los primeros caracteres de una entrada de 40 000 caracteres sigue redactado.

### (c) Regresiones
`git diff a3bd704..890e8d4 -- app` toca solo los 3 archivos declarados; repositorio, handler, DTO, `schema.prisma` y migración sin cambios. Mutaciones de ciclo 1 (guarda RUNNING, null explícito, DTO) siguen cubiertas por las mismas pruebas, que pasan.

### (d) Mutaciones sobre el helper (worktree desechable, ya eliminado): 9/9 detectadas
| # | Mutación | Pruebas que fallan |
|---|---|---|
| Q1 | Quitar el tope | 1 |
| Q2 | Reintroducir prefijo `[\w-]*` | 1 (rendimiento, umbral 250 ms) |
| Q3 | Volver a aceptar `[` como excepción | 5 |
| Q4 | Userinfo hasta el primer `@` | 1 |
| Q5 | Quitar flag `i` del PEM | 1 |
| Q6 | Quitar PGP `BLOCK` | 1 |
| Q7 | No descartar el último token al cortar | 1 |
| Q8 | Truncar a 500 antes de redactar | 4 |
| Q9 | Ignorar comillas escapadas | 3 |

### (e) Higiene
`aa141ce` compila (worktree desechable, `prisma generate`): `tsc -p tsconfig.build.json` 0 errores, `tsc -p tsconfig.json` 43 (base). `aa141ce`, `b090cc5`, `890e8d4` llevan `Refs: HU12, HU17`; el código con `Co-Authored-By: Claude Haiku 5.5` y los docs con Sonnet 5.5. Sin ramas (9) ni worktrees sobrantes; árbol limpio.

### (f) Gates (DATABASE_URL/DIRECT_URL inalcanzables)
`pnpm lint` 0; `pnpm test` x2: 124 files / 1770 passed, 82 skipped (ambas); `pnpm build` 0; `pnpm test:e2e` x2: 237 passed; `tsc --noEmit` 43 (base); `validate-harness` pasa.

### Observaciones menores (no bloquean)
- La prueba de rendimiento usa un umbral de reloj (250 ms); con margen ~6x sobre lo medido (38 ms), riesgo bajo de intermitencia en CI lento.
- Sobre-redacción aceptada y declarada (`https://host/@scope/pkg`, comilla sin cierre, `monkey=`): confirmada, sin impacto de seguridad.
- Deuda (no bloquea): IDEA-015, IDEA-016, `sandbox-execution.service.ts:224` loguea `failure.message` crudo, familias de secreto sin patrón listadas arriba, `code` sin redactar.

recommendedNextStep: cierre de WI-CORE-007 con la aprobación humana de alcance ya confirmada; sin ciclo adicional.
