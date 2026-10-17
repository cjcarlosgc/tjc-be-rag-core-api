# WI-CORE-039 — Acuse de Contract Sync entrante

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

`CS-GH-20261011-002` se importó desde el outbox de GitHub Integration después de seleccionar WI-CORE-039 y quedó `C-ACKNOWLEDGED` en el inbox de Core. Core acepta atender la solicitud mediante su WI local: precisar en los contratos canónicos la evidencia que permite declarar `CREATE_REJECTED` y su replay terminal `422 GITHUB_CHECK_CREATE_REJECTED`, con `retryable: false`, sin otro POST ni cuerpo crudo de GitHub.

Este ACK compromete a Core a revisar y resolver la solicitud dentro de WI-CORE-039; no aprueba por sí mismo el cambio contractual, no sustituye revisión/alcance humano y no autoriza cambios en `app/`, repositorios consumidores, deploy, provisioning ni cutover.
