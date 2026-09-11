# Contrato canónico del sistema

**Versión del contrato:** SYSTEM-1.6
**Fecha de corte:** 2026-09-11
**Estado:** APROBADO salvo decisiones `PENDING` explícitas
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/system-contract.md`

Frontend y Sandbox conservan una copia espejo con la misma versión. Una copia local no puede redefinir este contrato; todo cambio coordinado se consolida primero en el propietario y actualiza los tres `CHANGELOG.md`.

## Componentes y llamadas permitidas

`tjc-fe-rag-developer-console -> tjc-be-rag-core-api -> tjc-be-test-execution-sandbox`

- Developer Console es el frontend/cliente web de referencia. Consume RAG Core para toda capacidad de dominio; la única excepción aprobada es Supabase Auth para establecer la identidad del navegador.
- RAG Core es el backend principal: ingesta, indexación, retrieval/contexto, generación, experimento, orquestación, artefactos y métricas.
- Test Execution Sandbox es el backend de ejecución aislada. Consume snapshots/artefactos autorizados, ejecuta Jest/Vitest y devuelve hechos objetivos.
- El frontend nunca llama directamente al Sandbox. El Sandbox no consulta pgvector, no llama al LLM y no conoce la estrategia experimental.

## Alcance técnico compartido

- Los proyectos analizados y ejecutados en V1 son exclusivamente TypeScript (`.ts`/`.tsx`) con Jest o Vitest.
- La tesis puede describir el dominio como ecosistema JavaScript/TypeScript; esto no habilita JavaScript puro (`.js`, `.jsx`, `.mjs`, `.cjs`) en V1.
- Todo proyecto ejecutable en el Sandbox V1 debe incluir `pnpm-lock.yaml`. El Sandbox instala con la versión de pnpm configurada y lockfile congelado; npm, Yarn y proyectos sin lockfile quedan fuera de alcance y deben producir `UNSUPPORTED_PACKAGE_MANAGER`.
- Cada run se vincula a una `ProjectVersion` inmutable para que generación y validación utilicen exactamente el mismo snapshot.
- La web es cliente de referencia; plugins IDE, integración GitHub y PR/CI-CD autónomo son evolución futura gobernada por `DEC-GH-001`; otros lenguajes también quedan fuera de V1.

## Persistencia y almacenamiento

- RAG Core usa PostgreSQL + pgvector en Supabase para datos de dominio, chunks, embeddings y la cola DB-backed de jobs.
- El proveedor de objetos aprobado es Supabase Storage mediante `@supabase/supabase-js`, exclusivamente desde RAG Core y detrás de su abstracción interna `ObjectStorageService`.
- Supabase Storage conserva snapshots y artefactos; PostgreSQL/pgvector no se sustituye por Storage.
- RAG Core conserva las keys internas de Storage, genera URLs firmadas temporales cuando el Sandbox necesita descargar una entrada y persiste el resultado final de la ejecución.
- El Sandbox no recibe por defecto `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` ni `DATABASE_PASSWORD`; tampoco importa `@supabase/supabase-js` ni consulta PostgreSQL/pgvector directamente.
- El navegador no recibe credenciales secretas de Supabase ni accede directamente a PostgreSQL o Storage. Para HU29 puede usar `@supabase/supabase-js` con la `SUPABASE_PUBLISHABLE_KEY` exclusivamente contra Supabase Auth; `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `DATABASE_PASSWORD`, buckets y signed URLs siguen prohibidos en el cliente.
- RAG Core persiste trazas de contexto vinculadas a la `ProjectVersion` inmutable. La traza conserva decisiones, referencias normalizadas, hashes y fragmentos acotados; el contenido circundante puede reconstruirse desde el snapshot congelado sin duplicar repositorios completos en PostgreSQL.

## Frontera de ejecución

- RAG Core identifica el objeto por su key interna, genera una URL firmada de vida corta y la entrega al Sandbox dentro de la solicitud autenticada de ejecución.
- La URL firmada es una capacidad efímera: no se persiste permanentemente, no se registra completa, no se devuelve al frontend y se descarta tras adquirir la entrada.
- El proceso host del Sandbox descarga y verifica las entradas, prepara el workspace, ejecuta compilación/pruebas en un container sin secretos, captura resultados estructurados y elimina el workspace.
- El Sandbox devuelve hechos, stdout/stderr acotados y métricas a RAG Core. RAG Core decide la validez de producto y persiste estados, resultados y evidencia.
- Si un diseño futuro exigiera acceso directo del Sandbox a una base de datos, requiere decisión humana y un rol mínimo dedicado; el usuario administrador `postgres` y las credenciales de RAG Core están prohibidos.

