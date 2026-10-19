# WI-CORE-072 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Veredicto: **CHANGES_REQUESTED** (un hallazgo documental de gravedad media-baja; sin blockers de alcance, sin secretos, sin cambios de producto).

## Validadores (raíz, Node 22.23.3)
- `node scripts/sdd-check.mjs`: SDD check OK.
- `node harness/validate-work-items.mjs`: passed (CORE, 72 WI).
- `node harness/validate-harness.mjs`: passed.
- `node harness/validate-completions.mjs`: passed (68 WI cerrados).

## 1. Validadores modificados
- `scripts/sdd-check.mjs`: solo `sddVersion` 3.0 a 3.1 (mensaje genérico). Correcto.
- `harness/validate-harness.mjs`: `awayMode` ahora rechazado (`=== undefined`), `sddVersion === '3.1'`. Correcto. `scopedUserException` de WI-CORE-036 pierde las dos condiciones de `awayMode`. La lógica sigue válida para el snapshot histórico: el resto de condiciones (id, estados, `reviewCycleException` con cita literal, `authorizedBy`, `previousMaxReviewCycles`, 3 o excepción de 4 ciclos) se conserva, y esa excepción solo se evalúa sobre `activeWorkItem`; WI-CORE-036 está cerrado y `validate-completions.mjs` (que tiene su propia comprobación, línea 52) pasa. Efecto neto: la excepción queda ligeramente más permisiva (ya no exige `awayMode`) pero solo aplicable a un WI con id fijo ya cerrado. Sin riesgo (informativo).
- `harness/validate-work-items.mjs`: `lane ∈ {STANDARD, FAST}` opcional y FAST rechazado con `contractImpact` o `publishesContract`. Coincide con `harness/WORKFLOW.md` (sección Vía rápida).

## 2. state.json y state-schema.md
Comparación `git show 62938f3:harness/state.json` frente al actual (JSON parseado): claves eliminadas = solo `awayMode`; claves nuevas = ninguna; difieren solo `sddVersion` (3.0 a 3.1), `awayMode` (eliminado), `completedWorkItems` (66 a 68, los 66 previos idénticos byte a byte tras serializar) y `activeWorkItem` (WI-CORE-072). No hay pérdida de datos. En el commit 5fa5666 el único cambio en `state.json` es sddVersion y la eliminación de `awayMode` (10 líneas). `harness/state-schema.md` refleja el esquema real: `sddVersion` 3.1, sección «Revisión independiente» sustituye a «Modo fuera de casa» y declara que el validador rechaza `awayMode`.

## 3. Consistencia documental
Coherentes entre AGENTS.md, WORKFLOW.md (revisión independiente, vía rápida, reviewers bajo demanda, perfiles), roles (`reviewer.md`, `human-reviewer.md`), `agent-profiles.yaml`, `.claude/agents/reviewer.md`, cross como coordinador (AGENTS.md:29-30, delivery-workflow.md:62-65) y harness/README.md. Residuos de «awayMode»/«fuera de casa»: solo negaciones (`state-schema.md:79`, validador, README) e históricos (CHANGELOG, reportes, state.json de WI cerrados). «Modo Noche»: 0.

Hallazgos:
- **F1 (media-baja, regla contradictoria)** `spec/constitution/delivery-workflow.md:38`: «El usuario revisa por defecto; puede pedir explícitamente que un agente independiente lo haga.» Contradice SDD 3.1 (AGENTS.md:52, WORKFLOW.md:59, roles/reviewer.md): el `reviewer` es el revisor por defecto y el usuario revisa un WI cuando lo pide. El commit 5fa5666 editó ese archivo y dejó esta línea sin actualizar. Corregir a «El agente `reviewer` revisa por defecto; el usuario puede pedir revisar él mismo».
- **F2 (trivial)** `harness/WORKFLOW.md` (párrafo «Revisión independiente»): «**Revisión independiente.** por defecto…» con minúscula inicial tras el punto.
- **F3 (trivial)** `harness/README.md` (sección «Diferencias permitidas»): línea en blanco entre el primer elemento de la lista y los siguientes; además «mismo contenido en los cuatro; Console lo conserva sin punto y coma» se contradice en sí mismo (mismo contenido salvo formato). Reformular a «misma lógica; Console difiere solo en formato».
- Informativo: la fuente duplicada de «Revisión independiente» en AGENTS.md y WORKFLOW.md ya fue aceptada por el leader (G4).

