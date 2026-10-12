# 013 — Análisis PR-driven y contexto funcional

**Estado:** APROBADO
**Story IDs:** HU02–HU16 (las que citan las subtareas de esta feature y los casos OC01–OC15; el encabezado anterior listaba solo HU02, HU06–HU09 y HU13–HU16)
**Contrato:** SYSTEM-2.10 / INTEROP-2.10 / GH-INTEROP-1.7 (verificado en la cabecera de `spec/contracts`; el cuerpo de esta feature conserva sus reglas y no se reescribió en esta corrección)

## Objetivo

GitHub Integration entrega a RAG Core eventos normalizados de GitHub App para repositorios vinculados. Core crea un `AnalysisRun` por PR/HEAD y valida el `CHANGESET` con contexto semántico, estructural, funcional y de tests existentes. La Console puede completar contexto faltante; Core decide y solicita a GitHub Integration publicar resultados por Check. Los tests solo se publican después de revisión humana y freshness check.

## Invariantes

- GitHub OAuth autentica personas mediante Supabase Auth; el provider token efímero permite descubrir repositorios visibles y verificar identidad/acceso de un repositorio nuevo dentro de GitHub Integration. Core autoriza el binding y la GitHub App automatiza repositorios. Ninguna identidad implica autorización de la otra.
- Un Run representa un PR/HEAD. Attempts y continuaciones no crean Runs nuevos si el HEAD no cambia.
- `pull_request:synchronize`, incluido force-push, obsoleta el Run previo y crea uno para el HEAD nuevo.
- Solo `PR.base == Project.integrationBranch` activa análisis; la rama la elige el usuario entre las ramas reales autorizadas y no tiene default. No existe trigger global `push` ni workflow YAML obligatorio.
- `CHANGESET` define qué validar; `INDEX DELTA` define qué reindexar.
- Un repositorio (`repositoryId`) pertenece a lo sumo a un Project con binding. Vincularlo a un segundo Project es `409 REPOSITORY_ALREADY_BOUND`, nunca `500`, y no revela al Project ajeno.
- Desconectar es una pausa (`DISABLED`, reversible con `POST .../enable`); `REVOKED` nunca se degrada a `DISABLED` y solo sale de `REVOKED` por reactivación explícita del usuario cuando Core revalida que la App recuperó acceso. `installation.unsuspend` solo rehabilita lo que la suspensión deshabilitó, no lo pausado por el usuario.
- Eliminar un Project es lógico: libera el binding, cancela u obsoleta Runs y jobs en curso y oculta todo por API; el Run de un Project borrado, o cuyo `repositoryId` hoy pertenece a otro Project, no se procesa ni publica (Checks, publicaciones, validación, snapshot).
- Solo el Run vigente publica Check vigente. La merge policy pertenece al repositorio.
- `ACTION_REQUIRED` termina el job; una respuesta autorizada puede continuar el mismo Run/HEAD. La creación de la pregunta pendiente y la transición a `ACTION_REQUIRED` son atómicas y solo aplican a un Run `PROCESSING` y vigente.
- Si un HEAD nuevo o la baja del Project obsoleta el Run, sus preguntas `PENDING` pasan a `OBSOLETE`. El inbox solo incluye preguntas pendientes cuyo Run siga `ACTION_REQUIRED` y `current=true`; un job que pierda vigencia no publica Check ni convierte el Run en fallo técnico.
- `UNKNOWN`/No lo sé es una abstención auditada (`DEC-FK-002`): no crea ni modifica `FunctionalKnowledge`, la pregunta sigue `PENDING`, el Run sigue `ACTION_REQUIRED` y no hay continuación ni generación. Solo Maintainer o Admin pueden registrarla.
- Sandbox recibe profile, snapshot, artifacts y targets; nunca recibe GitHub, usuarios, prompts, reglas funcionales o estrategia experimental.
- No existe autorepair semántico, modificación automática de producción, escritura directa a la feature branch ni auto-merge.

## Corte implementado — exclusión de PRs anteriores al binding

Al conectar un repositorio, `RepositoryBinding.createdAt` delimita desde cuándo un PR es elegible para ese Project. GitHub Integration entrega en `pullRequest.createdAt` el instante de `pull_request.created_at`, validado y serializado en ISO-8601 UTC; el campo siempre está presente y vale `null` si falta o no puede verificarse. `receivedAt` conserva la hora de recepción y nunca sustituye la fecha de creación. Core compara la fecha verificable con `RepositoryBinding.createdAt`: fechas iguales o posteriores son elegibles; PRs anteriores no crean ni reinician Runs aunque luego reciban `synchronize` u otros eventos.

La falta o invalidez de `createdAt` no rechaza el webhook: Core no inicia ni reinicia un Run elegible, mantiene ocultos los Runs afectados y programa recuperación durable. La lectura histórica `pull-request-head` solo devuelve `OK` con una fecha original verificable; si falta o no es inequívoca, devuelve `UNVERIFIABLE` sin valor parcial. Core reintenta la clasificación durablemente y no usa `receivedAt` como sustituto.

Para un evento nuevo sin fecha verificable, la recuperación durable conserva únicamente el evento normalizado allowlisted necesario para retomarlo; no crea un Run provisional. Cuando GitHub Integration verifica la fecha, Core crea el Run solo si el PR es elegible, el binding sigue habilitado y el HEAD del evento aún coincide con el HEAD consultado. Una fecha anterior descarta el inicio. Los eventos de cierre, conversión a borrador o salida de la rama de integración actualizan el lifecycle aunque falte la fecha, sin iniciar análisis.

Los Runs históricos se conservan físicamente. Core clasifica como obsoletos y oculta de listas, detalles y bandejas los asociados a PRs anteriores al binding. No hay cambios de UI previstos ni cambios en Sandbox. El contrato y la fecha original quedaron implementados/cerrados localmente en `WI-GH-007`, `WI-CORE-014` y `WI-CORE-011`; `WI-CONSOLE-008` cerró la sincronización/validación del corte previo. La corrección narrativa se vuelve a distribuir por Contract Sync. Los cierres locales no implican despliegue ni cutover.

## Pipeline

```text
webhook verificado y normalizado por GitHub Integration
-> binding habilitado
-> normalización/idempotencia
-> AnalysisRun + PR_ANALYSIS job
-> snapshot por SHA
-> bootstrap o INDEX DELTA
-> PR CHANGESET
-> changed + impacted symbols
-> existing test baseline
-> technical + functional retrieval
-> enough context?
   -> no: ACTION_REQUIRED + Check + job finalizado
   -> yes: generate -> Sandbox -> classify -> Check
```

La transición a `ACTION_REQUIRED` y la inserción de su pregunta se confirman en una única operación condicionada al estado vigente del Run. Si el HEAD cambia durante la evaluación, la operación no crea una pregunta ni publica un Check obsoleto.

Una respuesta human persistente genera Functional Knowledge y un continuation job solo si el HEAD sigue vigente. Un HEAD nuevo obsoleta el Run y sus preguntas `PENDING`; una respuesta enviada después del cambio de HEAD se rechaza con `404 FUNCTIONAL_QUESTION_NOT_FOUND` y no se persiste (decisión del usuario, 2026-10-12, PQ-OC15); solo una respuesta ya persistida antes del cambio sobrevive como regla `ACTIVE`, que otros Runs reevalúan.

## Alineación SMART V3 (SDD 2026-10-08; implementación pendiente)

Fuentes: `SYSTEM-2.6` («Contexto RAG y Functional Knowledge») e `INTEROP-2.7` §6.11. Decisiones `DEC-FK-001` y `DEC-FK-002`, ambas `APROBADO`.

