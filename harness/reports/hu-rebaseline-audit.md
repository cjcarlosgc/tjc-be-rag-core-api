# Auditoría de trazabilidad de HU históricas

Este reporte conserva la interpretación de IDs anteriores a la línea base de seis épicas/dieciocho HU. **No es fuente normativa ni renumera mecánicamente historias.** Las reglas vigentes se consolidan en `spec/`; la evidencia de implementación anterior permanece en Git, `CHANGELOG.md` y reportes.

| Alcance anterior | Tratamiento en la línea base actual |
| --- | --- |
| Carga ZIP, generación manual, retry, historial de `test-runs`, artefactos individuales/ZIP | Retirado como producto. El snapshot ZIP interno y la evidencia de Runs se conservan. WI-CORE-002 / WI-CONSOLE-002 retiran código y verifican datos antes de migrar. |
| Project, borrado lógico, workspaces, identidad GitHub, roles y autorización organizacional | Capacidades de apoyo a HU01/HU02; no son siete HU nuevas. Conservar reglas de seguridad y casos borde de `014-organizations-access`. |
| GitHub App, binding, webhook, PR/HEAD, lifecycle y Checks | HU02 y HU14; publicar pruebas por companion PR corresponde a HU16. La separación de GitHub es una tarea arquitectónica propia, no otra HU. |
| Índice, cambios, retrieval, pruebas existentes y trazas | HU03–HU06, HU12 y HU15 según el criterio observable. Trazas experimentales complementan HU17. |
| Functional Knowledge, Focus Mode, conflictos, Action Required | HU07–HU09; la UI de respuesta apoya HU08. No inferir aceptación live desde mocks. |
| Generación/validación y clasificación | HU10–HU13; la evidencia histórica de un flujo manual no acepta por sí sola las HU PR-driven. |
| Experimento RAG/GENERALIST_AGENT sobre AnalysisRun y captura del próximo PR | HU17/HU18. Se preservan trials, métricas y comparabilidad aprobadas; el contrato de captura sigue pendiente. |
| PHP/Laravel/PHPUnit y Sandbox remoto | Habilitadores de HU03/HU10/HU11; trabajo de Sandbox queda diferido mientras lo mantiene otro desarrollador. |
| Mutation testing | Idea declinada, no WI ni criterio de aceptación actual. |

**Pendientes de WI-CORE-001/WI-CONSOLE-001:** eliminar referencias a IDs anteriores en contratos y specs activas sin perder reglas; reconciliar estados de aceptación por criterio, no por número. Cualquier capacidad que no quepa honestamente en HU01–HU18 se devuelve a decisión de alcance.