## Despliegue del Sandbox

- El destino operativo previsto es una máquina virtual Linux remota que ejecute el servicio Sandbox y Docker Engine; el proveedor concreto todavía no está seleccionado.
- La selección futura priorizará servicios con modalidad gratuita o costo cero suficiente para el desarrollo y la evaluación, sin asumir que una oferta gratuita cumple aislamiento, disponibilidad o capacidad.
- Hasta resolver el proveedor remoto, el entorno aprobado para desarrollo y prevalidación usa la MacBook del desarrollador encendida, con Docker Desktop activo. La VM Linux administrada por Docker Desktop aporta el motor que crea los containers efímeros de ejecución.
- Este entorno local depende de la disponibilidad física del equipo, energía, conectividad y Docker Desktop; no se considera alta disponibilidad, despliegue empresarial ni evidencia de que el proveedor remoto haya sido elegido.
- El método para exponer o enrutar el endpoint del Sandbox fuera de la MacBook, si llegara a necesitarse antes de la VM remota, no queda aprobado por esta decisión y debe preservar autenticación, cifrado y mínimo acceso.

## Autenticación e idempotencia entre componentes

- El navegador nunca conoce el secreto de servicio del Sandbox. Solo RAG Core puede invocar `/executions`.
- Toda llamada Core→Sandbox a `/executions` usa `Authorization: Bearer <service-token>` y HTTPS fuera del entorno local. Los endpoints `/health/live` y `/health/ready` permanecen públicos y no revelan configuración sensible.
- El token es un secreto opaco precompartido: no es JWT, no requiere proveedor de identidad y no contiene claims. Core y Sandbox reciben el mismo valor mediante `SANDBOX_SERVICE_TOKEN` en la configuración segura de cada host; nunca se versiona, persiste, registra ni inyecta al container que ejecuta código no confiable.
- En desarrollo con Docker Desktop, cada backend recibe el secreto mediante su `.env` local ignorado. En una VM remota, el mismo contrato usa variables/secretos inyectados por el gestor de secretos del proveedor que se elija; `DEC-INF-001` no necesita resolverse para implementar el contrato local.
- El frontend genera un UUID por acción lógica en `POST /test-runs`, `POST /experiments` y `POST /test-runs/{runId}/targets/{targetId}/retry`, lo envía como `Idempotency-Key` y conserva el mismo valor durante reintentos de transporte. Una nueva acción intencional usa una key nueva.
- RAG Core persiste la key con una huella canónica del request y crea de forma atómica el recurso y su job DB-backed. Misma key + mismo request devuelve la operación original; misma key + request distinto devuelve `409 IDEMPOTENCY_CONFLICT`.
- Cada subejecución Core→Sandbox usa un UUID v5 estable, distinto de la key raíz del frontend y derivado de la identidad durable del job y su unidad lógica. Ese UUID viaja tanto en `Idempotency-Key` como en `requestId` y se reutiliza en todos los reintentos de transporte/polling de la misma subejecución.
- `POST /projects/index` continúa exento para no imponer retroactivamente este contrato a la ingesta existente.

## Identidad y autorización del navegador

- HU29 adopta Supabase Auth con correo y contraseña para el flujo vigente por ZIP. Developer Console establece la sesión con la publishable key y envía el access token como `Authorization: Bearer <user-access-token>` a RAG Core; Core valida firma, issuer, audience y expiración con una librería mantenida y el mecanismo compatible con las signing keys configuradas (JWKS local/cacheable para claves asimétricas o validación contra Auth para legado simétrico), antes de autorizar una operación.
- `GET /health` y los endpoints públicos estrictamente necesarios para completar login/recuperación permanecen sin autenticación. Las operaciones de proyectos, versiones, inventario, runs, artefactos, experimentos y trazas requieren usuario autenticado.
- Cada `Project` pertenece a la identidad que lo crea. Toda lectura o mutación descendiente se autoriza a través de esa propiedad; una identidad distinta recibe `404` para no revelar la existencia del recurso. Compartición de proyectos, organizaciones y roles múltiples no forman parte de HU29.
- El modo de desarrollo puede omitir autenticación solo con configuración explícita no productiva y datos mock/locales. El modo `live` usado con código empresarial nunca acepta el bypass.
- Solicitar o recuperar una cuenta por correo no equivale a habilitar auto-registro público: la política de provisión/invitación pertenece al entorno controlado por la empresa.
- La autenticación de usuario es independiente del secreto Core→Sandbox de `DEC-AUTH-001`; ningún token de usuario llega al Sandbox ni al container.

## Experimento