- **Activación exacta de `ACTION_REQUIRED`.** Se activa cuando, para un target afectado, la arquitectura necesita determinar un comportamiento esperado necesario para generar o validar una prueba unitaria y no puede establecerlo con conocimiento funcional autorizado, vigente y aplicable. No se activa porque cambió un método, no existe una regla, el código es complejo o tiene muchas dependencias. Preguntas válidas: resultado esperado, borde, excepción, transición de estado, efecto observable y precondición funcional (V1 genera solo las cuatro primeras categorías). No se pregunta por naming, refactor, calidad, performance, patrones, aprobación del PR, tooling ni configuración de PHPUnit. La elegibilidad es determinista y estructural (`DEC-FK-003`): el target es `METHOD`/`FUNCTION` `DIRECTLY_CHANGED`, no hay regla `ACTIVE` aplicable y el diff introduce o modifica una ramificación, un `throw` o una transición o escritura de estado, detectado comparando las huellas (`DEC-FK-004`) de la base y el HEAD; cada pregunta es atómica (un target, un escenario, una incertidumbre). Implementación: `WI-CORE-018`.
- **`UNKNOWN`.** Abstención auditada: no crea ni modifica Functional Knowledge, no resuelve la incertidumbre, no encola continuación ni generación; la pregunta permanece `PENDING`, el Run permanece `ACTION_REQUIRED` y Core registra quién, con qué rol y cuándo. **Contradicción spec-código registrada:** el código al 2026-10-08 responde la pregunta, reevalúa el Run y puede encolar la continuación (`functional-knowledge.service.ts`); `WI-CORE-018` lo corrige.
- **Roles.** Confirmar o responder exige Maintainer o Admin; Writer y Reader reciben `403 PROJECT_ROLE_INSUFFICIENT`. El rol Writer se introduce en `WI-CORE-019` (`014-organizations-access`).
- **Procedencia.** Toda regla conserva `confirmedByUserId`, `confirmedRole`, `originHeadSha` y, para `APPROVED_IMPORT`, `sourceRef`; `originHeadSha` es procedencia y no vencimiento (`WI-CORE-019`).
- **Escenarios.** Varias reglas `ACTIVE` por target con distinto `scenarioKey`, derivado por Core de `scenarioKind`, el `targetRef` y la huella de la construcción (`DEC-FK-004`); el conflicto de HU09 solo existe con el mismo scope, `targetRef` y `scenarioKey` (`WI-CORE-020`).
- **Contexto de generación.** `functionalRules` viaja separado del código y con procedencia (`WI-CORE-021`, feature `004-rag-retrieval-context`).

## Clasificación

- `SUCCESS`: baseline y propuesta generada se validan.
- `NO_ADDITIONAL_TESTS_REQUIRED`: uno o más targets `METHOD`/`FUNCTION` directamente cambiados se evaluaron y todos se omitieron porque sus tests existentes los cubren. Un conjunto vacío de targets no demuestra cobertura.
- `NO_TEST_RELEVANT_CHANGES`: no hay targets `METHOD`/`FUNCTION` directamente cambiados dentro del alcance de validación vigente.
- `ACTION_REQUIRED`: falta conocimiento funcional relevante.
- `BEHAVIORAL_MISMATCH`: test técnicamente válido evidencia diferencia expected/observed.
- `TECHNICAL_GENERATION_FAILURE`: la prueba propuesta es técnicamente inválida.
- `INFRASTRUCTURE_FAILURE`: plataforma/Sandbox/storage/worker impide validar. La precedencia y el tratamiento del fallo de plataforma de un solo símbolo con resultados mezclados están en `DEC-VAL-002` (APROBADA 2026-10-12, SYSTEM-2.10); hasta que el work item de código de OC08 se cierre una excepción del Sandbox por símbolo sigue siendo `TECHNICAL_GENERATION_FAILURE`.
- `BASELINE_FAILED`: tests existentes relevantes ya estaban rojos.
- `OBSOLETE`: otro HEAD o lifecycle del PR invalida vigencia.

## Publicación

En `SUCCESS`, Core expone propuestas para revisión. Al solicitar publicación:

1. autoriza por Project;
2. comprueba que PR y HEAD siguen vigentes;
3. marca `STALE` si cambiaron;
4. crea rama desde el HEAD validado;
5. abre companion PR hacia la feature branch;
6. nunca auto-mergea ni reabre un companion PR cerrado.

Propuestas de un mismatch quedan `HELD`. El companion PR no dispara el pipeline principal porque su base no es `integrationBranch`; al mergearse en la feature branch, el PR original recibe `synchronize` y se revalida.

## Casos operativos

OC01–OC15 se catalogan en `spec/operational-cases.md` con prioridad P2 de formalización. Los títulos no declaran automáticamente subcasos implementados: cada happy path, edge case y prueba se vinculará aquí o a la feature dueña mediante `WI-CORE-004`. Hasta entonces, el contrato vigente es el comportamiento explícito de esta spec y de INTEROP-2.6, no una promesa de cobertura total de los quince escenarios.

## Seguridad y auditoría

GitHub Integration verifica firma sobre body crudo, estado de instalación y mínimo privilegio; Core autentica el salto privado y valida el evento normalizado. En las rutas directas Console→Integration, el provider token OAuth se usa transitoriamente para discovery o verificación inicial; el callback a Core no lo incluye. La ruta Core heredada de discovery lo recibe y reenvía temporalmente a Integration; en ningún camino se persiste, registra o devuelve al navegador, ni se envía a Sandbox. En la ruta nueva de vinculación, Core valida evidencia firmada y de vida corta emitida tras autorización síncrona; no vuelve a llamar a Integration durante la escritura. Las rutas Core previas de discovery, verify-access, ramas y persistencia permanecen temporalmente por compatibilidad. El navegador nunca aporta instalación ni rol como autoridad. Persistir delivery, lifecycle, preguntas/respuestas, reglas creadas/superseded, generación, ejecución, clasificación, Check y publicación sin guardar secretos, tokens o URLs firmadas completas.

## Fuera de alcance inicial

- soporte completo de fork PR;
- RBAC propio: los roles Admin/Maintainer/Writer/Reader se derivan de GitHub y viven en `014-organizations-access` como capacidad de apoyo a HU01/HU02;
- proveedor remoto del Sandbox;
- despliegue o cutover de GitHub Integration; el código fuente y sus consumidores están migrados bajo `016-github-integration`, pero la operación externa requiere aprobación y secuencia coordinada. PHP completo sigue bajo desarrollo paralelo de Sandbox.

`DEC-INF-001` quedó `APROBADO` en SYSTEM-2.9 para reutilizar la VM existente del Sandbox bajo controles de red, aislamiento y retención definidos allí; no implica que el firewall ya esté corregido ni que el despliegue/E2E esté actualizado. `DEC-VAL-001` continúa `PENDING` para código/evidencia empresarial y no bloquea el piloto controlado. `DEC-EXP-FK-001` quedó `APROBADO` (2026-10-08).

## Casos operativos OC01–OC15 — happy paths (WI-CORE-004, PROPUESTA pendiente de revisión del usuario)

