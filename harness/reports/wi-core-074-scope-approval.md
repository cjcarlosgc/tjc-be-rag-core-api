# WI-CORE-074 (WI-D) — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** el usuario escribió en el chat de la sesión Core, el 2026-10-21, «Necesita que apruebes el alcance en el chat de Core y respondas su pregunta D1 a D4 … vamos con eso» y respondió directamente la pregunta de opciones D1–D4 (versión en lenguaje simple) eligiendo en las cuatro la opción recomendada. Esas respuestas, dadas por el usuario en el chat de Core, se registran como la aprobación del alcance de WI-D.

Aclaración previa de cross (solo contexto, no aprobación): el criterio del usuario era «no complicar: exigir el token en el handshake»; no se debilita la verificación Reader por suscripción que ya existe y las nuevas suscripciones siguen su mismo patrón.

## Decisiones aprobadas

- **D1 — Exigir sesión + Reader:** el handshake del socket rechaza la conexión sin sesión válida (hoy se acepta) y cada suscripción exige rol Reader sobre el Project del recurso, también para los eventos nuevos de AnalysisRun y experimento. No se debilita la verificación por suscripción vigente (`subscribe:project-version`).
- **D2 — Códigos de rechazo del handshake:** `AUTH_REQUIRED` (falta la sesión) e `INVALID_ACCESS_TOKEN` (sesión inválida), los que Console ya entiende; no se usan los genéricos de INTEROP-2.18 §4.1.
- **D3 — Cambio incompatible declarado:** rechazar el handshake sin sesión es el único cambio incompatible de INTEROP-2.18; el evento de Contract Sync a Console lo declara (no abrir el socket sin sesión; manejar `AUTH_REQUIRED`). Con sesión normal Console no se rompe; con `AUTH_BYPASS` y sin token sí. GitHub Integration y Sandbox no tienen impacto.
- **D4 — Avisos:** cambios de estado del AnalysisRun y del experimento (inicio, fin, fallo) más el progreso de repeticiones del experimento con límite de ritmo (throttle); la creación del Run no emite. El polling HTTP sigue siendo la base; cada aviso trae el mismo DTO que su GET (`analysis-run:update` = `AnalysisRunDetailResponse`; `experiment:update` = `ExperimentStatusResponse`); post-commit, best-effort, sin replay, salas por id sin broadcast global.

## Resto del alcance (informe SDD, configuración recomendada)

Suscripciones `subscribe:analysis-run`/`unsubscribe:analysis-run` y `subscribe:experiment`/`unsubscribe:experiment` con el `SubscribeAck` existente; puerto de publicación no-op en lugar de inyectar el gateway en los servicios; aviso único de CORS abierto (resuelve F5); `socket.io-client` como devDependency para un e2e real; INTEROP §6.6 (versión única INTEROP-2.18 junto con WI-C), ejemplos de los dos eventos en `spec/contracts/schemas/examples/`, limpieza de los comentarios obsoletos «HU21/HU22», ancla HU12; CHANGELOG; Contract Sync único (github-integration, console, sandbox) publicado por este WI; Anexo E sin cita forzada (ninguna fila C-0x describe tiempo real; C-08 solo como contexto de HU12).

**Adición del leader (documental, a confirmar por el usuario en la revisión):** registrar `DEC-RT-001` (autenticación y autorización del socket) como PROPOSED con `Blocks: NONE`, como se hizo con `DEC-ERR-001`.

Dos cortes de implementación: **corte 1** (Core: CORS, handshake, salas y mensajes, eventos, puerto de publicación, pruebas unitarias) y **corte 2** (INTEROP §6.6, ejemplos, e2e con `socket.io-client`, CHANGELOG, DEC-RT-001, limpieza HU21/HU22). Sin push, PR ni merge; sin tag.
