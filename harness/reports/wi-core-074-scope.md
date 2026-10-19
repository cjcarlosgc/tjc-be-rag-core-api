# WI-CORE-074 (WI-D) — tiempo real adaptado al modelo vigente (propuesta de alcance, en cola)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: W-PLANNED.** Pedido por la sesión cross por decisión del usuario (se hace antes del tag `arch-v1.0`). Depende de WI-CORE-073. Su verificación SDD y la aprobación de alcance se piden al usuario en el chat de Core.

## Qué se propone

- Ancla: HU12 (consultar evidencia: estado y logs del Run). HU21/HU22 del módulo realtime heredado no existen en las 18 HU vigentes y no se citan.
- Reglas: el polling HTTP sigue siendo la base y no cambia; los eventos usan los mismos DTO que los GET del AnalysisRun y del experimento; suscripción explícita por id (sin broadcast global).
- Core emite desde el ciclo de vida del AnalysisRun y del experimento a través de `RealtimeGateway` (hoy `emitProjectVersionUpdate` no tiene llamadores, el realtime está inerte en Core y en Console). INTEROP §6.6 pasa a definir esos eventos.
- CORS del socket y de HTTP con `CONSOLE_CORS_ORIGINS`: resuelve el aviso duplicado F5 de la revisión de WI-CORE-069.
- **Autenticación del socket (decisión del usuario, no se asume):** hoy el socket no tiene auth, al mismo nivel que HTTP. Opciones a presentar al usuario con el informe SDD: (1) mantener el nivel actual de HTTP y documentarlo; (2) exigir el mismo token que HTTP en el handshake; (3) suscripción por id con verificación de acceso del rol Reader mínimo al proyecto.
- Prueba e2e real con `socket.io-client` si es viable.

## Contract Sync

Ver `wi-core-073-scope.md`: propuesta de una sola versión INTEROP-2.18 y un solo juego de eventos CS (github-integration, console, sandbox) publicado por WI-D; Console tendrá su propio WI de conexión.