**Estado de esta sección:** propuesta del `sdd-analyst`; no está aprobada hasta el veredicto del usuario (Human Reviewer). Alcance aprobado en `harness/reports/wi-core-004-scope-approval.md`; análisis y hallazgos en `harness/reports/wi-core-004-sdd-analysis.md`. Ningún caso cambia de estado (`O-CATALOGUED`): `O-READY` exige subcasos `OCxx.a` aprobados por el usuario y `O-COVERED` exige evidencia, y aquí no se añade ninguno. Contratos de referencia verificados en cabecera: `SYSTEM-2.9`, `INTEROP-2.8`, `GH-INTEROP-1.7` (SYS = `system-contract.md`, INT = `interoperability-contract.md`, GH = `github-integration-contract.md`). La vista de UI vive en Console (`WI-CONSOLE-004`); Core es el canónico.

**Convenciones comunes (se citan una vez):**

- *Pipeline.* `webhook → binding ENABLED → AnalysisRun QUEUED + job snapshot → PROCESSING → snapshot/CHANGESET/símbolos → evaluador funcional → (ACTION_REQUIRED | job de validación) → estado terminal`. Fuente: `github-webhooks.service.ts` (`startRun`), `snapshot-analysis-job.handler.ts:170-385`, `analysis-run-validation-job.handler.ts:185-350`.
- *Check (GH-INTEROP-1.7 `POST /internal/v1/github/checks`, producido por `analysis-run-checks.service.ts:27-71`).* `name` = `GITHUB_CHECK_NAME` (por defecto `RAG Core Analysis`, `:9,:56`); `headSha` = HEAD del Run; `title` por estado (`check-conclusion.util.ts:30-43`); `summary` = `resultSummary` o el título (`:60`); `detailsUrl` = `{CONSOLE_BASE_URL}/projects/{projectId}/runs/{id}` solo si está configurada (`:83-91`). Se publica al terminar la transición, best-effort, solo si el Run sigue `current` y con el mismo estado (`:37-44`); un fallo de publicación no revierte el Run (`:67-70`). No hay Check para `QUEUED`, `PROCESSING` ni `OBSOLETE` (`check-conclusion.util.ts:25-26`). La identidad lógica (repositorio, App, `headSha`, `name`) hace que una continuación del mismo Run actualice el mismo Check (GH §Check).
- *Mapa estado → conclusión/título (`check-conclusion.util.ts:11-39`).* `SUCCESS` → `success` «Análisis exitoso»; `NO_ADDITIONAL_TESTS_REQUIRED` → `success` «Cobertura existente suficiente»; `NO_TEST_RELEVANT_CHANGES` → `success` «Sin cambios relevantes para pruebas»; `BEHAVIORAL_MISMATCH` → `failure` «Comportamiento inconsistente detectado»; `TECHNICAL_GENERATION_FAILURE` → `failure` «Falla técnica generando la prueba»; `BASELINE_FAILED` → `neutral` «Tests existentes ya estaban en rojo»; `INFRASTRUCTURE_FAILURE` → `neutral` «Fallo de infraestructura durante el análisis»; `ACTION_REQUIRED` → `action_required` «Falta contexto funcional». `cancelled` existe en GH-INTEROP pero Core no lo emite.
- *Cobertura.* Todas las pruebas citadas son unitarias con dobles (Vitest, `app/src/**/*.spec.ts`). No existe en Core una prueba de pipeline de extremo a extremo para ningún OC (`app/test/` solo contiene e2e de acceso, identidad, organizaciones, proyectos y workspaces). «Cobertura existente» significa que el comportamiento de la regla o transición está ejercitado por pruebas de componente, no que el caso completo esté probado.
- *Roles.* Responder una pregunta exige Maintainer o Admin; Writer y Reader reciben `403 PROJECT_ROLE_INSUFFICIENT` (SYS «Contexto RAG y Functional Knowledge»; `functional-knowledge.service.ts:143`).

**Decisiones del usuario (2026-10-12, directas en el chat de Core, `harness/reports/wi-core-004-user-decisions-2026-10-12.md`):** PQ-OC02, OC10, PQ-OC11, PQ-OC14, PQ-OC15 y OC08 quedan resueltas (ver cada caso); ya no hay `DECISION_REQUIRED` en esta sección. Las consolidaciones de contrato (código de error de OC15 en INTEROP, tabla y precedencia de OC08 en SYSTEM, semántica de `functionalBehaviorValidated`) se publican en un WI aparte con Contract Sync.

Resumen de estado: **FORMALIZADO** OC01–OC15; OC09 es especificación sin implementación en Core (baseline) y OC08 tiene una precisión de contrato pendiente (WI de contrato) antes de alinear el código.

### OC01 — Cambio sin tests y con contexto suficiente — FORMALIZADO

- **Entrada/precondiciones:** PR ready con `base == integrationBranch` y creado en o después de `RepositoryBinding.createdAt`; Run vigente para el HEAD; el CHANGESET toca archivos fuente; hay al menos un símbolo `DIRECTLY_CHANGED` `METHOD`/`FUNCTION` sin `TestTarget` existente (`hasTest=false`); el evaluador funcional no genera pregunta (no hay construcción nueva/modificada sin regla `ACTIVE` de su `scenarioKey`); framework de test detectado (Jest/Vitest; PHPUnit para PHP).
- **Salida observable:** Run `QUEUED → PROCESSING → SUCCESS` con `completedAt`, `generatedTestsCount` = propuestas `AVAILABLE`, `functionalBehaviorValidated=true` y `resultSummary` `SUCCESS: n propuesta(s) disponible(s), …`. `GET /analysis-runs/{id}/test-proposals` devuelve propuestas `AVAILABLE` con `relativePath`, `target` y `contentSha256`. Un símbolo del mismo Run con test existente se omite sin propuesta; un solo símbolo `AVAILABLE` basta para `SUCCESS` si no hay mismatch ni fallo técnico (`analysis-run-validation-job.handler.ts:576-590`).
- **Invariantes:** un Run por PR/HEAD; el Sandbox solo recibe snapshot, artifacts y targets (`:477-495`); un símbolo con test existente no se regenera (`:262-265`); sin autorreparación; Core decide el estado, Console no clasifica.
- **Estado final:** Run `SUCCESS`. Check `success` / «Análisis exitoso» / summary = `resultSummary` / sobre `headSha` del Run.
- **Cobertura existente:** `validation/analysis-run-validation-job.handler.spec.ts` → «completes SUCCESS and persists an AVAILABLE proposal when the sandbox run passes» (propuesta `AVAILABLE`, `SUCCESS`, `publishForRun` con `SUCCESS`); `checks/check-conclusion.util.spec.ts` → «maps SUCCESS to success»; `snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` → «enqueues the Validation job when the CHANGESET touches source but has enough functional context».
- **Prueba propuesta:** integración Core con repositorio y GitHub/Sandbox/LLM simulados en frontera HTTP: evento `opened` → Run `SUCCESS` → `GET test-proposals` con `AVAILABLE` → Check publicado con `success` y `headSha` del Run (hoy solo existen las piezas por separado).
- **Fuente:** SYS «Trigger PR-driven y lifecycle», «Baseline, generación y clasificación», «Publicación human-in-the-loop»; INT §6.10, §6.12; GH §Check; HU05, HU10, HU11, HU14.
- **Brecha implementación/especificación:** SYS exige ejecutar el baseline antes de generar; Core no ejecuta `phase=BASELINE` (ver OC09).

### OC02 — Cambio con tests ya aportados por developer o agente — FORMALIZADO (PQ-OC02 aprobada)

