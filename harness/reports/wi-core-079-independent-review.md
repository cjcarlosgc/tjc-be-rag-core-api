# WI-CORE-079 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: APPROVED** (con una observación menor no bloqueante, F-1).

## Evidencia reejecutada (desde `app/` salvo indicación)

| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0, sin avisos |
| `npm run contracts:check` | exit 0 (sin deriva) |
| `npm run build` | exit 0 |
| `npm test` | 158 archivos passed, 7 skipped; **2717 tests passed, 104 skipped** |
| `node scripts/sdd-check.mjs` | SDD check OK |
| `node harness/validate-work-items.mjs` | passed (CORE, 86 WI) |
| `node harness/validate-harness.mjs` | passed |
| `node harness/validate-completions.mjs` | passed (83 WI completados) |

## Verificación por punto

1. **Alcance.** `git status`: solo archivos esperados (3 contratos, `spec/README.md`, `CHANGELOG.md`, manifest, `sandbox-result.failed.json`, esquema + 15 ejemplos, `generated/*`, spec de frontera, informes, `harness/state.json` y `work-items.json`). `normalized-webhook-event.ts`, DTOs, rutas y enums sin modificar. `grep` de `brick|doctrine|escola|tjc-piloto|oracleRef` en `spec/contracts`, `app/src/contracts` y la spec nueva: 0 coincidencias. `referencias/` y `AGENTS.md` sin cambios en el repo; la carpeta `Tesis/` no es repo, por lo que otros repos no pude comprobarlos con git (el implementer declara no haberlos tocado; no vi indicio contrario).
2. **Esquema vs parser** (`github-webhook-event.schema.json` frente a `normalized-webhook-event.ts`): claves exactas (`additionalProperties:false` + `required` completos en sobre y en cada `data`), `schemaVersion` const 1, `deliveryId` 1..255, `eventName` 1..100, `action` string|null ≤100, patrón de `GithubId` idéntico (`^[1-9][0-9]*$`), `installationId` nulo solo en PULL_REQUEST y REPOSITORY (obligatorio en INSTALLATION*), nulabilidad de account/owner/login/type/memberId/etc. idéntica, `pullRequestNumber` entero 1..MAX_SAFE, `title/ref/sha` sin `minLength` (A-1), `fullName` minLength 1, `createdAt` UTC con `Z` o null, `receivedAt` con offset. Los 9 sobres son `oneOf`; `eventName` const por variante; IGNORED con `not.enum` de los 8 nombres, igual que `KNOWN_EVENT_NAMES`. Ejemplos: 13 eventos + 2 respuestas, IDs sintéticos (`example-*`, `example-org/...`), manifest con 15 entradas correctas.
3. **Spec de frontera.** 56 tests: round-trip esquema+parser con igualdad profunda, 27 inválidos que exigen fallo en ambos y `INVALID_REQUEST`, paridad con divergencias declaradas, e HTTP 202. No es vacuosa: mutaciones aplicadas en una copia fuera del repo (scratchpad) — quitar el tope de `deliveryId` en el parser, `const` de `team`→`teams` en el esquema, `maxLength` de `action` 100→200, regex de id del parser permisivo, quitar el chequeo kind↔eventName del parser — hicieron fallar la spec cada vez. Las 2 brechas ejercitadas (UTF-16 en `action`/`deliveryId`; segundo intercalar 60) son reales y la prueba exige que realmente diverjan. La tercera brecha declarada (`title/ref/sha` vacíos) es real (parser acepta, Integration `requiredString` lo rechaza) y la spec la cubre como «ambos aceptan». La prueba valida contra la copia `generated/`, no el `.json` de `spec/`; la deriva la cubre `contracts:check`.
4. Ver tabla.
5. **Documentos.** E-01 (`interoperability-contract.md` §6.5) coincide con `ExperimentResultsResponse` de `app/src/experiments/dto/experiment.response.ts:120-128` (`targetId` presente; sin `analysisRunId`/`symbol`). `system-contract.md:287` neutral (sin identidad ni PR). Versiones coherentes: INTEROP-2.20 «Compatible con SYSTEM-2.15» (2026-10-24), SYSTEM-2.15, GH-INTEROP-1.9, `spec/README.md:5`. Las menciones restantes de 2.14/2.19/1.8 son historiales. CHANGELOG: entrada de WI-CORE-079 (línea 15) sobre la de WI-CORE-084, mismo formato que 076. `sandbox-result.failed.json`: solo cambia la línea de `code`.
6. **Afirmaciones del contrato** (GH-INTEROP-1.9, brechas, `action` ≤100, regla eventName↔kind, `accepted: true` constante): coherentes con el parser y con `github-webhooks.service.ts`; sin afirmaciones insostenibles halladas.

## Hallazgos

| ID | Gravedad | Ubicación | Detalle |
|---|---|---|---|
| F-1 | Baja (no bloqueante) | `app/src/github-webhooks/dto/normalized-webhook-event.contract.spec.ts`, bloque «inválidos» | Una mutación que quita `team` de `not.enum` de `GithubWebhookIgnoredEvent` sobrevive (56 passed): solo se prueba `IGNORED` con `eventName: "pull_request"`. Conviene iterar los 8 nombres conocidos con `data.kind: IGNORED` (deben fallar en esquema y parser). Puede hacerse al cierre o en un WI posterior; no cambia el contrato ni el veredicto. |

Sin otros hallazgos. No se modificó ningún archivo del repo salvo este informe (las mutaciones se hicieron en una copia temporal fuera del repo).

Nota del leader al cierre: F-1 se aplicó antes del commit (la prueba itera los 8 `eventName` conocidos con `kind IGNORED`; verificado por mutación: quitar `team` del `not.enum` hace fallar la spec). Cambio solo de pruebas, declarado como del leader; las pruebas pasan (63 en la spec en ese momento, luego 65 con las filas de fecha del contract-reviewer).
