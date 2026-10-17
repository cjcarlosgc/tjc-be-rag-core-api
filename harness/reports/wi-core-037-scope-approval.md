# Autorización de alcance — WI-CORE-037

El usuario aprobó iniciar el alcance el 2026-10-11: «Ok, apruebo para iniciar ese alcance.»

La autorización cubre el cambio Core definido en WI-CORE-037: transportar a Sandbox el `ProjectVersion.effectiveProjectRoot` congelado para ejecuciones PHP, mantener la compatibilidad legacy y la identidad `requestId` existente, conservar los paths de artefactos relativos al repositorio y añadir las pruebas de regresión previstas. No autoriza cambios en Sandbox, cambios adicionales de contrato, ni push/PR/merge o infraestructura externa.

La precaución de drenar o reconciliar ejecuciones antiguas ante un despliegue con payload distinto es operativa y queda fuera de este WI; no se presenta como prueba que deba ejecutar el implementer. La aprobación final de la implementación y el cierre permanecen pendientes de la revisión posterior del diff y su evidencia.
