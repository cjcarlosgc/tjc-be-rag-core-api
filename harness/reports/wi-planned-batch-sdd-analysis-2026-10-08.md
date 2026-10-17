# Análisis SDD por lote de WI W-PLANNED (2026-10-08)
Modelo: sdd-analyst (consolidado por leader) · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low


Ejecutado por `sdd-analyst` en modo lectura. El Harness admite un solo WI activo (`validate-work-items.mjs`: "only one local work item may be active at a time"), y `W-BLOCKED`/`W-DECISION_REQUIRED` ocupan ese lugar. Por eso los WI no elegibles permanecen `W-PLANNED` en el registro y su motivo se conserva aquí, sin ocupar el WI activo.

| WI | Resultado | Motivo |
| --- | --- | --- |
| WI-CORE-004 | DECISION_REQUIRED | OC01–OC15 siguen `O-CATALOGUED`: no hay happy paths ni subcasos `OCxx.a` aprobados ni feature dueña definida. Es trabajo de especificación que requiere que el usuario apruebe el primer lote. No hay DEC bloqueante. |
| WI-CORE-005 | DECISION_REQUIRED | Faltan criterios cuantitativos (recall mínimo, parámetros HNSW, latencia), si es spike o aplicación, y significado de "reindexar" y "vía de recuperación". El inventario de datos y la versión de pgvector requieren la BD Supabase real (no accesible a un agente autónomo). Riesgo: post-filtering por `projectVersionId`. No hay DEC bloqueante. |
| WI-CORE-006 | ELIGIBLE | Contrato §6.7 ya aprobado; implementación presente; faltan pruebas de trazabilidad. Ver reportes `wi-core-006-*`. |
| WI-CORE-007 | DECISION_REQUIRED | Sin contrato de persistencia/lectura del diagnóstico (campos nuevos de `ExperimentRepetitionResponse`, forma en BD, resultados por target, redacción de secretos). Requiere un `DEC-` nuevo aprobado por el usuario; la propuesta mínima es persistir `stage`, `code` y `message` redactado y truncado, sin evidencia ni resultados por target. |
| WI-CORE-008 | ELIGIBLE (solo parte local) | La verificación local de roles/aislamiento es elegible, pero requiere que el usuario fije el bundle (A/B) del Contract Sync de implementación y acepte cerrar con las precondiciones externas (App con `Members: read`, organización real, Supabase sin email/contraseña) como PENDIENTE-EXTERNO. No pudo avanzar porque el WI-CORE-006 ocupa el único WI activo. |
| WI-CORE-013 | BLOCKED | `PHP_LARAVEL_PHPUNIT` aún no está implementado en Sandbox (INTEROP §"estado actual") y no hay evidencia de coordinación/ACK con el dueño de Sandbox, exigida antes de seleccionar. Sandbox no se modifica desde Core. Handoff sugerido (no enviado): Core necesita que Sandbox confirme el contrato `executionProfile=PHP_LARAVEL_PHPUNIT`/`runnerHint=PHPUNIT`, `phase` y evidencia ampliada de INTEROP-2.6 y su fecha de implementación, para seleccionar WI-CORE-013. |

Decisiones `PENDING` revisadas (`DEC-INF-001`, `DEC-VAL-001`, `DEC-EXP-FK-001`, `DEC-RAG-001`): su campo `Blocks` no alcanza ninguno de estos WI. `DEC-PHP-AST-001` está APROBADO.
