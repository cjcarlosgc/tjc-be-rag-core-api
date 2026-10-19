# WI-CORE-074 (WI-D) — Verificación SDD
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Estado: DECISION_REQUIRED (alcance sin aprobar). Solo lectura salvo este informe.

## 0. Correcciones al encargo (hallazgos que cambian el alcance)

1. El realtime NO esta inerte. Ya existe, con contrato INTEROP-2.4 §6.6 (HU62), un gateway funcional para `project-version` (`app/src/realtime/realtime.gateway.ts`): middleware de handshake (`afterInit`, l.~70) que autentica con `SessionAuthService` (mismo resolvedor que HTTP), `subscribe:project-version` protegido con `@RequireProjectRole('READER', ProjectTargets.body('projectVersion','projectVersionId'))` y `ProjectAccessService.requireForResource` (l.~100-140), mapa socket->Project y expulsion al perder acceso (`project-subscriptions.service.ts`: `revalidateProject`, `revalidateSocket`, `evictUser`). Solo `emitProjectVersionUpdate` (l.162) no tiene llamadores (solo specs). Console ya conecta: `tjc-fe-rag-developer-console/app/src/api/socket.ts` (`subscribeProjectVersionUpdates`, `renewSocketAuth`, `resetSocket`, token en `auth.token` por handshake, backoff para `retryable`).
2. Lo que falta es nuevo: eventos `analysis-run:*` y `experiment:*` (salas, subscribe/unsubscribe, emision desde el ciclo de vida). Los comentarios del gateway citan "HU21/HU22" (obsoletos): hay que limpiarlos.
3. El HUECO de seguridad que se pidio señalar YA ESTA CERRADO en el diseño vigente: el handshake solo autentica identidad y cada `subscribe:*` exige Reader sobre el Project del recurso. La decision "solo token en handshake" (opcion 2) leida literalmente (sin verificacion por suscripcion) abriria el hueco (un usuario autenticado se suscribe al id de un run de otro proyecto y recibe estado, `failureMessage`, etc.) y seria una regresion respecto de §6.6 actual. Reutilizar la verificacion Reader por suscripcion cuesta casi nada (mismo decorador, `projectAccess.requireForResource(userId,'analysisRun'|'experiment',id,'READER')`) y es lo que HTTP ya hace en los GET. RECOMENDACION: conservarla; es la opcion (3) descartada, pero ya implementada para project-version. Decision del usuario.
4. "Exigir token en el handshake" SI es un cambio de contrato: hoy un handshake sin token se acepta (§6.6, compat con clientes que "suscriben tras autenticar"). Rechazarlo es breaking para un cliente sin token. Console: `getSocket()` envia `{token}` si existe y `{}` si no (socket.ts, comentario "sin token el handshake se acepta"); con sesion normal siempre lo tiene; bajo AUTH_BYPASS de Core sin token en Console el socket seria rechazado (verificar en dev; Core acepta cualquier token bajo bypass, Console debe enviar alguno). Cambio exigido a Console: no abrir el socket sin token y tratar el nuevo error de falta de token como los demas de sesion.

## 1. Eventos propuestos (mismos DTO que los GET)

Cliente->servidor (namespace por defecto), todos con ack `SubscribeAck` (misma forma actual, 3 resultados; el codigo `GITHUB_VERIFICATION_UNAVAILABLE` conserva su significado):
- `subscribe:analysis-run` / `unsubscribe:analysis-run`, body `{ analysisRunId: Id }`.
- `subscribe:experiment` / `unsubscribe:experiment`, body `{ experimentId: Id }`.
Servidor->cliente:
- `analysis-run:update`, payload `AnalysisRunDetailResponse` = `GET /analysis-runs/{id}` (controller l.61-70: `toAnalysisRunDetailResponse(run, symbols)`; requiere releer `findByAnalysisRun`; `analysis-run.response.ts:68` es el resumen, el detalle extiende `AnalysisRunSummaryResponse`).
- `experiment:update`, payload `ExperimentStatusResponse` = `GET /experiments/{id}` (`experiments.service.ts:260-281`, hoy inline; extraer a un presentador para no duplicar el mapeo).
- Salas por id: `analysis-run:{id}`, `experiment:{id}` (patron `projectVersionRoom`). Sin broadcast global.
- Rol minimo: Reader del Project del recurso, igual que el GET (`ProjectTargets.body('analysisRun','analysisRunId')`, `('experiment','experimentId')`; verificar que existan esos targets en `access-policy.ts`, `default-deny.spec.ts` y `route-access-audit.ts` los auditan). Sin visibilidad o id inexistente: `{subscribed:false, code:null, retryable:false}` sin distinguirlos. Registrar en `ProjectSubscriptionsService` (generalizar `versions` a un mapa de salas por clave) para que la expulsion por perdida de acceso cubra las salas nuevas.
- Sin `trace` ni resultados por socket (el trace solo se pide por GET; los eventos son señal de cambio de estado = DTO de estado).

