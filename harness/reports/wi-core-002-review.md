# Revisión independiente — WI-CORE-002

Fecha: 2026-09-25. Reviewer independiente: agente `core_review`. Veredicto: `APPROVED`.

## Alcance y evidencia

- Revisó el diff del WI, SDD y contratos canónicos, consumidores de códigos de error, extracción de ZIP interna, rutas y evidencia de pruebas.
- Los cinco códigos legacy retirados no mantienen consumidores. `INVALID_ZIP` y `INVALID_GENERATION_TARGET` conservan consumidores vigentes.
- No quedan rutas de carga manual ni descarga agrupada legacy en controllers. El snapshot ZIP interno hacia Docker/Sandbox, su validación de rutas y las lecturas de ProjectVersion/inventario se conservan.
- El diff no modifica esquema, migraciones ni registros de Runs, versiones o propuestas.
- El reporte de implementación registra lint/build aprobados y 1131 pruebas aprobadas (36 omitidas); el reviewer no volvió a ejecutar la suite. `git diff --check` pasó.

## Hallazgo de seguimiento, no bloqueante

SYSTEM-2.4 requiere historial append-only de transiciones de AnalysisRun, mientras INTEROP-2.4 lo marca pendiente. El servicio actual actualiza el estado del Run sin persistir ese historial. La brecha es anterior y no la introduce este diff; se recomienda un WI separado asociado a HU12 que alinee SYSTEM/INTEROP e implemente la persistencia. Se precisó el reporte de implementación para no afirmar lo contrario.

## Cierre

- Blockers: ninguno.
- Archivos de producto revisados: `app/src/common/errors/error-code.enum.ts`, además de usos vigentes de ZIP, ProjectVersion e inventario.
- Siguiente paso: cerrar WI-CORE-002; registrar la brecha de historial de Run como trabajo separado.
