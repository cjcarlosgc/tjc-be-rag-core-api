# WI-CORE-039 — Revisión contractual post-implementación

Modelo: contract-reviewer · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `high`

## Veredicto

**APPROVED** para el contenido contractual canónico de `GH-INTEROP-1.6`. No encontré contradicciones internas en el alcance revisado ni discrepancias respecto de la aprobación humana registrada en `harness/reports/wi-core-039-scope-approval.md`.

## Revisión

- `spec/contracts/github-integration-contract.md` define el orden requerido: respuesta de creación HTTP 422 inequívoca, reconciliación paginada y exacta de repositorio/App/SHA/nombre y cero candidatos antes de persistir `CREATE_REJECTED`. Un candidato se adopta/actualiza, varios mantienen `AMBIGUOUS` y una búsqueda incompleta conserva `CREATE_UNKNOWN`/`RECONCILIATION_REQUIRED`, devuelve 503 reintentable y no repite el POST.
- El rechazo guarda la huella y clase neutral; la misma huella reproduce `422 GITHUB_CHECK_CREATE_REJECTED`, `retryable: false`, sin POST ni contenido crudo. El request corregido exige huella distinta, búsqueda completa en cero y transición/claim durable serializado; solicitudes concurrentes no abren otra reserva ni otro POST. No se promete exactly-once.
- La tabla de errores y la descripción de `POST /internal/v1/github/checks` coinciden con las reglas de estados y respuesta. La tolerancia Core a `204` permanece como transición previa y no se presenta como cambio de DTO.
- `SYSTEM-2.7` y el plan de feature apuntan a `GH-INTEROP-1.6`/`WI-CORE-039`; el `CHANGELOG.md` describe el mismo alcance y aclara que `INTEROP-2.8` y `app/` no cambian. No observé referencias de versión incompatibles.
- El evento entrante `CS-GH-20261011-002` figura `C-RESOLVED` en el inbox local, con `harness/reports/wi-core-039-implementation.md` como evidencia de resolución; el informe existe y describe el alcance atendido.

## Alcance de esta aprobación

Este veredicto aprueba la coherencia del contrato canónico revisado, no la implementación de GitHub Integration ni el cierre completo de WI-CORE-039. El criterio del WI que requiere publicar un Contract Sync nuevo, dirigido a `github-integration` y con `sourceWorkItem: WI-CORE-039`, sigue pendiente: no encontré tal evento en `harness/contract-sync/outbox/`, y `harness/state.json` aún muestra `coordination.publishedSyncIds: []` y el gate `contractSyncPublished` sin evidencia.

## Evidencia

- Revisados: `spec/contracts/github-integration-contract.md`, `spec/contracts/system-contract.md`, `spec/features/016-github-integration/plan.md`, `spec/features/016-github-integration/tasks.md`, `CHANGELOG.md`, `harness/work-items.json`, `harness/state.json`, `harness/contract-sync/inbox/CS-GH-20261011-002.yaml`, `harness/reports/wi-core-039-implementation.md` y `harness/reports/wi-core-039-scope-approval.md`.
- Verificado `CS-GH-20261011-002`: `C-RESOLVED`, `resolutionEvidence: harness/reports/wi-core-039-implementation.md`.
- No se editaron contratos, código ni repositorios externos durante esta revisión.

## Recommended next step

Publicar el Contract Sync canónico de WI-CORE-039 para GitHub Integration con los archivos de espejo y acciones explícitas; después verificar espejo/hash y resolución en el WI local del consumidor. Mantener WI-CORE-039 en revisión hasta satisfacer ese criterio y sus gates restantes.
