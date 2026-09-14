# 011-context-traces — Tareas

- [ ] Migrar `ContextTrace` y almacenamiento paginable de archivos descubiertos, con índices y relación a `ProjectVersion`, target, run/repetición e intento.
- [ ] Instrumentar `ContextBuilder` para registrar ranking, señales, configuración, selección y motivo de descarte sin cambiar el prompt resultante.
- [ ] Persistir una traza RAG por target de generación y por repetición RAG experimental.
- [ ] Normalizar y persistir la trayectoria observable de cada repetición `GENERALIST_AGENT` con hashes, rangos y truncamiento.
- [ ] Implementar reconstrucción segura de hasta tres líneas circundantes desde el snapshot inmutable.
- [ ] Exponer los cuatro endpoints de `INTEROP-2.1` sección 6.7, con filtros, paginación y último intento por defecto.
- [ ] Agregar `targetIds` a `ArtifactResponse` y su mapeo real.
- [ ] Agregar `CONTEXT_TRACE_NOT_FOUND` y `CONTEXT_TRACE_NOT_FINISHED` al catálogo de errores.

## Calidad

- [ ] Agregar/actualizar pruebas unitarias, integración y e2e.
- [ ] Verificar autorización por propietario y aislamiento entre versiones.
- [ ] Verificar que snippets/argumentos/resultados no se registren en logs ordinarios.
- [ ] Ejecutar lint/test/build/SDD check.
- [ ] Registrar evidencia de revisión.
