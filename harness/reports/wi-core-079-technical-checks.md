# WI-CORE-079 — verificaciones técnicas
Modelo: implementer · configurado claude-sonnet-5-5 · atendido claude-haiku-5-5 · esfuerzo low

Fecha: 2026-10-24. Rama `feature/jean`, HEAD base `82d48f4`. Sin commit ni push (lo hace el leader). `node` se usó con `PATH=/Users/cjcarlosgc/.local/node22/bin:$PATH`. No se leyó ningún `.env`; no se editaron `harness/state.json`, `harness/work-items.json`, `harness/contract-sync/**`, `referencias/`, `AGENTS.md` ni otros repos.

## Comandos y resultados (desde `app/` salvo indicación)

| Comando | Resultado |
|---|---|
| `npm run contracts:generate` | OK: «Contratos generados en src/contracts/generated (5 esquemas).» |
| `npm run contracts:check` | exit 0 (sin deriva tras regenerar) |
| `npx vitest run src/github-webhooks/dto/normalized-webhook-event.contract.spec.ts` | 1 archivo, **56 tests passed** |
| `npm run lint` (oxlint src/ test/) | exit 0, sin avisos |
| `npm run build` (nest build) | exit 0 |
| `npm test` (vitest run, unitarios) | exit 0; **158 archivos passed, 7 skipped; 2717 tests passed, 104 skipped** |
| `node scripts/sdd-check.mjs` (raíz) | exit 0, «SDD check OK» |

Nota sobre la línea base: el encargo indicaba 2646 tests. Esta ejecución da 2717 passed (56 de ellos son nuevos). 2717 − 56 = 2661, que no coincide con 2646. No re-medí la línea base en el commit anterior; la diferencia no se explica aquí.

## Cambios de esta ronda (archivos)

- Esquema nuevo: `spec/contracts/schemas/github-webhook-event.schema.json` (2020-12, `$id` `https://tjc.local/contracts/github-webhook-event.schema.json`). Sobre `oneOf` de nueve variantes a nivel de sobre (`GithubWebhookEvent`); `eventName` constante por variante; `IGNORED` con `eventName: {not: {enum: [8]}}`. Respuesta `GitHubWebhookAcceptedResponse` con `accepted: const true` (el servicio solo emite `accepted: true`, verificado en `github-webhooks.service.ts:56-117`).
- Ejemplos: 15 entradas nuevas en `spec/contracts/schemas/examples/` con prefijo `github-webhook-event.` (13 eventos, uno por variante y casos con nulos, `installation-repositories` con `added` y `removed` no vacíos, `repository.no-owner`, `ignored` con `ping`; 2 respuestas: 202 y 200 duplicado). Datos sintéticos (`example-org/example-repo`, IDs 1001–4001, SHAs ficticios). `manifest.json` +75 líneas.
- `sandbox-result.failed.json` línea 11: `DEPENDENCY_INSTALL_FAILED`.
- `app/src/contracts/generated/contract-types.ts` (+196) y `contract-schemas.ts` (+760): regenerados.
- Prueba nueva: `app/src/github-webhooks/dto/normalized-webhook-event.contract.spec.ts` (solo spec, sin código de producto). Cubre ejemplos válidos (esquema y round-trip del parser), 27 inválidos (esquema y `AppException` `INVALID_REQUEST`), paridad con 3 divergencias declaradas y el ejemplo `pull-request.opened` por `POST internal/v1/github/webhook-events` con bearer.
- Documental: `interoperability-contract.md` (INTEROP-2.20; E-01 en §6.5; referencias a GH-INTEROP-1.9 en §6.9 y en la línea ~1080; §10 enumera el esquema), `system-contract.md` (SYSTEM-2.15; `:287` neutral; párrafo de compatibilidad), `github-integration-contract.md` (GH-INTEROP-1.9: título, «Estado:» nuevo, forma canónica, brechas), `spec/README.md:5`, `CHANGELOG.md` (entrada WI-CORE-079 arriba de WI-CORE-084).
- Este archivo.

No se tocaron `normalized-webhook-event.ts`, DTOs, rutas, enums ni comportamiento de Core. No hay `oracleRef`. No se calcularon digests de Contract Sync.

## Decisiones de diseño tomadas

1. **Sobres `oneOf` (9) en lugar de sobre único con `oneOf` solo en `data`.** `json-schema-to-typescript` generó la unión sin problemas y `strict` de Ajv aceptó el esquema, así que no hizo falta el fallback. La coherencia eventName↔kind queda expresada en el esquema. Excepción: en el tipo generado `IGNORED.eventName` es `string` (el `not` no se traduce a TypeScript); esa restricción solo la aplica el esquema y el parser.
2. **Sin `title` en los `$defs` raíz.** Con `title` el generador renombraría el tipo (`NormalizedWebhookEvent` o un texto con espacios).
3. **Campos de respuesta sin `minLength`** en `title`, `ref`, `sha` (A-1): el esquema copia al parser.

