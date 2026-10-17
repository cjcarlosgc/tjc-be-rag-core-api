# Plan — Puertas de dependencias entre repositorios

1. Añadir a `WI-CORE-003` gate `G-NOT_RUN` para los WIs GitHub Integration 002–005, y dependencia local de `WI-CORE-009`.
2. Implementar un validador aislado del Harness que verifique dependencias declaradas, reporte de atestación, inventario completo de Contract Sync de cada WI origen, eventos importados, emisor/propietario, destino `core` y estado `C-ACKNOWLEDGED` o `C-RESOLVED`.
3. Bloquear estados `W-READY` o posteriores mientras el gate externo no esté `G-PASSED`; cuando se verifique, conservar evidencia en el activo y en el snapshot final.
4. Permitir que Contract Sync `start` registre cambios previamente `C-ACKNOWLEDGED`; mantener `implementation-delivery`, `before-review` y `before-done` bloqueados hasta `C-RESOLVED`. La operación `resolve` solo se habilita después de `implementationCompleted: G-PASSED`.
5. Añadir operaciones reproducibles de `acknowledge`/`resolve` e import idempotente que preserve el estado y evidencia de ciclo de vida local si el contenido de origen no cambió; los eventos namespaced del productor solo se importan como `C-PENDING` sin anotaciones del consumidor.
6. Bloquear también `W-READY` y las fases posteriores si un WI conserva dependencias locales incompletas, y cubrir este caso además del gate externo.
7. Cubrir gate no pasado, gate válido y fallos por reporte, WI, Contract Sync omitido/no importado, source, `sourceRevision` o status faltante/inconsistente, además de import pre-marcado, resolución prematura y evidencia sustituida.
8. Mantener el chequeo entre repositorios manual: inspeccionar registry, completion reports, commit de origen y todos los Contract Sync del productor; registrar la referencia en un reporte JSON versionado.
9. Registrar la primera importación local de cada evento y validar snapshots cerrados con ese corte temporal, preservando el digest contractual y el comportamiento conservador para inboxes históricos sin marca.

La fase solo cambia Harness/SDD Core. No inspecciona automáticamente GH, no mueve código y no toca Console ni Sandbox.