- **Entrada/precondiciones:** PR con un test (aportado por developer o agente) para un target cambiado; Core indexa el HEAD completo, de modo que el test del PR está en el snapshot y el resolvedor de tests marca `hasTest` cuando un archivo de test importa el símbolo y menciona `.método(` (`existing-test-resolver.service.ts:55-93`).
- **Decisión aprobada (PQ-OC02, 2026-10-12):** un test aportado en el mismo PR cuenta como test existente: el símbolo se omite sin ejecutarse (`analysis-run-validation-job.handler.ts:262-265`) y, si todos los candidatos están cubiertos, el Run termina `NO_ADDITIONAL_TESTS_REQUIRED`. Core no distingue un test del PR de uno preexistente. Esto cambia cuando exista el baseline de OC09 (el baseline ejecutaría esa suite sobre el snapshot del HEAD; decisión de diseño del WI de baseline).
- **Salida observable:** Run `NO_ADDITIONAL_TESTS_REQUIRED`, sin propuestas, con `functionalBehaviorValidated=true`. **Semántica aprobada:** `functionalBehaviorValidated=true` significa «el pipeline terminó sin hallar discrepancia», no «se ejecutó una validación»; se define en INTEROP-2.9 §6.11 (`WI-CORE-045`): `true` solo con `SUCCESS` o `NO_ADDITIONAL_TESTS_REQUIRED`, `false` en cualquier otro estado y mientras el Run no completó; no acredita que un baseline se haya ejecutado (OC09).
- **Estado final:** Run `NO_ADDITIONAL_TESTS_REQUIRED`. Check `success` / «Cobertura existente suficiente».
- **Fuente:** SYS «Baseline, generación y clasificación»; INT §6.10; HU04, HU10, HU14. `DEC-EXP-003` no aplica (agente generalista de experimentos).
- **Cobertura existente:** sin cobertura localizada para «test aportado por el PR»; la omisión por test existente se ejercita en OC03.

### OC03 — Tests existentes suficientes; no duplicar — FORMALIZADO

- **Entrada/precondiciones:** CHANGESET con fuente; ≥1 símbolo `DIRECTLY_CHANGED` `METHOD`/`FUNCTION`; todos esos símbolos tienen `TestTarget` con `hasTest=true` (un test importa el símbolo y, para métodos, referencia `.método(`); sin pregunta funcional pendiente. «Suficientes» está implementado como *existencia de un test asociado al target*; la suficiencia semántica o de cobertura no está definida ni ejecutada.
- **Salida observable:** Run `NO_ADDITIONAL_TESTS_REQUIRED` sin propuestas nuevas (`generatedTestsCount=0`), `functionalBehaviorValidated=true` y `resultSummary` `NO_ADDITIONAL_TESTS_REQUIRED: 0 propuesta(s) disponible(s), n símbolo(s) ya cubiertos por tests existentes, …`. No se invoca retrieval, LLM ni Sandbox para esos símbolos (`:262-265`).
- **Invariantes:** no se generan duplicados; un conjunto vacío de candidatos nunca produce este estado (produce `NO_TEST_RELEVANT_CHANGES`, `:586-588`); si hay al menos un símbolo `AVAILABLE`, el Run es `SUCCESS`, no este estado.
- **Estado final:** Run `NO_ADDITIONAL_TESTS_REQUIRED`. Check `success` / «Cobertura existente suficiente».
- **Cobertura existente:** `validation/analysis-run-validation-job.handler.spec.ts` → «skips a symbol that already has an existing test and completes NO_ADDITIONAL_TESTS_REQUIRED» y «records no execution for a symbol that already has a test, so its executions are NOT_APPLICABLE» y «records no retrieval or context for a symbol that already has a test»; `checks/check-conclusion.util.spec.ts` → «maps NO_ADDITIONAL_TESTS_REQUIRED to success».
- **Prueba propuesta:** integración Core con fixture de repositorio TypeScript cuyo test importa y llama el método cambiado: Run `NO_ADDITIONAL_TESTS_REQUIRED`, ausencia de propuestas y Check `success`; más un fixture donde el test no referencia el método para comprobar que no se omite.
- **Fuente:** SYS «Baseline, generación y clasificación»; 013 «Clasificación»; INT §6.10, §6.12; HU04, HU10, HU14.
- **Brecha:** el estado marca `functionalBehaviorValidated=true` (`:316-319`) aunque ningún test se ejecutó; la validación real del baseline queda en OC09.

### OC04 — Falta contexto funcional; pedir intervención — FORMALIZADO

- **Entrada/precondiciones:** Run `PROCESSING` y vigente; símbolo `DIRECTLY_CHANGED` `METHOD`/`FUNCTION` con `behaviorConstructs` no vacío (construcción nueva o modificada: ramificación, `throw` o escritura/transición de estado, `DEC-FK-003`/`DEC-FK-004`); sin regla `ACTIVE` con el mismo `scenarioKey`; sin pregunta no `OBSOLETE` con esa clave (`functional-context-evaluator.service.ts:97-155`). PHP participa desde `WI-CORE-032`.
- **Salida observable:** en una única transacción, el Run pasa a `ACTION_REQUIRED` con `actionRequiredCount + 1` y se crea la pregunta `PENDING` con `scenarioKind`/`scenarioKey` derivados por Core (`functional-questions.repository.ts:71-108`); el job de snapshot termina sin encolar validación. Visible en `GET /action-required` y `GET /analysis-runs/{id}/context-questions` (una pregunta a la vez). Respuesta válida (`POST …/answers`, Maintainer/Admin, sin conflicto): `202 outcome: ANSWERED` con `knowledgeId`; si no queda otra construcción por preguntar, el Run pasa `ACTION_REQUIRED → PROCESSING` con `attemptCount + 1` y se encola el job de continuación (`continuationAttemptId` no nulo), que reevalúa y encola validación; si queda otra construcción, el Run permanece `ACTION_REQUIRED`, se crea la siguiente pregunta y `continuationAttemptId` es `null` (`functional-knowledge.service.ts:181-198`).
- **Invariantes:** la elegibilidad es determinista y estructural; no se pregunta porque cambió un método ni por complejidad; una pregunta es atómica (un target, un escenario, una incertidumbre); `ACTION_REQUIRED` termina el job (nada espera); solo Maintainer/Admin responden (Writer/Reader: `403 PROJECT_ROLE_INSUFFICIENT`, antes de cualquier escritura); el autor del PR no gana autoridad por serlo; no hay continuación si el Run dejó de ser vigente.
- **Estado final:** Run `ACTION_REQUIRED` hasta que no queden construcciones sin cubrir. Check `action_required` / «Falta contexto funcional» / summary = título (el Run no fija `resultSummary`), enlazando al Run por `detailsUrl`. Tras responder y completar, el mismo Check (misma identidad) se actualiza con la conclusión final.
- **Cobertura existente:** `functional-knowledge/functional-context-evaluator.service.spec.ts` → «creates a question persisting scenarioKind and scenarioKey for %s», «does not ask when an ACTIVE rule applies to the target», «asks one question at a time in stable order: file, qualifiedName, then construct order», «does not report ACTION_REQUIRED when the run became obsolete before the atomic write»; `functional-knowledge/functional-questions.repository.spec.ts` → «atomically transitions a current PROCESSING run and creates its pending question», «keeps ACTION_REQUIRED during continuation while serializing the question write»; `snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` → «marks ACTION_REQUIRED when the functional context evaluator says a question is needed»; `functional-knowledge/functional-knowledge.service.spec.ts` → «requests continuation and enqueues the continuation job when no more context is needed», «does not request continuation when more questions remain», «answers 403 PROJECT_ROLE_INSUFFICIENT to a Reader on a pending question, before any write (HU60)», «answers 403 PROJECT_ROLE_INSUFFICIENT with details to a Writer on a pending question, before any write (INTEROP-2.7)»; `functional-knowledge/functional-continuation-job.handler.spec.ts` → «enqueues the Validation job when there is enough functional context now».
- **Prueba propuesta:** integración Core: fixture con construcción nueva sin regla → Run `ACTION_REQUIRED` + pregunta en inbox + Check `action_required` → respuesta de Maintainer → Run `PROCESSING` con `attemptCount=1` → terminal sobre el mismo `headSha`; caso con dos construcciones para fijar la pregunta siguiente sin continuación.
- **Fuente:** SYS «Contexto RAG y Functional Knowledge»; INT §6.10, §6.11; `DEC-FK-003`, `DEC-FK-004`; HU07, HU08, HU14.