- La comparación principal es `RAG` vs `GENERALIST_AGENT`.
- `GENERALIST_AGENT` explora el mismo snapshot mediante herramientas read-only controladas y decide qué referencias usar; no es un LLM aislado o sin contexto.
- RAG adquiere contexto mediante retrieval híbrido semántico + estructural y un `ContextBuilder` explícito.
- Ambos brazos comparten target, snapshot, familia/versión de LLM, parámetros comparables, Sandbox, runtime y reglas de validación. La tarea es equivalente, aunque las instrucciones de adquisición de contexto difieran.
- La evaluación principal es first-shot, con tres repeticiones por target/estrategia por defecto y autorreparación desactivada.
- El Sandbox es ciego: no recibe `RAG`, `GENERALIST_AGENT`, `BASELINE` ni conclusiones experimentales.
- Se registran métricas de resultado/tiempo/tokens/costo y trazas propias de adquisición: chunks para RAG y tool calls/archivos inspeccionados para el agente.
- No se adopta una ablación obligatoria semántico/estructural/híbrido ni una prohibición general de recuperar pruebas por supuesto leakage.

## Trazabilidad visual del contexto

- HU27 expone la traza RAG de cada target de una generación normal y de cada repetición RAG experimental. Incluye target, candidatos recuperados, señales semánticas/estructurales, score combinado, tokens, decisión `SELECTED|DISCARDED` y motivo de descarte. Un score explica el ranking configurado; no es una probabilidad ni una verdad científica.
- HU28 expone la trayectoria cronológica del `GENERALIST_AGENT`: tool calls, argumentos, resultados vacíos/errores y referencias observadas a archivos, símbolos y líneas. Se denomina “contexto observado por el agente” o “contenido entregado al agente”; nunca “contexto utilizado”.
- No se almacena ni expone chain-of-thought, razonamiento interno o una inferencia sobre qué información influyó en la respuesta.
- Ambas vistas comparten explorador y panel lateral, pero no semántica: RAG usa selección/descarte; agente usa pasos observables. Los reintentos conservan trazas históricas y la UI muestra el último intento por defecto.
- El detalle se vincula a la `ProjectVersion` inmutable, conserva hash SHA-256, rango, fragmento acotado y truncamiento, y entrega hasta tres líneas circundantes cuando están disponibles. El listado de archivos descubierto por `list_files` se resume y se pagina bajo demanda.

## Validación en empresa real

- La validación final usa el producto conectado en modo `live` en el área de desarrollo de una empresa real e independiente.
- Datos mock sirven solo para desarrollo/demostración y nunca pueden exportarse o contabilizarse como evidencia experimental o empresarial.
- Código, rutas, logs, diffs y artefactos se tratan como datos no confiables y potencialmente confidenciales.
- HU29 resuelve el mecanismo de autenticación y aislamiento básico de proyectos. Antes de desplegar o ingerir un repositorio empresarial todavía debe completarse `DEC-VAL-001` para propiedad de cuentas/entorno, autorización organizacional efectiva, tratamiento frente a proveedores externos, retención/eliminación y evidencia exportable.

## Disponibilidad al corte SYSTEM-1.6

- RAG Core implementa las rutas HTTP y WebSocket contractuales hasta HU25; el Developer Console todavía debe completar adapters y vistas contra `INTEROP-1.6`.
- El Sandbox implementa por separado `/executions`, autenticación Bearer, deduplicación, descarga/materialización y ejecución aislada de proyectos pnpm con Jest/Vitest.
- RAG Core ya envía `Authorization: Bearer <SANDBOX_SERVICE_TOKEN>` en todo request a `/executions` y falla al arrancar ante una configuración parcial de `SANDBOX_URL`/`SANDBOX_SERVICE_TOKEN` (`DEC-AUTH-001`). RAG Core ya deriva y reutiliza las identidades hijas UUID v5 exactas de `DEC-IDEMP-001` para el fan-out hacia el Sandbox, en vez de keys aleatorias por intento.
- RAG Core ya persiste y aplica la idempotencia del cliente en `POST /test-runs`, `POST /experiments` y el POST de retry (`IdempotencyRecord`, transacción atómica recurso+registro+job, replay/conflicto/carrera probados contra la Supabase real).
- La integración Core↔Sandbox permanece pendiente de verificación real de extremo a extremo hasta que ambos servicios se desplieguen y se prueben juntos (esto no es una decisión abierta ni una tarea de código de Core, es la validación de integración entre repositorios).
- HU27-HU29 están aprobadas para Sprint 4 pero todavía no implementadas. La persistencia y los endpoints de trazas, el nuevo explorador, Supabase Auth y el aislamiento por propietario requieren trabajo coordinado en Core y Developer Console; el Sandbox no cambia.
- Las pantallas GitHub/PR de Google Stitch son únicamente una maqueta futura y no prueban OAuth, permisos, ramas ni Pull Requests implementados.

