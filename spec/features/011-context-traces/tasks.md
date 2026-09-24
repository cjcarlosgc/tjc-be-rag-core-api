# 011-context-traces — Tareas

- [x] Migrar `ContextTrace` y almacenamiento paginable de archivos descubiertos, con índices y relaciones a `ProjectVersion`, target, Experiments/repetición e intento.
- [x] Instrumentar `ContextBuilder` para registrar ranking, señales, configuración, selección y motivo de descarte sin cambiar el prompt resultante.
- [x] Persistir una traza RAG por cada repetición experimental RAG.
- [x] Normalizar y persistir la trayectoria observable de cada repetición `GENERALIST_AGENT` con hashes, rangos y truncamiento.
- [x] Implementar reconstrucción segura de hasta tres líneas circundantes desde el snapshot inmutable.
- [x] Exponer las tres rutas de `INTEROP-2.4` sección 6.7: listado por experimento, detalle y archivos descubiertos, con filtros, paginación y último intento por defecto.
- [x] Agregar `CONTEXT_TRACE_NOT_FOUND` y `CONTEXT_TRACE_NOT_FINISHED` al catálogo de errores.

## Calidad

- [x] Agregar y ejecutar pruebas unitarias/de repositorio para captura, persistencia, reconstrucción, paginación y errores.
- [ ] Ejecutar la matriz e2e de acceso para las tres rutas; el intento actual quedó bloqueado por `listen EPERM`.
- [ ] Verificar mediante e2e autorización por propietario/Reader y aislamiento entre versiones.
- [x] Verificar que snippets/argumentos/resultados no se registren en logs ordinarios; los logs de handler/agente solo emiten mensajes genéricos.
- [x] Ejecutar lint, build y `node harness/validate-harness.mjs`.
- [x] Ejecutar `node scripts/sdd-check.mjs`; se alineó el validador con `schemaVersion: 3` y `DECISION_REQUIRED`.
- [ ] Completar la suite: dos pruebas Supertest requieren listener fuera del sandbox y fallaron con `listen EPERM`.
- [x] Registrar revisión independiente APPROVED (ciclo 2) y revisión contractual APPROVED.

## Alcance SDD 2.1

La ruta vigente es exclusivamente sobre Experiments. Este corte de HU27 no cubre el run ni los artefactos de la generación manual descritos originalmente en el backlog; esas rutas quedaron retiradas. No se implementan rutas para `test-runs`, `TestGenerationRun` ni artefactos de generación manual. En estas respuestas `testRunId` será `null` y `artifactIds` será `[]`, conforme al DTO compartido.
