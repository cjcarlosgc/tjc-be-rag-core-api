# WI-CORE-062 — propuesta INTEROP-2.16 (previa a editar)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

## Cambio documental aditivo
1. Cabecera: `INTEROP-2.16`, `Compatible con: SYSTEM-2.12`, fecha de corte 2026-10-14; §1: nota de versión antes de `INTEROP-2.15` («`INTEROP-2.16` es la versión documental vigente (`WI-CORE-062`, documental y aditiva): `StageDuration` (§7.3) agrega `startedAt?` y `completedAt?` opcionales; no cambia rutas, códigos, autenticación, idempotencia ni aislamiento»).
2. §7.3 `StageDuration`:
```ts
interface StageDuration {
  stage: SandboxStage
  durationMs: number
  startedAt?: IsoDateTime // INTEROP-2.16: inicio de la etapa (ISO-8601 UTC); ausente en Sandboxes anteriores
  completedAt?: IsoDateTime // INTEROP-2.16: fin de la etapa (ISO-8601 UTC); ausente en Sandboxes anteriores
}
```
3. Regla (junto a `stageDurations` del resultado): `startedAt`/`completedAt` son hechos de tiempo del Sandbox, opcionales por etapa y emitidos por `PREPARING`, `INSTALLING_DEPENDENCIES` y `RUNNING_TESTS` desde `WI-SANDBOX-007` (`CS-SANDBOX-20261014-001`, `sourceRevision` `19dfde45…`); `durationMs` no cambia y es la fuente de duración; los consumidores deben tolerar su ausencia e ignorar campos desconocidos (§1); Core los conserva en la evidencia interna del experimento sin exponerlos en DTO públicos ni en §6.16 (`WI-CORE-061`).
4. Contract Sync: `CS-CORE-20261014-001` (source core, `sourceWorkItem` `WI-CORE-062`, targets `[console]`; `scopePaths` INTEROP; `breaking: false`); Sandbox ya los emite: sin acción para el Sandbox salvo conocimiento; CHANGELOG y `spec/README.md`.

## Preguntas al reviewer
- ¿`IsoDateTime` ya está definido en §2 (sí) y es el tipo adecuado frente a `string`?
- ¿Console o github-integration necesitan acción (Console espeja INTEROP byte a byte)? ¿Sandbox debe ser target (informativo)?
- Coherencia con la transcripción: el evento transcrito queda `C-RESOLVED` al incorporarlo; ¿falta algo?
