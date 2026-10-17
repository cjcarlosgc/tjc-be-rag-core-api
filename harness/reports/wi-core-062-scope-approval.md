# WI-CORE-062 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (mensaje directo): (1) «transcribir CS-SANDBOX-20261014-001 en el inbox de Core conservando la ruta y el sha256 del JSON original del Sandbox, sin fabricar campos»; (2) «INTEROP-2.16 documental y aditiva para describir los startedAt/completedAt opcionales por etapa de §7.3, con contract-reviewer y Contract Sync a Console»; «sin cambios de código, push ni despliegue sin mi orden».

## Alcance
- Transcribir el evento del Sandbox al inbox de Core en el formato YAML que acepta `harness/contract-sync.mjs`, solo con los datos del JSON original (conservando su ruta y sha256) y declarando que es una transcripción.
- INTEROP-2.16 documental y aditiva: `StageDuration` (§7.3) con `startedAt?`/`completedAt?` opcionales (ISO UTC; ausentes en Sandboxes anteriores); sin cambiar tipos existentes ni código. Contract-reviewer ANTES de editar; evento Contract Sync producido por Core a Console (`breaking: false`).
- Sin cambios en `app/`, migraciones, push ni despliegue; `DEC-RAG-001` sigue `PENDING`; el ítem #4 no se toca.
