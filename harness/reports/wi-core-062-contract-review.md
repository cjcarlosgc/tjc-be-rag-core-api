Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low
# WI-CORE-062 — revisión contractual (previa a editar INTEROP)

**status:** APPROVED (con ajustes de texto menores)

## 1. Transcripción y ciclo de vida
- sha256 del JSON original verificado: `eb0c8a25…ecf8e` coincide con `originalSha256`. `id`, `source`, `targets`, `breaking`, `sourceRevision`, `changed` (changedContractAreas), `requiredAction` (literal) y `originalCreatedAt` son literales; no hay campos fabricados.
- `sourceWorkItem: WI-SANDBOX-007`: aceptable. Es referencia literal del propio `requiredActions` y satisface `contractSyncIdIssue` (namespace SANDBOX + WI-SANDBOX). No exige extender el validador.
- `scopePaths: [spec/contracts/interoperability-contract.md]`: aceptable. Derivado del texto («INTEROP section 7.3») y declarado como derivación en `transcription`. Omitirlo lo haría global (`*`); el validador solo admite `*` o rutas de `spec/contracts/`, que esta cumple. No exige extensión del validador.
- Estado `C-ACKNOWLEDGED` ahora con `acknowledgementEvidence` es correcto; pasa a `C-RESOLVED` solo al incorporar INTEROP-2.16 (resolve con evidencia de la edición y el CHANGELOG), no antes.
- Sandbox commit 19dfde4: confirma `startedAt?`/`completedAt?: string` opcionales en `StageDuration`; coincide con el evento.

## 2. INTEROP-2.16 (documental, aditiva)
- §2 define `IsoDateTime` (ISO 8601 UTC): es el tipo correcto frente a `string` y consistente con los demás campos de tiempo. Al ser opcionales por ausencia, NO usar `| null` (regla §2: `null` solo para nullable declarado).
- Interfaz propuesta correcta. Ajuste: el comentario debe decir «(INTEROP-2.16) …» sin duplicar prosa larga; mantener `stage` y `durationMs` sin cambios (hoy §7.3, línea ~1446).
- Regla: texto propuesto correcto. Precisiones requeridas:
  1. Decir «emitidos por las etapas `PREPARING`, `INSTALLING_DEPENDENCIES` y `RUNNING_TESTS`» tal como en el commit, y que otras etapas pueden omitirlos.
  2. «Ausente = Sandbox anterior (o etapa que no lo emite); no es error ni dato desconocido».
  3. Core los conserva solo en evidencia interna (WI-CORE-061); sin DTO público ni §6.16 y sin cambiar `stageDurations` expuesto.
  4. No validar que `completedAt - startedAt` iguale `durationMs`; `durationMs` sigue siendo la fuente.
- Cabecera `INTEROP-2.16`, `Compatible con: SYSTEM-2.12`, fecha 2026-10-14; nota §1 antes de `INTEROP-2.15` y reubicar «vigente» a 2.16 / 2.15 «fue vigente» (el texto de 2.15 hoy dice «es la versión documental vigente»; cambiarlo a «fue»). Sin SYSTEM nuevo.

## 3. Versionado y Contract Sync
- Targets: `[console]` (espejo byte a byte obligatorio de INTEROP). Sandbox: no como target operativo; ya emite los campos y su original solo apunta a Core; incluirlo solo informativo es innecesario y ensucia su inbox. github-integration: no.
- `CS-CORE-20261014-001`, `source: core`, `sourceWorkItem: WI-CORE-062`, `scopePaths: [spec/contracts/interoperability-contract.md]`, `breaking: false`, `changed: [executions, evidence]` (alinear con el original), `requiredAction`: «Espejar INTEROP-2.16 byte a byte; StageDuration (§7.3) agrega startedAt?/completedAt? opcionales; tolerar ausencia; sin cambio de rutas, códigos ni DTO públicos; sin acción funcional.»
- Verificar que el ID no colisione con los de `harness/contract-sync/outbox/` (existe 20261008-001; usar siguiente libre del día).

## 4. Riesgos
- Bajo. Riesgo principal: el espejo de Console debe quedar idéntico (hash) antes de resolver; no marcar `C-RESOLVED` hasta tener la edición y el CHANGELOG.
- No afirmar que el Sandbox ya emite en producción: el original dice «once deployed»; redactar «desde `sourceRevision`, una vez desplegado».
- Sin impacto en `app/`; WI-CORE-061 coherente (persistencia interna).

## recommendedNextStep
Editar INTEROP con los ajustes anteriores, correr `contract-sync resolve` de CS-SANDBOX-20261014-001 con evidencia y emitir CS-CORE-20261014-001 hacia Console.
