# WI-CORE-039 — Revisión independiente

Modelo: reviewer · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `xhigh`

`executedBy`: configuredModel `gpt-6-luna`, servedModel `unknown`, effort `xhigh`.

## Veredicto

**status: APPROVED** para el diff contractual revisado. No encontré hallazgos que contradigan el alcance que aprobó el usuario.

## Findings

- La nueva versión `GH-INTEROP-1.6` exige HTTP 422 clasificado inequívocamente como rechazo sin creación **y** reconciliación completa/paginada de la identidad exacta con cero candidatos antes de persistir `CREATE_REJECTED`.
- Los casos de reconciliación quedan diferenciados: candidato único se adopta/actualiza; varios quedan ambiguos; búsqueda incompleta o no verificable conserva `CREATE_UNKNOWN`/`RECONCILIATION_REQUIRED`, devuelve el error temporal de coordinación y no reintenta el POST.
- El replay de la misma huella devuelve `422 GITHUB_CHECK_CREATE_REJECTED`, `retryable: false`, sin POST adicional ni body/mensaje crudo. Una huella corregida requiere reconciliación completa en cero y transición durable/serializada; la concurrencia no abre una reserva o POST paralelo.
- SYSTEM-2.7, el plan y el CHANGELOG reflejan el nuevo contrato sin afirmar que GitHub Integration ya lo implementó ni que exista despliegue/cutover. `INTEROP-2.8` no se alteró.

## Blockers para cerrar el WI

- La aceptación de publicación aún no está satisfecha: no encontré un nuevo evento en `harness/contract-sync/outbox/` cuyo `sourceWorkItem` sea `WI-CORE-039` y cuyo destinatario sea GitHub Integration. El estado activo mantiene `contractSyncPublished: G-NOT_RUN` y `publishedSyncIds: []`. Publicar ese evento, ejecutar su evidencia de Contract Sync y obtener la revisión contractual post-implementación antes de permitir `W-DONE`. Esto no invalida el diff contractual aprobado.

## Archivos y evidencia revisados

- Diff canónico: `spec/contracts/github-integration-contract.md`, `spec/contracts/system-contract.md`, `spec/features/016-github-integration/plan.md`, `spec/features/016-github-integration/tasks.md` y `CHANGELOG.md`.
- Criterios y autorización: `harness/work-items.json`, `harness/reports/wi-core-039-scope-approval.md` y `harness/contract-sync/inbox/CS-GH-20261011-002.yaml`.
- Ejecución y sincronización: `harness/reports/wi-core-039-implementation.md` y `harness/reports/wi-core-039-contract-sync-checkpoints.md`; constan `implementation-delivery` y `before-review` sin eventos relevantes pendientes.
- El `git diff --check` del alcance contractual revisado no reportó errores. No atribuí a WI-CORE-039 los cambios de producto ajenos presentes en el worktree.

## Recommended next step

Leader: publicar el Contract Sync aprobado dirigido a GitHub Integration, ejecutar revisión contractual post-implementación y mantener WI-CORE-039 abierto hasta pasar esos gates y el checkpoint `before-done`. Después presentar al usuario el diff y la evidencia para el veredicto final del WI.