### DEC-INT-001 — Contrato de ejecución Core↔Sandbox

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** `INTEROP-1.6` define `POST /executions`, consulta de estado/resultado, `executionId`, `Idempotency-Key`, correlación, autenticación servicio-a-servicio, URLs firmadas temporales con integridad, estados, errores y evidencia acotada. RAG Core conserva Storage/PostgreSQL y persiste el resultado; el Sandbox no recibe credenciales Supabase/DB. Los límites concretos permanecen configuración del Sandbox y no son controlables por el request.

### DEC-AUTH-001 — Autenticación Core↔Sandbox

**Estado:** APROBADO

**Blocks:** NONE. La parte cliente en RAG Core ya está implementada (`SANDBOX_SERVICE_TOKEN`, header `Authorization: Bearer`, validación de configuración parcial al arrancar); queda pendiente solo la verificación de integración real con el Sandbox desplegado.

**Resolución:** usar `Authorization: Bearer` con un secreto opaco precompartido de alta entropía (mínimo recomendado: 32 bytes aleatorios), suministrado a ambos backends como `SANDBOX_SERVICE_TOKEN`. El Sandbox rechaza `/executions` sin token válido; Core exige la variable cuando `SANDBOX_URL` está configurada y falla al arrancar ante una configuración parcial. Este canal Core↔Sandbox no usa JWT, Supabase Auth ni otro proveedor de identidad; la identidad de usuario de HU29 es una frontera independiente. La rotación se coordina cambiando el secreto en ambos servicios; nunca llega al frontend ni al container de ejecución.

### DEC-IDEMP-001 — Idempotencia de operaciones y subejecuciones

**Estado:** APROBADO

**Blocks:** NONE. Materializado en RAG Core: `IdempotencyRecord` (`spec/transversal/persistence/spec.md`), `IdempotencyService`, y las identidades hijas UUID v5 exactas para el fan-out hacia el Sandbox (`spec/transversal/async-jobs/spec.md`).

**Resolución:** el cliente genera una key UUID estable por acción lógica; Core la persiste junto con una huella canónica y responde con la operación original ante un replay equivalente. Para fan-out, Core deriva una key hija UUID v5 con el namespace estándar URL `6ba7b811-9dad-11d1-80b4-00c04fd430c8` y uno de estos nombres canónicos: `urn:tjc:sandbox-execution:v1:generation:{jobId}:{targetId}`, `urn:tjc:sandbox-execution:v1:experiment:{jobId}:{strategy}:{repetition}` o `urn:tjc:sandbox-execution:v1:manual-retry:{retryJobId}:{targetId}`. La key hija coincide con `requestId` del Sandbox y se conserva en cualquier retry. La creación del recurso, la reserva de idempotencia y el job deben ser atómicos o recuperables sin duplicar trabajo.

### DEC-WEB-AUTH-001 — Identidad del navegador para el flujo ZIP

**Estado:** APROBADO

**Blocks:** NONE; habilita HU29.

**Resolución:** Supabase Auth con correo/contraseña establece la identidad del navegador. Developer Console usa únicamente la publishable key para Auth y envía el access token a RAG Core; Core valida el JWT y autoriza cada recurso por el propietario del `Project`. El bypass queda restringido a desarrollo no productivo con datos mock/locales. El token de usuario no sustituye ni se propaga como `SANDBOX_SERVICE_TOKEN`.

### DEC-GH-001 — Fuente GitHub, identidad separada y entrega por Pull Request

**Estado:** PENDING

**Blocks:** únicamente un work item futuro que conecte login GitHub, listado/importación de repositorios, sincronización, creación de ramas o Pull Requests con GitHub real; no bloquea HU25-HU29, el flujo ZIP ni una demostración mock claramente señalizada.

**Restricciones ya aprobadas:** la identidad GitHub será una vía de acceso separada y no se vinculará posteriormente a una cuenta creada por correo; solo podrá mostrar repositorios que la identidad pueda administrar o donde sea colaboradora; la selección de rama de partida usará `develop` por defecto y permitirá otra rama; una entrega futura creará una rama trazable autogenerada y propondrá un PR hacia `develop` por defecto con destino seleccionable. Si este alcance se descarta, correo + ZIP siguen formando un producto completo. HU26 puede demostrar todo ese recorrido con estado mock local, repositorios ficticios y un PR simulado, siempre con indicador persistente `DEMO · GITHUB SIMULADO`, sin OAuth, tokens, requests a GitHub ni efectos externos; esa demo no resuelve esta decisión ni cuenta como evidencia empresarial.