## 4. Checklist de harness/README.md
Verificado con shasum contra los tres repositorios hermanos (`tjc-be-github-integration-api`, `tjc-be-test-execution-sandbox`, `tjc-fe-rag-developer-console`):
- Idénticos al de Core en los tres: `agent-assignment.mjs`, `contract-sync-id.mjs`, `contract-sync-lifecycle.mjs`, `roles/human-reviewer.md`, `.claude/settings.json`, los seis agentes (`sdd-analyst`, `implementer`, `implementer-high`, `contract-reviewer`, `reviewer`, `merge-reviewer`), `system-contract.md`, `interoperability-contract.md`, `app/scripts/generate-contract-types.mjs`.
- `spec/contracts/schemas/` con la receta del README (`find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`): hash agregado `c45e4513…` idéntico en los cuatro. La receta funciona.
- `github-integration-contract.md`: idéntico en GH y Console, ausente en Sandbox (coherente con el README).
- `app/src/contracts/contract-validator.ts`: Console difiere (`e5cb2fb5` frente a `7ca8e5b6`) y el README lo declara como diferencia permitida (solo formato). Coherente (ver F3 para la redacción).
- No verificado aquí: que los tipos de `app/src/contracts/generated/` salgan idénticos al regenerar (`pnpm contracts:check`); queda fuera de este WI.

## 5. Secretos y producto
`git show 5fa5666 9945342 --name-only -- app` devuelve vacío: ninguno de los dos commits toca `app/`. Búsqueda de patrones de secretos (claves, `BEGIN … KEY`, URLs de BD, IPs) en las líneas añadidas de ambos commits: sin coincidencias. `git diff 62938f3..HEAD --stat -- app/src` muestra 30 archivos cambiados (sandbox, validation, experiments, contratos, config), todos de commits posteriores y de otros WI (3e66b2a, 6714019 WI-CORE-069, af05c90/ae96def/116c324 WI-CORE-070); `git log -- app` confirma que el último commit que toca `app/` es 116c324. Ninguno es 5fa5666 ni 9945342.

## 6. Gates y evidencias de WI-CORE-072 en state.json
Estado `W-IN_REVIEW`, `reviewCycles: 0`, `maxReviewCycles: 2`. Gates: `sddVerified`, `implementationCompleted`, `technicalChecksPassed`, `interopSyncChecked`, `noBlockingDecisions` en G-PASSED con `gateEvidence` apuntando a reportes que existen (`wi-core-072-sdd-verification.md`, `-technical-checks.md`, `-scope-approval.md`, `-contract-sync-scope-review.md`); los tres checkpoints PULL (`start`, `implementation-delivery`, `before-review`) están registrados y consistentes con `contractSyncReview` (NOT_RELEVANT). `independentReviewPassed` y `retryLimitRespected` siguen en G-NOT_RUN (correcto hasta cerrar). Las verificaciones técnicas declaradas coinciden con la ejecución de este review. Los handoffs de `cross` y `sdd-analyst` son reales. Observación menor: los `checkedAt` del WI llevan fecha 2026-10-19 UTC, coherente con la zona horaria local (tarde del 18).

## Recomendación
Corregir F1 (y, de paso, F2 y F3) en un commit documental; no requiere nuevo Contract Sync ni cambios en state.json salvo el registro del handoff de este review. Tras la corrección, ciclo 2 (o verificación del leader de que F1 quedó resuelto) y cierre (`independentReviewPassed`, `retryLimitRespected`, `W-DONE`).

## Ciclo 2 de 2 — verificación de correcciones
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Veredicto final: **APPROVED**.

- F1 resuelto (`spec/constitution/delivery-workflow.md:38`, commit d343aaf): el agente `reviewer` revisa por defecto de forma independiente; el usuario puede revisar cualquier WI y aprueba alcance, arquitectura y contratos. Coherente con AGENTS.md, WORKFLOW.md y roles/reviewer.md.
- F2 resuelto: «Por defecto» con mayúscula en `harness/WORKFLOW.md`.
- F3 resuelto: `harness/README.md` dice «misma lógica en los cuatro; Console difiere solo en formato (sin punto y coma)»; sin línea en blanco dentro de la lista.
- Búsqueda de contradicciones del mismo tipo (`usuario revisa|reviewer por defecto|Human Reviewer|revisor independiente por defecto` en spec, harness/roles, harness/*.md, AGENTS.md, .claude, README.md): sin contradicciones vigentes. Coincidencias restantes: menciones históricas de «Human Reviewer» en `spec/features/013…/spec.md:115` y `011…/plan.md:37` (registro de aprobaciones pasadas), `.claude/README.md:5` (el Human Reviewer es el usuario, sin perfil de agente), `AGENTS.md:50` (perfiles por proveedor) y descripciones correctas del agente reviewer.
- Validadores: sdd-check OK; validate-work-items passed (72 WI); validate-harness passed; validate-completions passed (68).
- El commit d343aaf solo toca documentación y el propio reporte; sin cambios en `app/`.