### OC05 — Respuesta humana revela inconsistencia — FORMALIZADO

- **Entrada/precondiciones:** pregunta `PENDING` de un Run `ACTION_REQUIRED` vigente y, al responder, ya existe una regla `ACTIVE` con el mismo proyecto, `scope`, `targetRef` y `scenarioKey` (`functional-knowledge.service.ts:264-280`). Alcanzable solo si la regla `ACTIVE` apareció después de crear la pregunta (el evaluador no pregunta si ya hay regla de esa clave, `functional-context-evaluator.service.ts:126-135`), por ejemplo respondida desde otro Run del mismo Project, o por carrera entre dos respuestas.
- **Salida observable:** sin `conflictResolution`: `409 FUNCTIONAL_KNOWLEDGE_CONFLICT` con `details: FunctionalKnowledgeConflictResponse` (`conflictId` = `questionId`, regla vigente, `proposedNormalizedRule`); no se persiste nada y el Run no avanza. Reenvío con `conflictResolution.action = SUPERSEDE`: nueva regla `ACTIVE` con `supersedesId`, la anterior `SUPERSEDED`, pregunta `ANSWERED`, evaluación y continuación como en OC04. Con `KEEP_EXISTING`: pregunta `ANSWERED` con `knowledgeId: null`, regla vigente intacta, evaluación y continuación como en OC04. `conflictId` distinto de la pregunta → `404 FUNCTIONAL_QUESTION_NOT_FOUND`.
- **Invariantes:** el conflicto no se resuelve automáticamente; solo existe entre reglas con igual scope, `targetRef` y `scenarioKey` (otra clave coexiste como `ACTIVE`); una carrera la resuelve el índice único parcial y la segunda respuesta recibe el mismo 409; la contradicción semántica por LLM y la jerarquía PROJECT⊃MODULE⊃CLASS siguen pendientes y no se afirman; si el HEAD cambió, la pregunta es `OBSOLETE` y no hay conflicto (OC15).
- **Estado final:** Run sin cambio tras el 409 (`ACTION_REQUIRED`, Check `action_required` sin cambios); tras `SUPERSEDE`/`KEEP_EXISTING` el Run sigue la ruta de OC04.
- **Cobertura existente:** `functional-knowledge/functional-knowledge.service.spec.ts` → «responds 409 FUNCTIONAL_KNOWLEDGE_CONFLICT when ACTIVE knowledge exists and no conflictResolution is given», «SUPERSEDE persists a new ACTIVE rule referencing the superseded one», «KEEP_EXISTING answers the question as evidence without touching the ACTIVE rule», «rejects a conflictResolution whose conflictId does not match the question», «conflicto solo con la misma clave: 409 con la regla ACTIVE de esa clave», «coexistencia: una regla ACTIVE de otra clave no entra en conflicto y la nueva se crea junto a ella», «carrera: la segunda respuesta de la misma clave recibe 409 con la regla ganadora (índice ACTIVE)».
- **Prueba propuesta:** integración con base de datos real (índice único parcial) para la carrera y para el reenvío `SUPERSEDE`/`KEEP_EXISTING` con continuación del Run; hoy la carrera solo se prueba con dobles.
- **Fuente:** SYS «Contexto RAG y Functional Knowledge» (HU09); INT §6.11 (HU09, `DEC-FK-001`); HU08, HU13, HU14.

### OC06 — Push posterior a corrección de implementación — FORMALIZADO

- **Entrada/precondiciones:** Run A vigente (`QUEUED`, `PROCESSING`, `ACTION_REQUIRED` o terminal) para el HEAD A; evento `pull_request:synchronize` (incluido force-push) para el mismo PR con HEAD B, base == `integrationBranch`, PR no draft y elegible por fecha de creación.
- **Salida observable:** el Run A pasa a `OBSOLETE` con `current=false` y sus preguntas `PENDING` pasan a `OBSOLETE` en la misma transacción (`analysis-runs.repository.ts:113-138`); se crea el Run B `QUEUED` para el HEAD B y se encola su job de snapshot (`analysis-runs.service.ts:162-179`, `github-webhooks.service.ts:255-282`). El mismo HEAD redelivered no duplica el Run (`isNew=false`).
- **Invariantes:** un Run por PR/HEAD; A no se reanuda; un resultado tardío de A no cambia su estado ni publica Check (`completeRunFromSystem` devuelve `null` si `!current`, `analysis-runs.service.ts:152`; guarda en `analysis-run-checks.service.ts:37-44`); todo Check pertenece al SHA de su Run; no se publica Check para `OBSOLETE`.
- **Estado final:** A `OBSOLETE` (sin Check nuevo; un Check previo de A permanece en su SHA); B sigue el pipeline y su Check vigente es el de B.
- **Cobertura existente:** `analysis-runs/analysis-runs.service.spec.ts` → «obsoletes the previous current run from %s and creates a new one when the HEAD changed» (PROCESSING, ACTION_REQUIRED, SUCCESS), «obsoletes the previous current run when the HEAD changed and reports isNew:true», «reports isNew:false when the HEAD did not change (redelivery)», «ignores a system completion after the run became obsolete»; `analysis-runs/analysis-runs.repository.spec.ts` → «atomically obsoletes pending questions when a current run is obsoleted»; `snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` → «does not overwrite or publish a late failure when the run became obsolete»; `checks/analysis-run-checks.service.spec.ts` → «does not publish a check after the run stopped being current or changed status».
- **Prueba propuesta:** prueba a nivel `GithubWebhooksService` con dos eventos `synchronize` consecutivos (HEAD A, HEAD B) que compruebe A `OBSOLETE`, B creado, un único job para B y ningún `publishForRun` para A (hoy no hay prueba del webhook con HEAD nuevo).
- **Fuente:** SYS «Trigger PR-driven y lifecycle», «AnalysisRun, Job y Check»; INT §6.9, §6.10; HU07, HU14.
- **Brecha:** INT §6.10 define `history` con motivo `GITHUB_HEAD_SUPERSEDED`, marcado «pendiente de implementación»; el DTO de detalle no lo expone (`analysis-run.response.ts:40-50`) y ningún código registra transiciones con motivo.

### OC07 — Defecto detectable sin intervención humana — FORMALIZADO

