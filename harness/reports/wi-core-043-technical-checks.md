# WI-CORE-043 — Validaciones técnicas de documentación/Harness

Fecha: 2026-10-12
Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

El corte no modifica `app/`, dependencias, migraciones ni configuración de GCE; por ello no se ejecutan lint, suite de producto ni build.

- `node scripts/sdd-check.mjs` — PASS (`SDD check OK`).
- `node harness/validate-work-items.mjs` — PASS (`Work item validation passed (CORE, 43 WI)`).
- `node harness/validate-harness.mjs` — PASS (`Harness V3 validation passed`).
- `node harness/contract-sync.mjs check --checkpoint implementation-delivery --work-item WI-CORE-043 --record` — PASS; sin eventos relevantes pendientes. Se clasificaron dos eventos globales pre-baseline como `NOT_RELEVANT` solo para este WI y se resolvió el evento correctivo `CS-GH-20261011-003` con evidencia, sin alterar el evento original que corrige.
- `git diff --check` — PASS.

La consulta GCE intentada en esta ejecución no pudo ejecutarse: `gcloud` no está instalado/disponible en el shell de esta sesión. La lectura de GCE registrada en `wi-core-043-decision-resolution.md` corresponde a una inspección previa, no a una verificación en vivo de este turno.

Después de publicar `CS-CORE-20261012-001` y de importar únicamente ese evento en ambos consumidores, pasaron `node harness/validate-harness.mjs` en Console (Harness V3) y Sandbox (Harness V2), además de `git diff --check` en ambos worktrees. Sus estados locales siguen `C-PENDING` y `PENDING` respectivamente; no se confunden con resolución.

El Contract Sync está publicado y su gate consta como `G-PASSED`; la atención local de los consumidores y el gate de sincronización/interop para el cierre de WI-CORE-043 permanecen pendientes.

## Actualización final — 2026-10-12

La evidencia posterior de consumidores cambió el estado anterior: Console cerró `WI-CONSOLE-025` y su inbox registra `CS-CORE-20261012-001` como `C-RESOLVED`; Sandbox cerró `WI-SANDBOX-003` con `ACKNOWLEDGED` para el preflight, preservando SDD 2.1/SYSTEM-2.2. Ese ACK no se interpreta como aprobación de su `DEC-INF-001` local ni como despliegue; la aceptación de Core pide el WI local/preflight, no una homologación ni una operación GCE.

Los checkpoints `before-review` y `before-done` pasaron en modo de inspección con `relevantPendingSyncIds: []`; el reporte final de WI registra sus ejecuciones persistidas. `gcloud` no está instalado en el entorno Core. La inspección efectiva de firewall descrita en el reporte final fue aportada por el usuario vía Cross, no se reejecutó desde esta sesión y no se intentó SSH.

Actualización posterior comunicada por el usuario vía Cross: IAP API habilitada y firewall efectivo IAP-only para la VM (prioridad 900 permite IAP TCP 22/3001; prioridad 901 deniega el resto de TCP/UDP/ICMP IPv4), sin cambios a reglas default ni IAM. El túnel IAP a 3001 falla al conectar con el backend; SSH por IAP espera aprobación 2FA y la etiqueta OCI/SHA continúa sin verificar. Core no tocó GCE ni intentó SSH.
