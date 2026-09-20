# CONTRACT_SYNC

`CONTRACT_SYNC` es el protocolo persistente entre los tres harnesses. No depende de una sesión activa: cada evento se versiona como un archivo YAML en el `outbox` del repositorio emisor y los consumidores lo importan a su `inbox` local. Un evento no autoriza cambios funcionales ni edita repositorios de destino.

## Evento

```yaml
type: CONTRACT_SYNC
id: CS-20260919-001
source: core
targets: [sandbox, console]
breaking: false
changed:
  - INTEROP-2.2 §6.8 repository binding
requiredAction:
  - Review the affected adapter and acknowledge compatibility.
sourceRevision: 0123abc
status: PENDING
```

`source` es `core`, `sandbox` o `console`; `targets` contiene solo consumidores realmente afectados. `status` puede ser `PENDING`, `ACKNOWLEDGED`, `RESOLVED` o `REJECTED`. El emisor no cambia el estado de la copia importada por un consumidor.

## Comandos

```sh
# Validar el estado, roles, ejemplo y eventos locales.
node harness/validate-harness.mjs

# PULL: detectar syncs relevantes del inbox en cada checkpoint.
node harness/contract-sync.mjs check --checkpoint start --work-item T-002-analysis-run-domain

# Importar de forma explícita eventos persistentes desde un outbox recibido/clonado.
node harness/contract-sync.mjs import --from /ruta/al/harness/contract-sync/outbox

# Core publica solo después de aprobar un cambio contractual.
node harness/contract-sync.mjs publish \
  --id CS-20260919-001 --targets sandbox,console --breaking false \
  --changed 'INTEROP-2.2 §6.8' --required-action 'Review adapter compatibility.' \
  --source-revision 0123abc
```

Ejecutar `check` en `start`, `implementation-delivery`, `before-review` y `before-done`. El resultado se copia como evidencia a `activeWorkItem.coordination.pullCheckpoints`. Si la salida enumera eventos relevantes `PENDING`, el gate `interopSyncChecked` falla y no se puede cerrar el work item hasta revisarlos.

## Responsabilidad de Core

Core es el propietario canónico de `SYSTEM-*` e `INTEROP-*`. Cuando un cambio aprobado afecta a Console o Sandbox, publica un evento en `outbox/`, actualiza sus contratos canónicos y registra el ID en `publishedSyncIds`. No modifica automáticamente los otros repositorios. Para un trabajo sin impacto contractual, no se fabrica un evento.
