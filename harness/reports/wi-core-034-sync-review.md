# WI-CORE-034 — Revisión de entrada y Contract Sync

> Nota histórica: este análisis corresponde al estado previo a resolver `CS-GH-20261010-001` y a clasificar los eventos fuera de alcance. La clasificación vigente y el cierre están en `wi-core-034-contract-sync-scope-review.md` y `wi-core-034-closure.md`; la conclusión de bloqueo de abajo quedó supersedida.

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

Fecha: 2026-10-11.

## Decisión y cambio canónico

El usuario aprobó `DEC-CHECK-001` en chat («Sì, conforme.»). GH-INTEROP-1.4 define identidad por repositorio GitHub, GitHub App, `headSha` y nombre exacto; persistencia durable del `checkId`; convergencia concurrente; y el error `GITHUB_CHECK_IDENTITY_AMBIGUOUS` cuando hay duplicados. El mecanismo de persistencia y exclusión mutua queda a GitHub Integration.

La especificación y referencias canónicas se registraron en los commits `46c7046` (contratos y feature), `da5840c` (Contract Sync a GitHub Integration) y `7b0b8d8` (Contract Sync de espejos para GitHub Integration y Console). No se modificó `app/`.

## Eventos observados

- `CS-CORE-20261010-001` y `CS-CORE-20261010-002`: GitHub Integration los importó y acusó en su inbox con evidencia `wi-gh-012-contract-sync-acknowledgement.md`. El acuse acepta hacerse cargo; no declara implementado `WI-GH-012`.
- `CS-CORE-20261010-003`: Console lo importó y acusó con evidencia `wi-console-020-contract-sync-acknowledgement.md`. El acuse acepta actualizar espejos; no declara que ya los haya sincronizado.
- `CS-GH-20261010-001`: solicitud original de GitHub Integration, atendida por la aclaración canónica de este WI; se acusa formalmente mediante Contract Sync local.
- `CS-CONSOLE-20261010-001`: sigue `C-PENDING` en el inbox de Core. Solicita actualizar el DTO de `POST /experiments` al contrato OE5 V3, un cambio funcional independiente de la identidad de Checks.

## Resultado de preparación

La revisión contractual de Check está aprobada por el usuario y el material de salida está publicado. Sin embargo, `harness/contract-sync.mjs` considera relevante para un WI contractual cualquier evento `C-PENDING` dirigido a Core con `scopePaths` bajo `spec/contracts/`. Por eso `CS-CONSOLE-20261010-001` bloquea `start`/los checkpoints posteriores aunque su cambio solicitado pertenezca a §6.5 y este WI a Checks. No se clasifica como resuelto ni no pertinente bajo `WI-CORE-034`, y no se incorpora aquí la implementación OE5.

Para cerrar `WI-CORE-034`, Core necesita asignar y resolver la solicitud de Console en su propio WI, o aprobar y ejecutar un cambio acotado del Harness que permita discriminar subsecciones contractuales. Hasta entonces este WI queda priorizado, pero bloqueado por esa solicitud pendiente.
