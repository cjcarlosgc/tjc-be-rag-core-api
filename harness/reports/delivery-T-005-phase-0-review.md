# Revisión de entrega — T-005 Fase 0 (PHP/Laravel)

**Revisor:** reviewer + contract-reviewer (independiente) · **Fecha:** 2026-09-26
**Rango:** `origin/develop..feature/T-005-php-phase-0` (HEAD `eea7ec4`)
**Veredicto:** `CHANGES_REQUESTED`

## Commits revisados

| Commit | Asunto | Refs | Conventional / Refs válidos |
|---|---|---|---|
| `bc9c42f` | `fix(sandbox): envía executionProfile en POST /executions` | HU43 | Sí / HU43 existe (perfil de ejecución solicitado por Core) |
| `3baa74a` | `docs(sdd): aprueba DEC-PHP-AST-001 e INTEROP-2.5 para soporte PHP/Laravel` | HU41, HU42 · `Decisions: DEC-PHP-AST-001` | Sí / existen |
| `eea7ec4` | `chore(harness): publica CS-20260926-001 (INTEROP-2.5) hacia Console y Sandbox` | HU41, HU42 | Sí / existen |

**HU incluidas:** HU41, HU42, HU43.

## Verificaciones ejecutadas

| Verificación | Resultado |
|---|---|
| `pnpm exec vitest run src/sandbox` (app/) | 3 archivos, 16/16 OK |
| `pnpm exec tsc -p tsconfig.build.json --noEmit` (app/) | OK (exit 0) |
| `pnpm exec oxlint src/sandbox` (app/) | OK (exit 0, sin avisos) |
| `node scripts/sdd-check.mjs` | `SDD check OK` |
| `node harness/validate-harness.mjs` | `Harness V2 validation passed.` |
| PULL `contract-sync.mjs check --checkpoint before-review --work-item T-005-php-laravel-support` | `relevantPendingSyncIds: []` |
| Parseo YAML de `CS-20260926-001.yaml` (Ruby Psych) | Parsea; ver hallazgo L2 |

## Revisión del alcance

- **Fix `executionProfile`:** correcto y mínimo. `EXECUTION_PROFILE_BY_RUNNER` es un `Record` exhaustivo sobre `runnerHint` (`JEST|VITEST` -> `NODE_TYPESCRIPT`), por lo que agregar `PHPUNIT` al tipo obligará a extenderlo (tsc falla si no). `ExecutionProfile` coincide con §7.2. El test verifica `executionProfile` y `runnerHint`. Que solo se mapee JEST/VITEST no es defecto hoy: Core aún no indexa PHP.
- **Delta contractual:** aditivo y coherente. `detectedFramework` admite `PHPUNIT` en los tres DTOs (§6.2 results, summary e inventario; `TestRunner` ya lo incluía). `ProjectVersionResponse.language` agregado. Encabezado `INTEROP-2.5` y fecha de corte actualizados; §1 describe 2.5 como aditiva y conserva 2.4 como anterior; §8 declara `PHP_LARAVEL_PHPUNIT` implementado en Sandbox. Coincide con `spec/features/015-php-laravel-support/spec.md` y con `spec/README.md` (INTEROP-2.5). `tech-stack.md` fija el parser según `DEC-PHP-AST-001` (APROBADO en la spec, evidencia en el reporte del spike).
- **CONTRACT_SYNC:** `targets: [sandbox, console]` correcto (Console consume los valores nuevos; Sandbox solo sincroniza mirror). `breaking: false`, `sourceRevision: 3baa74a` (commit que contiene el contrato), `status: PENDING`. Core no edita otros repositorios, conforme a `harness/contract-sync/README.md`; la divergencia temporal de mirrors es la esperada del protocolo y no es bloqueante (`sddVersion` sigue en 2.1; INTEROP versiona aparte).
- **state.json:** conforme a `harness/state-schema.md`: PRODUCT, `approved=true`, `IN_PROGRESS`, decision gate con `checkedAt` y cero bloqueantes, `contractImpact=true` con los gates contractuales distintos de `NOT_APPLICABLE`, `publishedSyncIds` con el evento.

## Hallazgos

### Bloqueantes (a corregir antes del push)

- **M1 (MEDIA) — Línea base no homologada.** `spec/README.md` declara `INTEROP-2.5`, pero `spec/backlog.md:3` ("línea base global vigente SDD 2.1 / SYSTEM-2.4 / INTEROP-2.4") y `spec/constitution/architecture.md:3` ("Contratos compartidos: SYSTEM-2.4 / INTEROP-2.4") siguen en 2.4. También `spec/contracts/system-contract.md:183` ("Mocks frontend deben implementar `INTEROP-2.4`"). Las referencias a secciones concretas (§6.7, §6.13) de features anteriores pueden quedarse como están. Corrección: actualizar esas tres declaraciones de versión vigente.
- **M2 (MEDIA) — Disponibilidad en Core no declarada.** Core todavía no emite `language` ni `PHPUNIT` (Fases 1-2). El contrato marca `language` como campo presente (`… | null`, "null hasta detectarlo") y el sync pide a Console aceptar los valores, pero ni §1, ni §8 ni `CS-20260926-001` dicen que en Core está **definido, pendiente de implementación**, que es la convención del propio contrato (p. ej., bullet 2026-09-15 de §1). Hoy una Console que confíe en el contrato recibirá `language` ausente (`undefined`), no `null`. Corrección: añadir el marcador de pendiente de implementación en Core (§1 o §8) y reflejarlo en `requiredAction` del sync (tolerar campo ausente hasta el sync de implementación ya previsto en tasks Fase 5). Es una aclaración de estado, no un cambio de forma, dentro del delta aprobado.

### No bloqueantes (recomendados)

- **L1 (BAJA) — Evidencia desactualizada en `harness/state.json`:** "fix executionProfile (5674785) aplicado sobre develop sin commit" ya no es cierto (commit `bc9c42f`). `contractReviewed` sigue `NOT_RUN` con `contractSyncPublished=PASSED`; se espera actualizarlo tras esta revisión.
- **L2 (BAJA) — `requiredAction` del outbox:** los ítems `- Console: …` y `- Sandbox: …` se parsean como mapas `{Console: "..."}` y no como strings (el ejemplo del README usa strings). El validador del harness lo acepta; conviene entrecomillar o reformular (`- "Console: …"`).
- **L3 (BAJA) — §8 de INTEROP, línea contigua obsoleta:** "La integración Core↔Sandbox actual continúa operativa bajo el subconjunto compatible de 1.6" contradice lo que el propio `CHANGELOG.md` de este rango reconoce (el Sandbox ya exige `executionProfile`; no había subconjunto compatible). Queda fuera del delta aprobado; se recomienda que el leader lo proponga en el próximo corte contractual.
- **L4 (INFO):** la lista de decisiones `APROBADO` de §8 no incluye `DEC-PHP-AST-001` (vive en la feature 015). Aceptable; opcional añadirla.

## Veredicto

`CHANGES_REQUESTED`: el código y las verificaciones técnicas están en verde y el delta es aditivo y coherente, pero M1 y M2 deben corregirse (cambios documentales pequeños) y el rango resultante debe volver a revisarse antes del push.