## 2. Puntos de emision (despues de commit, sin romper el flujo)

Principio: emitir desde un unico punto por agregado, fuera de la transaccion, en try/catch con log, y releer/armar el DTO igual que el GET (nunca campos fuera del DTO HTTP). Acoplamiento: inyectar `RealtimeGateway` (modulo `@Global`, ya exporta) o mejor un puerto `RunEventsPublisher` con implementacion no-op por defecto para no acoplar los servicios al transporte.
AnalysisRun (todo pasa por `AnalysisRunsService`):
- `transitionTo` `analysis-runs.service.ts:277-300` tras `transitionCurrent` exitoso (l.~292): cubre startProcessing (l.128), requestContinuation (l.192), ACTION_REQUIRED (l.206), completeRun (l.218), cierre/obsolescencia (l.120, 174, 228).
- `completeRunFromSystem` l.147-160 (tras `transitionCurrent`, l.156): handlers de snapshot (`snapshot-analysis-job.handler.ts:211,389,417,430`) y validacion (`analysis-run-validation-job.handler.ts:212,235,329,351`).
- `recordSnapshot` l.~138 (`update`, no es transicion pero cambia el DTO: `generatedTestsCount`, etc.) y `closeRun` rama sin transicion l.123 (`current:false`). Opcional: emitir solo si cambia algo visible en el DTO.
- Alta del Run: `startRunInternal` l.162 (primera vez `QUEUED`; nadie esta suscrito aun por id, emision opcional).
- Garantia de commit: `transitionCurrent` (repository l.115-137) ya devuelve tras `$transaction`; emitir en el servicio, nunca dentro del `tx`.
Experimento (`ExperimentRunsRepository`, llamado desde `experiment-job.handler.ts`):
- `markStarted` (handler l.197; repo l.189), `refreshCompletedRepetitions` (handler l.311, 438, 1420: progreso `completedRepetitions`), `complete` (handler l.271; repo l.~255-280), `markFailed` (handler l.281, 328; repo l.~325) y `closeInterruptedRepetition` (repo l.296). Creacion `experiments.service.ts:233-253` (PENDING).
- Emitir en el handler tras cada llamada exitosa (o en un wrapper), con throttling del progreso (puede haber rafagas de `refresh...`).
Garantias a especificar: emision best-effort (un fallo se registra y no altera el job ni la transaccion), at-most-once, sin replay ni orden garantizado entre transiciones: el cliente debe tratar el evento como "refresca/usa este estado" y el GET sigue siendo la fuente. Tras (re)conectar el cliente hace un GET.

## 3. Autenticacion del handshake

