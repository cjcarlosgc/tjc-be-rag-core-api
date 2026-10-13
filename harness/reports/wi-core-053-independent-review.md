Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-053 — revisión independiente (ciclo 1 de 2)

**Veredicto: APPROVED** (con 3 observaciones no bloqueantes)

- Rango: `a6fc363^..896cd86` (cortes A, B y C; `HEAD` 0e2e356 solo añade docs de harness). Independiente del implementer (claude-haiku-5-5).
- Migración (nombre exacto): `20261013100000_experiment_repetition_artifacts` (`app/prisma/migrations/20261013100000_experiment_repetition_artifacts/migration.sql`). **No se aplicó a ninguna base real.** Toda prueba SQL se hizo en un Postgres 14 desechable local (127.0.0.1:54398, `DATABASE_URL` forzada a esa instancia), ya detenido y sin datos reales.
- Modo fuera de casa: no sustituye `DEC`; DEC-VAL-001 (PENDING) no bloquea este WI según su `Blocks` y el alcance aprobado (solo pilotos, sin purga).

## Evidencia ejecutada

### 1. Migración
- `prisma migrate diff --from-schema <schema de a6fc363^> --to-schema <actual> --script` produce solo CREATE TABLE + CREATE UNIQUE INDEX + ADD FOREIGN KEY; coincide byte a byte (sin comentarios) con la parte DDL de `migration.sql`. El diff de esquema no toca ningún otro modelo salvo la relación inversa `artifact` en `ExperimentRepetition` (campo de relación, sin columna ni DDL).
- La migración solo contiene CREATE TABLE, CREATE UNIQUE INDEX, ALTER TABLE de la tabla nueva (ADD CONSTRAINT FK, ENABLE RLS) y el bloque DO con REVOKE a `anon`/`authenticated`, idéntico en estructura al de `20261009130000_retrieval_comparisons`. DROP/ALTER/UPDATE/DELETE sobre tablas existentes = 0 (además lo cubre `repetition-artifact-migration.spec.ts`).
- Ejecutada en el Postgres desechable (tabla `experiment_repetitions` mínima): aplica sin error; `relrowsecurity = t`; grants a `anon`/`authenticated` = 0; FK `ON DELETE CASCADE ON UPDATE CASCADE`; segunda fila con el mismo `repetitionId` falla por el índice único; borrar la repetición eliminó el artefacto (0 filas); el rollback documentado (`DROP TABLE "experiment_repetition_artifacts"`) funciona y deja solo las tablas previas.
- Nota: el Postgres local no tiene `pgvector`, así que no se pudo correr `migrate deploy` de toda la cadena; se aplicó únicamente el SQL nuevo, que no depende de ello.

### 2. `buildRepetitionArtifact`
Revisado el código y los specs: SHA-256 sobre el contenido completo; recorte por puntos de código acumulando bytes UTF-8 (no parte caracteres, nunca excede 262 144 bytes); 200 casos con `testCasesOmitted` y `testCasesTruncated`; mensajes de caso y de fallo pasan por `sanitizeFailureMessage` (secretos, URLs con query/credenciales; máx. 500 caracteres); sin stdout/stderr (el reporte se construye por lista cerrada de campos); hash canónico con claves ordenadas, determinista. En el handler el `testContent` es `mergedContent`, el mismo buffer enviado al Sandbox, y `artifactHash` se calcula sobre `mergedContent`; la prueba verifica `artifactHash === testContentSha256` en todas las escrituras. Una forma inesperada del resultado (p. ej. sin `stageDurations`) lanza dentro de `safeBuildArtifact` y se absorbe.

### 3. Cableado
- `writeRepetitionArtifact` solo se llama si `updateRepetitionById` devolvió `true`, después de escribir el resultado; try/catch propio que registra solo `error.name`. `safeBuildArtifact` aísla la construcción dentro del try del cliente de Sandbox, de modo que un fallo no se clasifica como INFRASTRUCTURE ni dispara reintento (prueba 9: 6 ejecuciones, 0 INFRASTRUCTURE, `complete` llamado).
- Idempotencia: upsert por `repetitionId`; cada intento (1 y 2) tiene su propia fila de repetición y su propio artefacto (prueba con 12 filas distintas). Camino de excepción del Sandbox: persiste contenido con `runnerReport` null; sin contenido generado o con fallo de generación no se escribe nada.
- Exposición: `rg` sobre `app/src` (excluido `generated/` y specs) muestra que el modelo `ExperimentRepetitionArtifact` solo lo referencia `upsertRepetitionArtifact`; ninguna consulta lo lee ni hace `include`. Los mappers de `getResults`, trace y `evidence/` no lo tocan (el bundle sigue usando solo `artifactHash` de la repetición). Prueba: el input de escritura pública no contiene `testContent`, `runnerReport` ni el contenido.

