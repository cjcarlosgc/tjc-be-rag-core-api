# 012-web-authentication — Tareas

- [ ] Configurar verificación de Supabase Auth y guard global con excepciones públicas mínimas.
- [ ] Migrar `Project.ownerUserId` e índices; definir asignación explícita de datos live preexistentes.
- [ ] Aplicar scoping por propietario a proyectos y todos sus recursos descendientes.
- [ ] Proteger descargas y handshake/suscripciones WebSocket.
- [ ] Implementar `AUTH_REQUIRED` e `INVALID_ACCESS_TOKEN` sin filtrar tokens/claims.
- [ ] Implementar bypass únicamente local/mock y fallo de arranque si se habilita en producción.

## Calidad

- [ ] Agregar matriz de pruebas unitarias, integración y e2e de autorización.
- [ ] Verificar ausencia de secretos/tokens en logs y respuestas.
- [ ] Ejecutar lint/test/build/SDD check.
- [ ] Registrar evidencia de revisión.