- **Entrada/precondiciones:** símbolo candidato sin test existente, con retrieval y reglas funcionales `ACTIVE` aplicables en el contexto de generación; el test generado compila y se ejecuta, y falla por aserción (`failureType` `TEST_ASSERTION`, `map-sandbox-result.ts:99-110`; un caso fallido `failureKind=ERROR` pasa a técnico).
- **Salida observable:** el símbolo se clasifica `BEHAVIORAL_MISMATCH`; su propuesta queda `HELD` con `failureSummary` saneado (campo interno); Run `BEHAVIORAL_MISMATCH`, con prioridad sobre `AVAILABLE` y fallos técnicos de otros símbolos (`:576-590`); `generatedTestsCount` cuenta solo `AVAILABLE`. `POST /analysis-runs/{id}/test-publications` responde `409 TEST_PUBLICATION_INVALID_RUN_STATUS` (Run no `SUCCESS`, `test-publications.service.ts:53`).
- **Invariantes:** sin autorreparación de la aserción ni cambio de código productivo; no se publica companion PR mientras el Run no sea `SUCCESS`; la clasificación la fija Core, no Console.
- **Estado final:** Run `BEHAVIORAL_MISMATCH`. Check `failure` / «Comportamiento inconsistente detectado».
- **Cobertura existente:** `validation/analysis-run-validation-job.handler.spec.ts` → «classifies a TEST_ASSERTION failure as BEHAVIORAL_MISMATCH», «BEHAVIORAL_MISMATCH takes priority over an AVAILABLE proposal on another symbol», «classifies a failing case with only failureKind ASSERTION as BEHAVIORAL_MISMATCH»; `publications/test-publications.service.spec.ts` → «throws TEST_PUBLICATION_INVALID_RUN_STATUS when the run is not SUCCESS»; `checks/check-conclusion.util.spec.ts` → «maps BEHAVIORAL_MISMATCH to failure».
- **Prueba propuesta:** integración con fixture de regla `ACTIVE` y test generado contradictorio: Run `BEHAVIORAL_MISMATCH`, propuesta `HELD`, `409` de publicación y Check `failure`.
- **Fuente:** SYS «Baseline, generación y clasificación», «Publicación human-in-the-loop»; INT §6.10, §6.12; HU13, HU14.
- **Brecha:** Core clasifica `BEHAVIORAL_MISMATCH` por aserción fallida (`classifySymbolFailure`, `:568-574`), sin comprobar que exista una regla `ACTIVE` contradicha; las propuestas `AVAILABLE` de otros símbolos del mismo Run no pasan a `HELD` (quedan sin publicación posible por el estado del Run).

### OC08 — Test generado falla técnicamente — FORMALIZADO

- **Entrada/precondiciones:** candidato sin test existente cuyo test generado no compila, falla en ejecución por error no de aserción, la respuesta PHP no es un archivo PHP, no hay framework de test detectable o la generación/Sandbox lanza una excepción por símbolo.
- **Salida observable:** el símbolo queda `HELD` con `failureSummary` saneado; Run `TECHNICAL_GENERATION_FAILURE` si no hay `BEHAVIORAL_MISMATCH` (`:576-590`); no se acepta publicación (409 como OC07).
- **Invariantes:** un fallo técnico no se presenta como mismatch; sin autorreparación semántica; sin publicación; un fallo que se produce en un símbolo no aborta el resto.
- **Estado final:** Run `TECHNICAL_GENERATION_FAILURE`. Check `failure` / «Falla técnica generando la prueba».
- **Cobertura existente:** `validation/analysis-run-validation-job.handler.spec.ts` → «classifies a COMPILATION failure as TECHNICAL_GENERATION_FAILURE», «classifies a failing case with failureKind ERROR as TECHNICAL_GENERATION_FAILURE», «holds a proposal with a CONFIGURATION failure when the framework could not be detected», «holds the proposal as a technical failure without calling the Sandbox when the LLM response has no <?php», «treats a Sandbox-unavailable symbol as a per-symbol failure without aborting the whole run», «persists the failure summary sanitized when the exception message carries a secret (WI-CORE-027, IDEA-015)».
- **Prueba propuesta:** integración con fixture de import inválido: Run `TECHNICAL_GENERATION_FAILURE`, propuesta `HELD`, Check `failure` y ausencia de clasificación mismatch.
- **Fuente:** SYS «Baseline, generación y clasificación»; INT §6.10, §6.12; HU11, HU13, HU14.
- **Brecha:** una excepción del Sandbox por símbolo (no disponible, `TIMED_OUT`, categoría `INFRASTRUCTURE`) se clasifica `TECHNICAL_GENERATION_FAILURE` (`:535-565`, `map-sandbox-result.ts:57-67`), mientras SYS asigna Docker/red/storage/worker a `INFRASTRUCTURE_FAILURE`; `INFRASTRUCTURE_FAILURE` solo se usa cuando falla el binding, el `ProjectVersion`, el materializado, el compare o el job completo.
- **Decisión aprobada (usuario, 2026-10-12, con condición):** primero se **precisa el contrato** (SYSTEM tabla «Baseline, generación y clasificación», §152-154): qué es un fallo de plataforma por símbolo y la precedencia cuando un símbolo falla por plataforma y otros pasan o hacen mismatch, sin ocultar resultados buenos; solo después se alinea el código (excepciones del Sandbox por símbolo hoy clasificadas como técnicas) en un WI aparte. **Consolidado (`WI-CORE-047`, SYSTEM-2.10):** `DEC-VAL-002` APROBADA el 2026-10-12 por el usuario («La recomendada, sin afectar métricas»): precedencia `BEHAVIORAL_MISMATCH` > `TECHNICAL_GENERATION_FAILURE` > `INFRASTRUCTURE_FAILURE` > `SUCCESS` > `NO_ADDITIONAL_TESTS_REQUIRED`/`NO_TEST_RELEVANT_CHANGES`, definición de fallo de plataforma por símbolo y la condición de no afectar experimentos, evidencia ni métricas (`sandbox/map-sandbox-result.ts` solo con prueba de no regresión). Falta alinear el código en el WI de OC08.

### OC09 — Suite existente ya fallaba — FORMALIZADO (especificado; implementación pendiente)

- **Entrada/precondiciones (SYS, INT §7.2):** baseline relevante de tests existentes ejecutado con `phase=BASELINE` antes de atribuir fallos a pruebas generadas; el Sandbox reporta hechos y Core decide `BASELINE_FAILED`. Mientras no exista forma contractual de nombrar tests relevantes, `BASELINE` ejecuta la suite configurada; `phase=BASELINE` con `artifacts` no vacío es `400 VALIDATION_ERROR`.
- **Salida observable:** Run `BASELINE_FAILED`; no se generan ni clasifican pruebas.
- **Invariantes:** el baseline precede a la generación; el estado lo determina Core.
- **Estado final:** Run `BASELINE_FAILED`. Check `neutral` / «Tests existentes ya estaban en rojo».
- **Cobertura existente:** solo el mapa de conclusión (`checks/check-conclusion.util.spec.ts` → «maps BASELINE_FAILED to neutral») y la matriz de transiciones; sin cobertura del caso.
- **Prueba propuesta:** integración Core↔Sandbox simulado con baseline en rojo: Run `BASELINE_FAILED`, ninguna llamada de generación, Check `neutral`.
- **Fuente:** SYS «Baseline, generación y clasificación»; INT §6.10, §7.2; HU04, HU11, HU14.
- **Brecha (bloqueante para el comportamiento):** Core no implementa el baseline: ningún código produce `BASELINE_FAILED` ni envía `phase` (`analysis-run-validation-job.handler.ts:138-142`; `sandbox/` sin `phase`). El caso no es observable en Core hasta un WI de implementación.

### OC10 — Primer análisis de repositorio grande — FORMALIZADO