### 4. Privacidad
El contenido (código de terceros incluido en `mergedContent`, cuando el archivo existente se fusiona) queda en la base solo en la tabla privada, con RLS y sin grants a `anon`/`authenticated`; ninguna ruta pública la lee; sin purga (documentado en esquema y en la aprobación de alcance; DEC-VAL-001 PENDING; solo pilotos). Cascada al borrar la repetición.

### 5. Mutantes (aplicados en un worktree desechable sobre `896cd86`, ya eliminado; el implementer no tenía captura roja del corte A)
| Mutante | Resultado |
|---|---|
| M1 hash sobre contenido truncado | KILLED (repetition-artifact.spec) |
| M2 no truncar | KILLED (2 pruebas) |
| M3 no sanear mensaje de caso | KILLED |
| M3b no sanear mensaje de fallo | KILLED |
| M4 escribir artefacto antes del resultado | KILLED (2 pruebas de handler) |
| M5 propagar error del upsert | KILLED (4 pruebas de handler) |
| M6 incluir stdout | KILLED |
| M7 FK `ON DELETE RESTRICT` en migración | KILLED (migration spec) |
| M8 quitar aislamiento de `safeBuildArtifact` | KILLED |
| M9 no limitar a 200 casos | KILLED |
| M10 hash no canónico | KILLED |
| M11 upsert -> create | KILLED (2 pruebas de repositorio) |
| M12 recorte por unidades UTF-16 en vez de bytes | KILLED |

Limitación: ninguna prueba cubre `onDelete: Cascade` en `schema.prisma` (solo en el SQL); lo valida el `prisma migrate diff` (ver 1).

### 6. Alcance
`git diff a6fc363^..896cd86 --name-only`: 9 archivos, todos en `app/` (`prisma/schema.prisma`, migración, `experiments/*`). Sin cambios en sandbox, ranking/contexto RAG, clasificación, DTO público ni contratos/spec. Búsqueda de patrones de secretos en el diff: 0 coincidencias.

### 7. Gates
- `npx vitest run` (app): 142 archivos pasan, 6 omitidos; 2242 pruebas pasan, 104 omitidas.
- `npx oxlint src/ test/`: exit 0, sin hallazgos.
- `tsc --noEmit`: 42 errores en `a6fc363^` (worktree con `prisma generate`) y 42 en `896cd86`; diff por archivo y mensaje = 0 (delta 0).
- `node harness/validate-harness.mjs`: pasa. `node --test harness/*.test.mjs`: 31/31.
- Sin build (acordado).

## Hallazgos

| # | Severidad | Hallazgo | recommendedNextStep |
|---|---|---|---|
| F1 | low | `suitePath` y `name` de los casos no se sanean ni acotan (solo `errorMessage` y `failure.message`); un runner con nombres enormes podría inflar el JSONB (200 casos × tamaño libre). El Sandbox ya normaliza, pero Core no impone tope. | Opcional: acotar `name`/`suitePath` a un máximo (p. ej. 2 KiB) en un WI posterior; no bloquea. |
| F2 | low | Un `\u0000` en el contenido de prueba o en un mensaje hace fallar el upsert de Postgres (TEXT/JSONB no admiten NUL); el efecto es solo perder la evidencia de esa repetición (best-effort, warn con el nombre del error). | Aceptable por diseño; si aparece en pilotos, retirar NUL antes de guardar y marcar el recorte. |
| F3 | low | El comportamiento (tabla privada, sin purga, límites) vive en esquema, WI y reportes, pero no en la spec canónica (`ST-CORE-060` sigue `T-IN_PROGRESS`). | Al cerrar el WI, consolidar en la spec de datos/§ de retención y registrar en `CHANGELOG.md`; la migración debe aplicarla el coordinador con `pg_dump` previo. |

blockers: ninguno. filesAffected: los 9 archivos del rango (todos bajo `app/`). recommendedNextStep: cerrar WI-CORE-053 (W-DONE) tras consolidar F3; la aplicación de la migración a la base real queda fuera de Core (coordinador).