## Pruebas de frontera: lo que el spec fija

- Válidos: los 13 eventos pasan el esquema y `parseNormalizedWebhookEvent` (`toEqual` con el ejemplo); las 2 respuestas pasan el esquema.
- Inválidos: 27 casos (claves extra o ausentes, `schemaVersion`, `deliveryId` vacío y de 256, `eventName` y `action` de 101, IDs `"0"`/`"01"`/numérico, `pullRequestNumber` 0/1.5/`"7"`, `createdAt` con offset/sin Z/día 30 de febrero, `receivedAt` con espacio o `t` minúscula, `kind` desconocido, `kind`↔`eventName` incoherente, `data: null`, IGNORED con clave extra, `added` no array). Todos fallan en ambos lados.
- Paridad: 8 casos iguales (incluidos los que ambos aceptan: `title`/`ref`/`sha` vacíos, offsets y fracciones en `receivedAt`, `pullRequestNumber` > 2^53) y 3 divergencias declaradas que se verifican por el test (`s !== p`):
  - `action` de 100 emojis: el esquema acepta (100 puntos de código); el parser rechaza (200 unidades UTF-16).
  - `deliveryId` de 128 emojis: el esquema acepta; el parser rechaza.
  - `createdAt` con segundo `60`: el esquema acepta; el parser rechaza (`Date.parse` devuelve NaN, comprobado con node).

## Discrepancias Integration ↔ Core

Las ya listadas en el análisis (D-A `action` sin tope en Integration; D-D `title`/`ref`/`sha` vacíos aceptados por Core y rechazados por Integration; D-H respuesta) siguen vigentes. No se verificó en el repo de Integration, y no se leyó su código en esta ronda: solo se usó el análisis SDD. Las dos divergencias de longitud UTF-16 y la del segundo 60 son solo entre esquema y parser de Core. Integration no ha sido comprobada contra ellas.

## Bloqueos

Ninguno. Pendiente: que el leader confirme la línea base de 2646 (ver nota arriba).

## Archivos afectados (lista completa)

Modificados: `CHANGELOG.md`, `app/src/contracts/generated/contract-schemas.ts`, `app/src/contracts/generated/contract-types.ts`, `spec/README.md`, `spec/contracts/github-integration-contract.md`, `spec/contracts/interoperability-contract.md`, `spec/contracts/schemas/examples/manifest.json`, `spec/contracts/schemas/examples/sandbox-result.failed.json`, `spec/contracts/system-contract.md`.

Nuevos: `app/src/github-webhooks/dto/normalized-webhook-event.contract.spec.ts`, `harness/reports/wi-core-079-technical-checks.md`, `spec/contracts/schemas/github-webhook-event.schema.json`, y 15 ejemplos `spec/contracts/schemas/examples/github-webhook-event.*.json`.

## Recomendación

Revisión independiente (`reviewer` y `contract-reviewer`) antes del commit. Luego el leader commitea, recalcula los digests y publica el Contract Sync en tres eventos (A-5). Integration debe re-espejar y validar lo que emite contra el esquema (CT-01-A5, su mitad).

## Re-ejecución del leader (2026-10-24)

Desde `app/` con Node 22: `npm run lint` (exit 0), `npm run contracts:check` (limpio), `npm run build` (exit 0) y `npm test`: 158 archivos pasan y 7 omitidos; 2717 tests pasan y 104 omitidos (2661 previos + 56 de `normalized-webhook-event.contract.spec.ts`). La cifra 2646 del encargo era de un corte anterior a WI-CORE-077/078; no hay regresión. `node scripts/sdd-check.mjs` y los validadores del Harness en verde. `git status` solo muestra archivos del alcance; `app/src/github-webhooks/dto/normalized-webhook-event.ts`, DTOs, rutas y enums sin cambios.

## Re-ejecución final del leader tras las revisiones (2026-10-24)

Cambios posteriores a la aprobación, solo pruebas y texto: F-1 del reviewer (la prueba de inválidos itera los 8 `eventName` conocidos con `kind IGNORED`; verificado por mutación: quitar `team` del `not.enum` del esquema hace fallar la spec; restaurado y `contracts:check` limpio), CR-1 y CR-2 del contract-reviewer (redacción de las brechas en GH-INTEROP-1.9 y en la descripción del esquema; dos filas `fecha-normalizada` en la paridad) y regeneración de `generated/` por el cambio de descripción. Desde `app/`: `contracts:generate`, `contracts:check`, `lint` y `build` en verde; `npm test`: 158 archivos pasan y 7 omitidos; 2726 tests pasan y 104 omitidos (2661 previos + 65 de la spec de frontera). Validadores del Harness y `node scripts/sdd-check.mjs` en verde antes del commit.