- Token ya definido y compartido: `Authorization: Bearer <access token>` o `auth.token` (`handshake-token.util.ts`); HTTP usa Bearer (`auth.guard.ts:extractHttpToken`), no cookie ni query. Sin cambio de mecanismo.
- Cambio propuesto: handshake sin token -> rechazo (middleware `next(err)` con `err.data = {code, message, retryable:false}`). Codigo: `AUTH_REQUIRED` (el que ya usa el guard para "falta token", `auth.guard.ts:34`); invalido/expirado: `INVALID_ACCESS_TOKEN`; sin identidad GitHub / Admin API caida: `GITHUB_IDENTITY_REQUIRED` / `IDENTITY_UNAVAILABLE` (retryable) ya existentes.
- OJO con el pedido de usar `UNAUTHORIZED`/`FORBIDDEN` de §4.1: esos son genericos solo para `HttpException` SIN codigo; un codigo explicito de la aplicacion prevalece (§4.1, 073). Los codigos de handshake ya son explicitos y Console los consume (`socket.ts`: `INVALID_ACCESS_TOKEN`, `GITHUB_IDENTITY_REQUIRED`). Cambiarlos a `UNAUTHORIZED` romperia a Console sin beneficio; `FORBIDDEN` no aplica (no hay rol en el handshake; el rechazo por rol es un ack no visible). Recomiendo `AUTH_REQUIRED`/`INVALID_ACCESS_TOKEN` y documentar que no se usan genericos. Decision del usuario.
- "Cierre del handshake": un rechazo de middleware envia `connect_error` y no abre la conexion (no hay close code WebSocket propio; el cliente recibe `connect_error` y no reintenta solo). Es lo que Console ya maneja.
- Compat Console: ver §0.4.

## 4. CORS

`main.ts:22` (`app.enableCors({origin: createConsoleCorsOrigin()})`) y `realtime.gateway.ts:48` (`@WebSocketGateway({cors:{origin:createConsoleCorsOrigin()}})`) YA comparten `CONSOLE_CORS_ORIGINS` por la misma fabrica (`common/cors.ts`). El aviso duplicado F5 existe porque cada llamada a la fabrica crea su propio `logger` y su propio flag `warned` (cors.ts l.22-28): dos instancias -> dos avisos. Correccion minima: mover `warned` a modulo (o exportar una unica instancia `consoleCorsOrigin`) + prueba en `cors.spec.ts` (dos fabricas, un solo `warn`). Sin cambio de contrato ni de comportamiento (abierto sin variable, como hoy). El gateway evalua el decorador al importar pero el delegado lee la variable por peticion: correcto.

## 5. Cambios de contrato y Contract Sync

- INTEROP §6.6 (publicado como INTEROP-2.18, sin nueva version; §4.1 de WI-C ya esta): reescribir el encabezado (anclar HU12, quitar menciones HU21/HU22 si las hay en esa seccion y en el repo), agregar los 4 mensajes cliente->servidor y los 2 eventos servidor->cliente, salas, ack, regla "sin datos fuera del DTO HTTP", politica de emision (best-effort, sin replay), polling base, y reemplazar la regla "handshake sin token se acepta" por "se rechaza con `AUTH_REQUIRED`". Es aditivo salvo ese rechazo, que es el unico cambio incompatible: marcarlo explicitamente.
- Esquemas/ejemplos en `spec/contracts/schemas/`: no existen esquemas para §6 (solo common, error-envelope, sandbox-execution y `examples/`). Propuesta minima: ejemplos `analysis-run-update.event.json` y `experiment-update.event.json` (reusando los ejemplos de los GET) y esquema opcional del `SubscribeAck`; no crear esquemas nuevos de los DTO. Actualizar el manifest que referencia 073 si lo requiere.
- Contract Sync (un solo juego, publicado por WI-D): console = conectar (suscribir al abrir detalle de Run/experimento, mantener polling como fallback, no abrir socket sin token, nuevas salas; su propio WI); github-integration = nada (no usa el socket ni los DTO; solo registrar "sin impacto" y la version 2.18); sandbox = nada (idem; ya usa los nombres de §4.1).
- Citas de la tesis: ancla HU12. (a) Anexo E (Tabla 52, l.2217-2226): ninguna fila C-0x describe tiempo real ni Console<->Core (son fronteras entre componentes internos). C-08 (Trace/Artifacts, "traza consultable", CT-08) respalda la consulta de estado/evidencia del Run, no su transporte push: se puede mencionar solo como contexto (estado consultable por HTTP), no como contrato de los eventos; recomiendo no forzar la cita y no declarar CT-08 para esto. (b) Anexo F (ADR-01..10, l.2238-2247): ninguno trata realtime, WebSocket, polling, CORS ni autenticacion; no hay ADR que citar (ADR-02 solo da identidad del Run, tangencial). (c) Anexo G/HITO-OE1 (l.2255-2291): exige CT-01..10, checklist de 9 enlaces, ADR, ESC-MOD-01 y arch-v1.0; no menciona realtime ni el error envelope. Por tanto WI-D no es requisito de HITO-OE1; es mejora previa al tag por decision del usuario.

