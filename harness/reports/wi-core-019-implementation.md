# WI-CORE-019 — Implementación y evidencia técnica
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer-high` (configurado claude-haiku-5-5, esfuerzo high, escalado desde el inicio: migración de enum Postgres y autorización multi-archivo de riesgo alto). El `sdd-analyst` verificó la suficiencia SDD (`wi-core-019-sdd-verification.md`).

## Cortes (commits locales, sin push)
| Corte | Commit | Refs | Contenido |
|---|---|---|---|
| A | `8c05613` | HU01, HU07 | `ADD VALUE 'WRITER'` (migración `20261008130000_project_role_writer`), `ROLE_RANK` único, `write` → `WRITER`, reconciliación/reverificación/revocación con `WRITER` |
| B | `e025062` | HU01, HU07, HU08 | Publicaciones, experimentos, bindings, binding verificado y github-ui exigen Writer; responder y `UNKNOWN` siguen en Maintainer (403 `PROJECT_ROLE_INSUFFICIENT` para Writer/Reader, con pruebas); fixture/matriz INTEROP §6.13 con fila `WRITER` |
| C | `f4fd2f1` | HU01 | Alcance `ALL` de `ACCESS_REVERIFY` (`ACCESS_REVERIFY:ALL`), siembra idempotente al arrancar, rol conservado si GitHub no responde |
| D | `02e4f1e` | HU07, HU08 | Migración `20261008140000_functional_knowledge_provenance`, enum `ConfirmingRole`, `confirmedByUserId`/`confirmedRole`/`originHeadSha`/`sourceRef`, DTO con `null` en históricas |

## Verificación (desde `app/`, ejecutada por el Leader en HEAD `02e4f1e`)
- `pnpm lint`: exit 0.
- `pnpm test`: 107 archivos pasan, 1 omitido; 1305 tests pasan, 36 omitidos.
- `pnpm build`: `nest build` sin errores.
- `tsc --noEmit -p tsconfig.build.json`: 0 errores. `tsc -p tsconfig.json`: 43 errores, el mismo conjunto preexistente de la línea base (sin errores nuevos).
- `prisma validate` y `prisma migrate diff` (HEAD vs. schema): el SQL coincide con ambas migraciones.
- **No ejecutado:** `pnpm test:e2e` (access-matrix, org-access, access-webhooks) y la cadena de migraciones contra una base: `app/.env` apunta a un Supabase remoto y no hay Postgres local disponible (Docker inactivo). Los e2e están actualizados y compilan, pero su corrida queda pendiente de una base local confirmada por el usuario.

## Notas para el Human Reviewer
- Cambio observable aprobado (`DEC-ORG-003`): quien solo tiene `write` pasa a Writer tras la reverificación y deja de poder responder preguntas funcionales; hasta entonces conserva el rol registrado (ventana residual aceptada).
- Orden de despliegue: migración + código de A, B y C juntos; una fila `WRITER` es ilegible para el código anterior.
- `ACCESS_REVERIFY:ALL` se encola en cada arranque (idempotente). Carga todos los registros y se acota por concurrencia y backoff existentes, sin paginación ni presupuesto como la reconciliación (b); si se quiere paginar, es una mejora aparte.
- Un evento selectivo durante un `ALL` en ejecución se encola como `PENDING` propio (el índice de dedupe solo cubre `PENDING`) y puede correr en paralelo; la corrección no depende del orden (advisory lock por proyecto/usuario y verificación viva).
- `sourceRef` es una columna sin escritor; no se creó un flujo de importación.
