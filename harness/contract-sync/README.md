# CONTRACT_SYNC

Protocolo persistente de necesidades/cambios contractuales entre `core`, `console`, `sandbox` y `github-integration`. Los eventos nuevos usan `CS-CORE-YYYYMMDD-NNN`, `CS-CONSOLE-YYYYMMDD-NNN`, `CS-SANDBOX-YYYYMMDD-NNN` o `CS-GH-YYYYMMDD-NNN` según emisor e incluyen `sourceWorkItem`. Los IDs simples `CS-YYYYMMDD-NNN` solo se aceptan como históricos anteriores al corte `2026-09-25`; se leen sin reescritura. El evento se importa al `inbox/` del consumidor. No edita otro repositorio, no aprueba un requisito ni sustituye un handoff humano cuando la política lo exige. Esta compatibilidad no implica que el Harness local de Sandbox se haya actualizado.

```yaml
type: CONTRACT_SYNC
id: CS-CORE-20260925-001
source: core
sourceWorkItem: WI-CORE-003
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

Estados: `C-PENDING → C-ACKNOWLEDGED → C-RESOLVED`; `C-REJECTED` explica incompatibilidad o rechazo. `C-ACKNOWLEDGED` significa que el consumidor revisó el cambio, acepta hacerse cargo y enlazó un WI; no afirma que ya implementó el cambio. `C-RESOLVED` significa que la acción del consumidor terminó con evidencia. Los YAML históricos sin `C-` se leen por compatibilidad, pero todo evento nuevo se publica con prefijo.

`import` y `check` validan que el namespace corresponda a `source` y que todo evento nuevo incluya un `sourceWorkItem` con el componente emisor. Al importarlo, el consumidor agrega `consumerImportedAt` al inbox local; esa marca no es parte del payload del productor ni de su digest. El import idempotente preserva la primera marca. Los snapshots cerrados solo consideran eventos conocidos por el inbox al `closedAt`; un evento importado después no los reescribe. Los IDs simples solo son válidos para eventos históricos anteriores al corte `2026-09-25`. La compatibilidad de Core/Console con `CS-SANDBOX-*` no actualiza el Harness local de Sandbox.

```sh
node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-001 --record
node harness/contract-sync.mjs check --checkpoint implementation-delivery --work-item WI-CORE-001 --record
node harness/contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-001 --record
node harness/contract-sync.mjs check --checkpoint before-done --work-item WI-CORE-001 --record
node harness/contract-sync.mjs import --from /ruta/al/harness/contract-sync/outbox
node harness/contract-sync.mjs acknowledge --id CS-GH-20260925-001 --work-item WI-CORE-003 --evidence harness/reports/external-dependency-verification-wi-core-003.json
node harness/contract-sync.mjs resolve --id CS-GH-20260925-001 --work-item WI-CORE-003 --evidence harness/reports/wi-core-003-implementation.md
node harness/contract-sync.mjs publish --id CS-CORE-20260925-001 --work-item WI-CORE-003 --targets console,github-integration --scope-paths spec/contracts/system-contract.md --breaking false --changed 'approved contract change' --required-action 'review compatibility' --source-revision 0123abc
```

`check` exige un WI registrado y activo; `--record` guarda el checkpoint en orden cuando no hay bloqueos. En `start`, `C-ACKNOWLEDGED` ya permite comenzar el WI; `C-PENDING`/`C-REJECTED` bloquean. En `implementation-delivery`, `before-review` y `before-done`, todo evento relevante debe estar `C-RESOLVED` para pasar el gate interop, salvo clasificación histórica `contractSyncReview` exacta. El checkpoint conserva por separado los IDs ACK, RESOLVED y `notRelevantSyncIds`.

`acknowledge` exige evento importado, WI local que cubre su scope y evidencia existente bajo `harness/reports/`; puede hacerse antes de seleccionar para habilitar el inicio. `resolve` exige el WI dueño activo en `W-IN_PROGRESS`, `implementationCompleted: G-PASSED`, al menos un reporte existente en `gateEvidence.implementationCompleted` y evidencia propia; no salta el ACK. Los eventos namespaced nuevos deben venir del productor en `C-PENDING` y sin campos de evidencia local; el estado del consumidor nunca se acepta como prueba del productor. La transición es monotónica: repetirla con la misma evidencia es idempotente y una evidencia distinta no reemplaza la anterior. Reimportar el mismo payload contractual conserva el status/evidencia local; cambiar cualquier otro campo con el mismo ID sigue siendo conflicto. La comparación ignora solo `status`, `acknowledgementEvidence` y `resolutionEvidence`; los campos source `sourceRevision` y hash normalizado del payload se cotejan con el SHA completo del HEAD revisado y se registran por separado. Una necesidad de Console para GitHub Integration puede enviarse a ambos dueños (`core,github-integration`) y origina WIs propios en los repositorios afectados; no permite crear unilateralmente un endpoint.

Un diferimiento excepcional solo se admite en un WI de tipo `HARNESS`: `deferredSyncIds` enumera eventos antiguos no resueltos y `deferredSyncReport` justifica cada ID. Para otros WIs, `contractSyncReview` puede marcar un evento antiguo sin alcance como `NOT_RELEVANT` con razón, digest del contenido y reporte existente; el checkpoint lo registra en `notRelevantSyncIds`. Esto permite separar una acción aún abierta de su aplicabilidad a un corte concreto. No modifica el status del YAML ni sustituye completar la acción en los WIs que sí la requieren. El digest normaliza únicamente la línea `status`, que puede cambiar sin alterar el contenido contractual. Los checkpoints grabados con la semántica anterior se invalidaron y repitieron con evidencia en `harness/reports/legacy-contract-sync-triage-3.0.md`.

## Canal de comunicación entre repositorios y agentes

El único canal declarado es Contract Sync (`outbox/` del productor → `inbox/` del consumidor): transporta obligaciones y estado (`C-PENDING → C-ACKNOWLEDGED → C-RESOLVED`). El consumidor importa con `import --from <ruta local al outbox del productor>` (los repositorios son carpetas hermanas del mismo workspace); no hace falta publicar en GitHub para que un evento exista o sea importable.

Git y GitHub **no** se usan como canal para leer las decisiones de otros repositorios (decisión del usuario, 2026-10-09: sus limitaciones pesan más que su utilidad: lo no publicado no se ve, depende de la rama y de credenciales, y duplicaría la fuente de verdad). Lo que otro repositorio necesite que Core sepa llega como evento importado o como handoff aprobado por el usuario.

Todo `sourceRevision` de un evento debe existir en el historial del productor: un commit local reescrito (amend, cherry-pick) antes de publicar invalida la referencia, por lo que no se reescriben commits ya citados por un evento.
