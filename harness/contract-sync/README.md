# CONTRACT_SYNC

Protocolo persistente de necesidades/cambios contractuales entre `core`, `console`, `sandbox` y `github-integration`. Cada evento `CS-AAAAMMDD-NNN` vive como YAML en `outbox/` del emisor y se importa al `inbox/` del consumidor. No edita otro repositorio, no aprueba un requisito ni sustituye un handoff humano cuando la política lo exige.

```yaml
type: CONTRACT_SYNC
id: CS-20260924-001
source: core
targets: [console, github-integration]
scopePaths: [spec/contracts/interoperability-contract.md]
breaking: false
changed:
  - Contract section or approved need
requiredAction:
  - Review the affected consumer or service.
sourceRevision: 0123abc
status: C-PENDING
```

Estados: `C-PENDING → C-ACKNOWLEDGED → C-RESOLVED`; `C-REJECTED` explica incompatibilidad o rechazo. Los YAML históricos sin `C-` se leen por compatibilidad, pero todo evento nuevo se publica con prefijo.

```sh
node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-001 --record
node harness/contract-sync.mjs check --checkpoint implementation-delivery --work-item WI-CORE-001 --record
node harness/contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-001 --record
node harness/contract-sync.mjs check --checkpoint before-done --work-item WI-CORE-001 --record
node harness/contract-sync.mjs import --from /ruta/al/harness/contract-sync/outbox
node harness/contract-sync.mjs publish --id CS-20260924-001 --targets console,github-integration --scope-paths spec/contracts/interoperability-contract.md --breaking false --changed 'approved contract change' --required-action 'review compatibility' --source-revision 0123abc
```

`check` exige un WI registrado y activo; `--record` guarda el checkpoint en orden cuando no hay pendientes. `scopePaths` admite `*` o rutas compartidas `spec/contracts/...`; no admite lista vacía ni rutas de feature propias del emisor, que podrían ser invisibles al receptor. Los eventos históricos sin este campo son globales (`*`). El WI transversal 001 usa `syncScopePaths: ["*"]` para inspeccionar todo evento dirigido a su componente. Todo evento relevante no `C-RESOLVED` bloquea `interopSyncChecked` y `W-DONE`, excepto una clasificación local `contractSyncReview` exacta para ese WI; el checkpoint registra por separado sus `notRelevantSyncIds`. La clasificación requiere evento anterior a la línea base, SHA-256 del cuerpo normalizado sin `status`, motivo y reporte existente. No resuelve el evento ni permite ignorarlo en otros WIs. Una necesidad de Console para GitHub Integration puede enviarse a ambos dueños (`core,github-integration`) y origina WIs propios en los repositorios afectados; no permite crear unilateralmente un endpoint.

Un diferimiento excepcional solo se admite en un WI de tipo `HARNESS`: `deferredSyncIds` enumera eventos antiguos no resueltos y `deferredSyncReport` justifica cada ID. Para otros WIs, `contractSyncReview` puede marcar un evento antiguo sin alcance como `NOT_RELEVANT` con razón, digest del contenido y reporte existente; el checkpoint lo registra en `notRelevantSyncIds`. Esto permite separar una acción aún abierta de su aplicabilidad a un corte concreto. No modifica el status del YAML ni sustituye completar la acción en los WIs que sí la requieren. El digest normaliza únicamente la línea `status`, que puede cambiar sin alterar el contenido contractual. Los checkpoints grabados con la semántica anterior se invalidaron y repitieron con evidencia en `harness/reports/legacy-contract-sync-triage-3.0.md`.
