# WI-CORE-039 — Revisión contractual previa

Modelo: contract-reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo high

`executedBy`: configuredModel `gpt-6-luna`, servedModel `unknown`, effort `high`

status: DECISION_REQUIRED

## Findings

- `CS-GH-20261011-002` está importado y `C-ACKNOWLEDGED`; su solicitud coincide con el objetivo local de WI-CORE-039. El ACK documenta compromiso de atenderla, pero explícitamente no aprueba el cambio semántico.
- `GH-INTEROP-1.5` ya establece reserva durable por identidad, hash de campos mutables, replay de `CREATE_REJECTED` sin POST, aceptación de un candidato único, `409 GITHUB_CHECK_IDENTITY_AMBIGUOUS` para varios, y conservación de `CREATE_UNKNOWN` cuando la evidencia no permite resolver. La ampliación puede ser aditiva y no necesita cambiar DTOs de `INTEROP-2.8` ni la arquitectura de `SYSTEM-2.7`.
- Falta el código `GITHUB_CHECK_CREATE_REJECTED` en la tabla de errores de GH-INTEROP. Debe definirse como respuesta privada a Core HTTP 422 con `retryable: false`, mensaje neutral y sin cuerpo/mensaje crudo de GitHub; precisar que es tanto el resultado inicial confirmado como el replay terminal de la misma huella.
- HTTP 422 por sí solo no debe convertirse en evidencia automática de que no hubo creación. “Inequívoca” debe significar una respuesta completa clasificada como rechazo de creación sin recurso, seguida por reconciliación completa/paginada de la identidad exacta (repo, App, SHA y nombre), sin errores, truncamiento ni páginas inaccesibles, con cero candidatos. No usar texto crudo del proveedor para el código ni exponerlo; documentar la clasificación interna permitida.
- Si la reconciliación completa encuentra un candidato único, se conserva la regla vigente de adopción/actualización por `checkId`, no se persiste `CREATE_REJECTED`. Si encuentra más de uno, permanece `409 GITHUB_CHECK_IDENTITY_AMBIGUOUS`. Si la búsqueda es incompleta/no verificable, el registro permanece `CREATE_UNKNOWN` (o `RECONCILIATION_REQUIRED` según la falla) y el retry no crea otro Check ni cambia la respuesta a rechazo definitivo.
- Replay con la misma huella de una fila `CREATE_REJECTED` devuelve el 422 terminal guardado y no envía otro POST ni revela body crudo. La política existente de hash cubre los campos mutables y se aplica dentro de la reserva de identidad; no debe confundirse un retry de transporte idéntico con un request corregido.
- Un request corregido solo puede reintentarse cuando su huella sea distinta, la fila durable siga en `CREATE_REJECTED`, una reconciliación completa confirme cero candidatos y la transición a `RESERVED`/claim sea atómica bajo la coordinación PostgreSQL existente. Si otro request corregido compite, el claim serializado debe hacer que el perdedor observe el estado nuevo y siga las reglas normales de `ACTIVE`/incierto; no debe abrir una segunda reserva ni un segundo POST concurrente.
- El outbox solicita “reconciliación completa con cero candidatos”, mientras el criterio local especifica HTTP 422 inequívoco antes de reconciliar. Conviene conservar ambos requisitos explícitamente: respuesta HTTP 422 confirmada como no-creación **y** reconciliación completa en cero; el HTTP status sin clasificación segura o sin búsqueda completa no basta.

## Blockers

- Aprobación humana explícita del alcance semántico antes de editar el contrato canónico. En `harness/state.json`, WI-CORE-039 sigue `W-SELECTED` con `approved: false`; el acuse del Contract Sync declara que no aprueba el cambio. La instrucción de que Core publique `GITHUB_CHECK_CREATE_REJECTED` autoriza claramente atender/publicar la solicitud, pero no consta como aprobación de todos los detalles de retry/reconciliación descritos en los criterios. Solicitar confirmación del criterio conjunto y de la política para request corregido/concurrente antes de cambiar esas reglas.

## Handoff

`findings`: no se halló conflicto con las garantías vigentes si se limita el rechazo terminal a evidencia inequívoca y búsqueda completa; están enumeradas arriba las reglas y bordes que la revisión recomienda dejar expresos.

`blockers`: aprobación humana semántica pendiente según el estado actual del Harness.

`filesAffected`: revisados `harness/contract-sync/inbox/CS-GH-20261011-002.yaml`, `spec/contracts/github-integration-contract.md`, `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`, `harness/work-items.json`, `harness/state.json`, `spec/features/016-github-integration/tasks.md`, `harness/reports/wi-core-039-contract-sync-acknowledgement.md`; creado únicamente este reporte.

`evidence`: inbox `CS-GH-20261011-002` está `C-ACKNOWLEDGED`; WI-CORE-039 está `W-SELECTED`/`approved:false`. `GH-INTEROP-1.5` §§ Coordinación durable de Check Runs y tabla de errores (líneas 66–78 y 155–171) ya establece los estados, hash, reconciliación y redacción; `INTEROP-2.8` §4 no define una política distinta para esta operación privada; `SYSTEM-2.7` § AnalysisRun, Job y Check conserva el ownership de Core.

`recommendedNextStep`: pedir al usuario confirmación explícita de la propuesta concreta anterior. Tras aprobarla, consolidar GH-INTEROP canónico (sin cambiar app/ ni `INTEROP-2.8`), registrar la revisión/versionado y CHANGELOG, resolver `CS-GH-20261011-002` con evidencia y publicar un Contract Sync nuevo a GitHub Integration para espejo byte-a-byte, validación y resolución local. Mantener deployment/provisioning/cutover fuera de alcance.