- **Entrada/precondiciones:** no existe `ProjectVersion` completada del Project; PR elegible; el compare de GitHub se obtiene completo (< 300 archivos, ver OC11).
- **Salida observable:** `GET /analysis-runs/{id}` con `indexMode: BOOTSTRAP`, `indexDeltaBaseSha: null`, `changesetBaseSha`/`changesetHeadSha` y `symbols`; todos los símbolos de los archivos del CHANGESET se reportan `DIRECTLY_CHANGED` (`snapshot-analysis-job.handler.ts:249-250,438-452`). El snapshot completo del HEAD se materializa e indexa en cada Run (`:132-133`). Mientras tanto el Run se observa `QUEUED`/`PROCESSING`; el resto del pipeline es el de OC01–OC13.
- **Invariantes:** `CHANGESET` define qué validar e `INDEX DELTA` qué reindexar; el primer análisis hace bootstrap; los Runs concurrentes se aíslan por repositorio/PR/HEAD. «Grande» no agrega umbrales, progreso intermedio ni parcialidad: SYS no fija thresholds en este corte y INT §6.6 solo define progreso para `ProjectVersion`.
- **Estado final:** el del pipeline normal; no existe estado propio de bootstrap.
- **Cobertura existente:** `snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` → «bootstraps when there is no previous ProjectVersion for the project», «reports every symbol in a changed file as DIRECTLY_CHANGED during BOOTSTRAP»; la prueba de modo `INCREMENTAL` se cita en OC13.
- **Prueba propuesta:** integración con repositorio sintético de gran tamaño (sin umbral) que fije `indexMode=BOOTSTRAP`, `indexDeltaBaseSha=null` y estado terminal; no verifica rendimiento.
- **Fuente:** SYS «AnalysisRun, Job y Check», «CHANGESET, INDEX DELTA y símbolos»; INT §6.10; HU03, HU14.
- **Decisión aprobada (usuario, 2026-10-12):** V1 mínimo: `BOOTSTRAP` y estado en texto, sin porcentajes. El criterio de suficiencia y el progreso quedan como **deuda con nombre «umbral de repo grande + progreso»**, que incluye hacer configurable `COMPARE_MAX_CHANGED_FILES=300` de GitHub Integration (constante en `tjc-be-github-integration-api/app/src/github/github-repository-content.service.ts:9`; repositorio ajeno, solo documentado) y definir qué hacer al superarlo.

### OC11 — PR o commit grande — FORMALIZADO (PQ-OC11 aprobada)

- **Por qué no se formaliza:** SYS indica que los PR grandes «se filtran, priorizan y pueden dividirse en batches sin fijar thresholds»; Core no implementa filtrado, priorización ni batches (los candidatos se procesan en serie, `analysis-run-validation-job.handler.ts:257-303`). Comportamiento observado: GH fija que un compare que alcanza 300 archivos es `UNVERIFIABLE`, `unwrapLookup` lo convierte en error (`github-repository-content.service.ts:157-171`) y el job termina el Run `INFRASTRUCTURE_FAILURE` con Check `neutral` (`snapshot-analysis-job.handler.ts:386-401`).
- **Decisión aprobada (PQ-OC11, 2026-10-12), actualizada el mismo día por el usuario («1: mensaje genérico veraz (Recomendado)»):** V1 mantiene `INFRASTRUCTURE_FAILURE` con Check `neutral`, sin estado nuevo, y un `resultSummary` genérico y veraz «No se pudo verificar el compare de GitHub (por ejemplo, un PR con 300 o más archivos); análisis no realizado», porque `UNVERIFIABLE` no distingue el límite de 300 de otras causas (permiso, 403, 429, 5xx, red) y no se debe afirmar que sean 300 archivos. Sin cambios en GitHub Integration ni en su contrato. La redacción «PR excede 300 archivos; análisis no realizado» queda como objetivo diferido en la deuda «umbral de repo grande + progreso». El WI de OC11 (`WI-CORE-046`) deja de relanzar el error en `UNVERIFIABLE` (el reintento entra en `snapshot-analysis-job.handler.ts:168-172` y termina sin trabajo), con prueba.
- **Estado final:** Run `INFRASTRUCTURE_FAILURE`. Check `neutral`. **Contrato (`WI-CORE-047`, INTEROP-2.10 §6.10):** el `resultSummary` genérico es el objetivo del WI de OC11 (pendiente hasta su cierre, no comportamiento actual) y el límite de 300 archivos pertenece a GitHub Integration (repositorio ajeno; solo documentado).
- **Fuente:** SYS «CHANGESET, INDEX DELTA y símbolos»; GH §Operaciones (Compare); HU06, HU14.
- **Cobertura existente:** `snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` → «transitions to INFRASTRUCTURE_FAILURE and rethrows when the GitHub API fails» (falla genérica del compare). **Implementado en `WI-CORE-046` (2026-10-12):** «completes as INFRASTRUCTURE_FAILURE with the exact neutral summary and does not rethrow when compare is UNVERIFIABLE», «keeps rethrowing a GitHub unavailable error without UNVERIFIABLE lookup status from compare», «keeps rethrowing an UNVERIFIABLE lookup from another operation with its own message» y, en `github-app/github-repository-content.service.spec.ts`, «exposes the lookup status on the unavailable error for compare UNVERIFIABLE».

### OC12 — Cambios sin relevancia para pruebas unitarias — FORMALIZADO

- **Entrada/precondiciones:** PR elegible cuyo CHANGESET (a) no toca archivos fuente soportados dentro del proyecto efectivo (solo docs, configuración o formato) o (b) toca fuente pero no deja ningún símbolo `DIRECTLY_CHANGED` `METHOD`/`FUNCTION`.
- **Salida observable:** (a) el job de snapshot completa el Run `NO_TEST_RELEVANT_CHANGES` con `resultSummary` «El CHANGESET no incluye cambios en archivos fuente…», sin evaluar contexto funcional ni encolar validación (`snapshot-analysis-job.handler.ts:366-372`); (b) el job de validación completa `NO_TEST_RELEVANT_CHANGES` con `resultSummary` «0 candidato(s) METHOD/FUNCTION directamente cambiado(s), 0 propuesta(s) disponible(s); cobertura existente no evaluada» y `functionalBehaviorValidated=false` (`validation/…handler.ts:586-588,607-609`). Sin propuestas.
- **Invariantes:** la relevancia la determina Core con criterio estructural; ni un cambio de método ni la complejidad activan `ACTION_REQUIRED`; no se afirma cobertura existente; reservar `NO_ADDITIONAL_TESTS_REQUIRED` para targets que se omitieron por tests.
- **Estado final:** Run `NO_TEST_RELEVANT_CHANGES`. Check `success` / «Sin cambios relevantes para pruebas».
- **Cobertura existente:** `snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` → «closes as NO_TEST_RELEVANT_CHANGES when the CHANGESET touches no source file», «does not evaluate functional context when the CHANGESET does not touch source»; `validation/analysis-run-validation-job.handler.spec.ts` → «completes NO_TEST_RELEVANT_CHANGES without claiming coverage when there are no DIRECTLY_CHANGED METHOD/FUNCTION candidates»; `checks/check-conclusion.util.spec.ts` → «maps NO_TEST_RELEVANT_CHANGES to success».
- **Prueba propuesta:** integración Core para ambos orígenes: PR solo de documentación y PR que modifica solo una clase/interfaz sin métodos nuevos; ambos terminan `NO_TEST_RELEVANT_CHANGES` con Check `success` y sin propuestas.
- **Fuente:** SYS «Baseline, generación y clasificación», «Contexto RAG y Functional Knowledge»; 013 «Clasificación»; INT §6.10; HU06, HU10, HU11, HU14 (`ST-CORE-023`).

### OC13 — Impacto indirecto por símbolos relacionados — FORMALIZADO