## 6. Pruebas

Existentes: `realtime.gateway.spec.ts` (247 l.), `project-subscriptions.service.spec.ts` (160 l.), `cors.spec.ts`, `auth.guard.spec.ts`, `default-deny.spec.ts`, `analysis-runs.service.spec.ts`, `experiment-job.handler.spec.ts`; Console `socket.test.ts`. Nuevas: unitarias de gateway (subscribe/unsubscribe de los dos recursos, ack de 3 resultados, handshake sin token rechazado con `AUTH_REQUIRED`, token invalido), expulsion con salas nuevas, emision (payload = DTO del GET; fallo de emision no rompe `transitionTo` ni el job; no emite si la transicion no se aplico), `cors.spec` (un solo aviso), prueba de paridad DTO-GET vs evento, y regresion del lint de acceso por defecto.
E2E con socket.io-client: viable. `socket.io-client` NO esta en `app/package.json` (si `socket.io` ^4.8.3 y `@nestjs/platform-socket.io`) ni en node_modules: hay que agregar `socket.io-client` ^4.8.3 como devDependency (version ya usada en Console; actualizar el lockfile). Hay infraestructura e2e (`app/test/*.e2e-spec.ts`, `support/in-memory-prisma.ts`, `auth-test-support.ts` con identidad falsa): levantar la app en puerto efimero (`listen(0)`), conectar con `auth.token` de prueba, suscribirse, provocar una transicion con el servicio y esperar el evento. Limites: in-memory Prisma sin transacciones reales, sin GitHub real (fake), tiempos de espera acotados para evitar flakiness; no prueba Console real ni reconexion de red.

## 7. Decisiones PENDING/PROPOSED con Blocks

No se encontro ninguna decision PENDING/PROPOSED con `Blocks` que alcance este WI (busqueda en spec y harness/reports); `DEC-ERR-001` PROPOSED es `Blocks: NONE`. Se propone registrar `DEC-RT-001` (autenticacion y autorizacion del socket) como decision del usuario, `Blocks: NONE`, estado ACCEPTED al aprobar el alcance. Verificar tambien el registro de decisiones del repo (no localizado como archivo propio) antes de crearla.

## 8. Riesgos, opciones y recomendacion

Riesgos: (1) leer la opcion 2 como "sin verificacion por suscripcion" abre fuga entre proyectos; (2) rechazar handshake sin token rompe clientes sin credencial y Console bajo bypass; (3) emitir en el servicio acopla; mitigar con puerto no-op; (4) rafagas de progreso de experimento (throttling); (5) fallo del emisor tras commit deja al cliente desfasado: el polling lo cubre; (6) el DTO detalle del Run requiere una lectura extra por emision (coste/consistencia: leer tras commit); (7) texto de contrato y comentarios con HU21/HU22.
Decisiones que requieren al usuario (confirmar en el chat de Core):
 D1. Autenticacion: exigir token en handshake (opcion 2) Y conservar la verificacion Reader por suscripcion ya existente (recomendado) vs token-only (no recomendado, hueco).
 D2. Codigo de rechazo: `AUTH_REQUIRED`/`INVALID_ACCESS_TOKEN` (recomendado) vs `UNAUTHORIZED` generico.
 D3. Aceptar el cambio incompatible "handshake sin token se rechaza" dentro de INTEROP-2.18.
 D4. Emision de progreso de experimento (con throttle) y de alta de Run: si/no.
Corte de implementacion recomendado, dos cortes:
 Corte 1 (Core): cors warn unico; handshake exigiendo token; generalizacion de `ProjectSubscriptionsService`; gateway con los 4 mensajes y 2 eventos; puerto de publicacion y emision en `AnalysisRunsService` y `experiment-job.handler`; presentador de estado de experimento; pruebas unitarias.
 Corte 2: INTEROP §6.6/§0 + ejemplos + `socket.io-client` dev + e2e + CHANGELOG + Contract Sync (console/github-integration/sandbox) + limpieza HU21/HU22; revision del reviewer y del contract-reviewer.