**Pregunta:** antes de implementar, definir GitHub App frente a OAuth App, instalación/aprobación organizacional, scopes mínimos, política de repositorios privados, webhooks/sincronización, protección y colisiones de ramas, permisos de escritura, revocación, auditoría, manejo de forks y contrato HTTP definitivo. La maqueta Stitch no resuelve estas decisiones.

### DEC-INF-001 — Proveedor de la VM remota del Sandbox

**Estado:** PENDING

**Blocks:** únicamente el aprovisionamiento y despliegue del Sandbox en una VM remota compartida; no bloquea desarrollo, ejecución ni prevalidación en la MacBook con Docker Desktop, ni trabajo de Core o Frontend que use un endpoint configurable

**Pregunta:** antes del despliegue remoto, comparar y seleccionar un servicio preferentemente gratuito que permita ejecutar Docker Engine y satisfaga CPU, memoria, disco, arquitectura, disponibilidad, límites/cuotas, red privada o exposición HTTPS, autenticación, firewall, observabilidad y tratamiento de datos. Definir también qué ocurre si el nivel gratuito se suspende, duerme o deja de ser suficiente. El implementador no elige silenciosamente un proveedor.

**Checkpoint (2026-09-06):** se confirma humanamente que el entorno local (MacBook con Docker Desktop) sigue siendo suficiente para desarrollo/prevalidación durante Sprint 2, Sprint 3 y Sprint 4; la selección del proveedor remoto se revisita explícitamente después de cerrar Sprint 4, no antes. Si en el futuro se selecciona un proveedor de nivel gratuito y ese nivel se suspende, duerme o resulta insuficiente, se requiere una nueva decisión humana explícita antes de continuar — no hay fallback automático silencioso a otro proveedor. Esta nota no resuelve la decisión: `DEC-INF-001` permanece `PENDING`.

### DEC-MET-001 — Mutation score y StrykerJS

**Estado:** PENDING

**Blocks:** únicamente un work item futuro que pretenda implementar mutation testing o promover mutation score a métrica experimental en cualquiera de los tres componentes; no bloquea HU19 ni el cierre del núcleo de Sprint 2

**Pregunta:** inmediatamente después del núcleo de Sprint 2, investigar viabilidad homogénea en proyectos TypeScript con Jest/Vitest, alcance, costo/tiempo, configuración de StrykerJS, aislamiento en Sandbox, contrato de resultados y presentación en frontend. Presentar el análisis para aprobación antes de diseñar o implementar.

### DEC-VAL-001 — Condiciones técnicas de validación empresarial

**Estado:** PENDING

**Blocks:** únicamente despliegue e ingestión/ejecución de la validación en empresa; no bloquea desarrollo, demo ni prevalidación local

**Pregunta:** antes de usar repositorios empresariales, definir entorno y propiedad de cuentas, acceso, autorización, tratamiento de código privado frente a proveedores externos, retención/eliminación y evidencia exportable sin filtrar información confidencial.

**Checkpoint (2026-09-11):** `DEC-WEB-AUTH-001` resuelve el mecanismo técnico de login por correo y aislamiento básico por propietario para HU29. `DEC-VAL-001` permanece `PENDING` porque todavía debe existir confirmación organizacional efectiva y definirse tratamiento con proveedores, retención/eliminación y evidencia exportable; no se considera resuelta por una maqueta ni por estar la aplicación bajo control de la empresa.

## Decisiones compartidas referenciadas

- `DEC-CHUNK-001`, `DEC-EMB-001`, `DEC-RAG-001` y `DEC-EXP-002`: propiedad de RAG Core; solo bloquean sus alcances declarados.
- `DEC-AUTH-001`, `DEC-IDEMP-001`, `DEC-WEB-AUTH-001`, `DEC-GH-001`, `DEC-INF-001`, `DEC-MET-001` y `DEC-VAL-001` viven en este contrato porque una resolución exige sincronizar los tres componentes.
- `DEC-SBX-002` es propiedad local del Sandbox; su consecuencia compartida en V1 es que los proyectos ejecutables deben usar pnpm y aportar `pnpm-lock.yaml`.

## Regla de compatibilidad

Cada contrato local debe declarar la versión `SYSTEM-*` e `INTEROP-*` contra la que fue sincronizado. Una operación `PENDING` no se convierte en contrato por existir en un mock, un plan o un repositorio consumidor.