- **Entrada/precondiciones:** PR cuyo CHANGESET modifica un archivo; un símbolo en otro archivo importa ese archivo con un specifier relativo (`./` o `../`), sin que su propio archivo esté en el CHANGESET.
- **Salida observable:** `AnalysisRunDetailResponse.symbols` incluye ese símbolo con `changeKind: POTENTIALLY_IMPACTED` (`qualifiedName`, `filePath`, `kind`, `language`), distinguible de `DIRECTLY_CHANGED`. En ejecución incremental, un símbolo de archivo cambiado solo es `DIRECTLY_CHANGED` si su contenido difiere del de la versión anterior (`snapshot-analysis-job.handler.ts:438-466`).
- **Invariantes:** el impacto lo calcula Core; un símbolo no pasa a `DIRECTLY_CHANGED` por estar relacionado; un `POTENTIALLY_IMPACTED` no genera pregunta funcional ni propuesta (el evaluador y la validación solo toman `DIRECTLY_CHANGED`: `functional-context-evaluator.service.ts:29-38`, `analysis-run-validation-job.handler.ts:239-243`); la relación implementada son solo imports relativos (specifiers no relativos nunca cuentan, `:112-124`).
- **Estado final:** sin estado propio; el Run termina según OC01–OC12. Un Run con solo símbolos impactados y ningún candidato termina `NO_TEST_RELEVANT_CHANGES`.
- **Cobertura existente:** `snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` → «reports a symbol outside the CHANGESET as POTENTIALLY_IMPACTED when it relatively imports a changed file», «only reports a symbol as DIRECTLY_CHANGED (INCREMENTAL) when its content actually differs from the previous version», «marks INCREMENTAL with the previous commit as indexDeltaBaseSha when a previous version exists»; `functional-knowledge/functional-context-evaluator.service.spec.ts` → «returns actionRequired=false when no DIRECTLY_CHANGED METHOD/FUNCTION TypeScript symbol has constructs» (incluye un símbolo `POTENTIALLY_IMPACTED` con construcciones, que no genera pregunta).
- **Prueba propuesta:** integración que verifique la separación `DIRECTLY_CHANGED`/`POTENTIALLY_IMPACTED` en `GET /analysis-runs/{id}` y que un impactado no genere propuesta ni pregunta.
- **Fuente:** SYS «CHANGESET, INDEX DELTA y símbolos»; INT §6.10 (`AnalysisSymbolResponse`); HU03, HU06, HU14.

### OC14 — Conocimiento funcional desactualizado o contradicho — FORMALIZADO (PQ-OC14 aprobada, opción A)

- **Por qué no se formaliza:** SYS dice que si una regla vigente contradice un cambio «Core solicita decisión humana o clasifica con evidencia», sin elegir una vía, y que una regla `ACTIVE` no expira por un HEAD nuevo. Comportamiento observado, no contractual: con regla `ACTIVE` aplicable el evaluador no pregunta (`functional-context-evaluator.service.ts:126-135`), la regla se entrega al contexto de generación y una aserción fallida termina `BEHAVIORAL_MISMATCH` (OC07); Core no detecta contradicción ni solicita decisión.
- **Decisión aprobada (PQ-OC14, 2026-10-12, opción A):** ante una regla `ACTIVE` aplicable que el cambio contradice, el happy path es `BEHAVIORAL_MISMATCH` con evidencia, sin pedir decisión humana (como hoy): la regla se entrega al contexto de generación y la aserción generada que la contradice falla. Pedir decisión (`ACTION_REQUIRED`) exigiría detectar la contradicción antes de generar, y la detección semántica por LLM sigue pendiente.
- **Estado final:** Run `BEHAVIORAL_MISMATCH`. Check `failure` / «Comportamiento inconsistente detectado».
- **Fuente:** SYS «Contexto RAG y Functional Knowledge» (HU09, procedencia); INT §6.11; HU07, HU09, HU14.
- **Cobertura existente:** sin cobertura localizada del caso; `functional-context-evaluator.service.spec.ts` → «does not ask when an ACTIVE rule applies to the target» y `functional-knowledge.service.spec.ts` → «originHeadSha is procedencia, not vencimiento: a rule from another headSha still conflicts» ejercitan piezas, no el happy path.

### OC15 — Nuevo commit mientras se espera respuesta humana — FORMALIZADO (PQ-OC15 aprobada)

- **Entrada/precondiciones:** Run A `ACTION_REQUIRED` vigente con pregunta `PENDING`; evento `synchronize` (o equivalente de OC06) con HEAD B.
- **Salida observable:** igual que OC06 para el Run, más: la pregunta `PENDING` de A pasa a `OBSOLETE` en la misma transacción y sale de `GET /action-required` (el inbox exige pregunta `PENDING`, Run `ACTION_REQUIRED` y `current=true`, `functional-questions.repository.ts:211-216`); `GET …/context-questions` de A devuelve `currentQuestion: null` y obsoleta la pregunta si quedaba rezagada (`functional-knowledge.service.ts:103-117`). Responder una pregunta ya obsoleta o de un Run no vigente responde `404 FUNCTIONAL_QUESTION_NOT_FOUND` (`:134-141`; INT §4 define 404 para recurso inexistente sin enumerar el código). El Run B genera sus propias preguntas si las necesita.
- **Invariantes:** A no se reanuda; una respuesta a una pregunta obsoleta no crea conocimiento ni continuación ni abstención (también `UNKNOWN`); un job de A que termine tarde no publica Check ni degrada A a fallo técnico (`analysis-runs.service.ts:152`; `snapshot-analysis-job.handler.ts:403`).
- **Estado final:** A `OBSOLETE`; B según el pipeline. Sin Check nuevo para A; el Check `action_required` previo permanece en el SHA de A.
- **Cobertura existente:** `analysis-runs/analysis-runs.repository.spec.ts` → «atomically obsoletes pending questions when a current run is obsoleted»; `functional-knowledge/functional-knowledge.service.spec.ts` → «returns null and obsoletes the question when the run is no longer current», «obsoletes and rejects a PENDING question when the run is no longer current», «a HEAD change makes a pending question OBSOLETE even when the answer is UNKNOWN»; `functional-knowledge/functional-questions.repository.spec.ts` → «filters the cross-project inbox before pagination», «hides direct pending-question reads for unclassified or pre-binding runs»; `functional-knowledge/functional-context-evaluator.service.spec.ts` → «does not report ACTION_REQUIRED when the run became obsolete before the atomic write».
- **Prueba propuesta:** integración Core: Run `ACTION_REQUIRED` con pregunta → `synchronize` HEAD B → pregunta `OBSOLETE`, inbox vacío para A, `POST …/answers` sobre A `404`, Run B `QUEUED`.
- **Fuente:** SYS «Contexto RAG y Functional Knowledge»; INT §6.10, §6.11 (`UNKNOWN` y HEAD cambiado); HU08, HU14.
- **Decisión aprobada (PQ-OC15, 2026-10-12):** una respuesta tardía se rechaza con `404 FUNCTIONAL_QUESTION_NOT_FOUND` y no se persiste. La narrativa de §Pipeline de esta feature se corrigió en este corte; el contrato debe **nombrar** el código de error y corregir la narrativa de INTEROP §6.11 («cualquier regla potencial se reevalúa contra el Run actual»), lo que se publica en el WI de contrato con Contract Sync a Console e Integration. **Consolidado en `WI-CORE-045` (INTEROP-2.9 §6.11):** el código, su orden frente a `ANALYSIS_RUN_NOT_FOUND`/`403` y la ausencia de persistencia quedan nombrados; la frase de `UNKNOWN` con HEAD cambiado ya no habla de una regla potencial.
