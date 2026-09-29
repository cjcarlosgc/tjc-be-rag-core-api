# 013 — Análisis PR-driven y contexto funcional

**Estado:** APROBADO
**Story IDs:** HU02, HU06-HU09, HU13-HU16
**Contrato:** SYSTEM-2.5 / INTEROP-2.6

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
- `UNKNOWN`/No lo sé no crea `FunctionalKnowledge ACTIVE`.
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

Una respuesta human persistente genera Functional Knowledge y un continuation job solo si el HEAD sigue vigente. Un HEAD nuevo conserva la respuesta como evidencia/regla potencial y la reevalúa en otro Run.

## Clasificación

- `SUCCESS`: baseline y propuesta generada se validan.
- `NO_ADDITIONAL_TESTS_REQUIRED`: uno o más targets `METHOD`/`FUNCTION` directamente cambiados se evaluaron y todos se omitieron porque sus tests existentes los cubren. Un conjunto vacío de targets no demuestra cobertura.
- `NO_TEST_RELEVANT_CHANGES`: no hay targets `METHOD`/`FUNCTION` directamente cambiados dentro del alcance de validación vigente.
- `ACTION_REQUIRED`: falta conocimiento funcional relevante.
- `BEHAVIORAL_MISMATCH`: test técnicamente válido evidencia diferencia expected/observed.
- `TECHNICAL_GENERATION_FAILURE`: la prueba propuesta es técnicamente inválida.
- `INFRASTRUCTURE_FAILURE`: plataforma/Sandbox/storage/worker impide validar.
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
- RBAC propio: los roles Admin/Maintainer/Reader se derivan de GitHub y viven en `014-organizations-access` como capacidad de apoyo a HU01/HU02;
- proveedor remoto del Sandbox;
- despliegue o cutover de GitHub Integration; el código fuente y sus consumidores están migrados bajo `016-github-integration`, pero la operación externa requiere aprobación y secuencia coordinada. PHP completo sigue bajo desarrollo paralelo de Sandbox.

`DEC-INF-001`, `DEC-VAL-001` y `DEC-EXP-FK-001` conservan sus blocks acotados y no bloquean esta baseline documental.
