# WI-CORE-004 — Análisis SDD de la formalización OC01–OC15
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

**Fecha:** 2026-10-12 · **WI:** `WI-CORE-004` (`ST-CORE-004`, HU03–HU16, OC01–OC15, `contractImpact=false`) · **Estado del WI:** `W-SELECTED` (sin cambio). **Alcance:** `harness/reports/wi-core-004-scope-approval.md`. **Contratos verificados en cabecera:** `SYSTEM-2.9`, `INTEROP-2.8`, `GH-INTEROP-1.7`. **Referencia de solo lectura:** Console `c4379ec`, `spec/features/013-pr-driven-control-plane/spec.md` (sin edición).

## Handoff

- **status:** `DONE_WITH_DECISIONS` — 12 casos formalizados (uno con implementación pendiente y otro con una pregunta de alcance), 3 `DECISION_REQUIRED`.
- **blockers:** ninguno para formalizar; las 4 preguntas (PQ) condicionan solo OC02, OC11, OC14 y OC15. Ninguna `DEC` se cerró ni se creó por inferencia. Sin impacto contractual: no se enmendó INTEROP, SYSTEM ni GH-INTEROP; ningún caso lo exige.
- **filesAffected:** `spec/features/013-pr-driven-analysis/spec.md` (sección nueva al final), `spec/operational-cases.md` (columna y nota), este reporte. Sin cambios en `app/`, `harness/state.json` ni `harness/work-items.json`.
- **evidence:** `node harness/validate-harness.mjs` → «Harness V3 validation passed.» Cobertura verificada por `grep` de títulos de prueba en `app/src/**/*.spec.ts`; no se ejecutó la suite (no se tocó código).
- **recommendedNextStep:** el usuario revisa el diff de la sección y responde las 4 PQ (de una en una); luego, si aprueba, se consolida la sección, se registra en `CHANGELOG.md` y se decide qué subcasos `OCxx.a` aprobar para `O-READY`. Reviewer independiente = Human Reviewer (no se lanza agente).

## Veredicto por caso

| Caso | Veredicto | Estado final (Run / Check) | Cobertura existente (nivel) | Pregunta |
| --- | --- | --- | --- | --- |
| OC01 | FORMALIZADO | `SUCCESS` / `success` «Análisis exitoso» | piezas unitarias; sin e2e | — |
| OC02 | DECISION_REQUIRED | (hoy, de facto) `NO_ADDITIONAL_TESTS_REQUIRED` / `success` | ninguna para «tests del PR» | PQ-OC02 |
| OC03 | FORMALIZADO | `NO_ADDITIONAL_TESTS_REQUIRED` / `success` «Cobertura existente suficiente» | piezas unitarias | — |
| OC04 | FORMALIZADO | `ACTION_REQUIRED` / `action_required` «Falta contexto funcional» | evaluador, repositorio, servicio, continuación | — |
| OC05 | FORMALIZADO | sin cambio tras 409; luego como OC04 | servicio (conflicto, SUPERSEDE, KEEP_EXISTING, carrera con dobles) | — |
| OC06 | FORMALIZADO | A `OBSOLETE` sin Check; B pipeline normal | servicio/repositorio; sin prueba de webhook con HEAD nuevo | — |
| OC07 | FORMALIZADO | `BEHAVIORAL_MISMATCH` / `failure` «Comportamiento inconsistente detectado» | handler de validación + publicación 409 | — |
| OC08 | FORMALIZADO | `TECHNICAL_GENERATION_FAILURE` / `failure` «Falla técnica generando la prueba» | handler de validación | — |
| OC09 | FORMALIZADO (especificado; no implementado) | `BASELINE_FAILED` / `neutral` | solo mapa de conclusión | — |
| OC10 | FORMALIZADO (núcleo `BOOTSTRAP`) | el del pipeline | snapshot handler | — |
| OC11 | DECISION_REQUIRED | (hoy) `INFRASTRUCTURE_FAILURE` / `neutral` | ninguna del límite de 300 | PQ-OC11 |
| OC12 | FORMALIZADO | `NO_TEST_RELEVANT_CHANGES` / `success` «Sin cambios relevantes para pruebas» | snapshot handler + validación | — |
| OC13 | FORMALIZADO | sin estado propio | snapshot handler | — |
| OC14 | DECISION_REQUIRED | (hoy) `BEHAVIORAL_MISMATCH` | ninguna del happy path | PQ-OC14 |
| OC15 | FORMALIZADO + PQ de alcance | A `OBSOLETE`, preguntas `OBSOLETE`; B nuevo | repositorio/servicio; sin prueba del webhook | PQ-OC15 |

Ningún caso cambia de `O-CATALOGUED`. Todas las pruebas son unitarias con dobles; `app/test/` no contiene ningún e2e del pipeline.

## Preguntas mínimas (una por vez, con recomendación)

1. **PQ-OC02 (OC02).** Un target cuyo test llegó en el mismo PR (aportado por developer o agente): ¿se trata como test existente (`NO_ADDITIONAL_TESTS_REQUIRED`, comportamiento actual, sin ejecutarlo) o debe validarse antes de concluir? *Recomendación:* tratarlo como existente y documentar que no se ejecuta hasta que exista el baseline (OC09).
2. **PQ-OC11 (OC11).** Cuando el compare alcanza 300 archivos (`UNVERIFIABLE`), ¿el resultado esperado de V1 es `INFRASTRUCTURE_FAILURE` (hoy) o debe haber otro estado/mensaje de «PR demasiado grande para verificar»? *Recomendación:* `INFRASTRUCTURE_FAILURE` con `resultSummary` explícito; filtrado, priorización y batches quedan diferidos hasta fijar umbrales.
3. **PQ-OC14 (OC14).** Ante una regla `ACTIVE` aplicable que el cambio contradice, ¿el happy path es (A) `BEHAVIORAL_MISMATCH` con evidencia, sin pedir decisión (hoy) o (B) `ACTION_REQUIRED` para confirmar o sustituir la regla? *Recomendación:* (A) para V1; (B) exige detección de contradicción que sigue pendiente.
4. **PQ-OC15 (OC15).** ¿Una respuesta enviada después del cambio de HEAD se rechaza (hoy, `404`, sin persistir) o se conserva como evidencia/regla potencial, como dice §Pipeline? *Recomendación:* rechazarla y corregir la narrativa de §Pipeline.

## Hallazgos (archivo:línea, working tree actual)

**H1 — OC09/OC01: no existe baseline.** Ningún código produce `BASELINE_FAILED` ni envía `phase=BASELINE`; la propia documentación del handler lo reconoce (`app/src/validation/analysis-run-validation-job.handler.ts:138-142`). `BASELINE_FAILED` solo está en el mapa de transiciones y de conclusión (`app/src/analysis-runs/analysis-runs.service.ts:36,62,72`, `app/src/checks/check-conclusion.util.ts:20,36`). INT §7.2 dice que Core enviará `phase` explícito «cuando implemente el baseline». El caso OC09 no es observable hasta un WI dedicado.

**H2 — OC03: «suficientes» = existencia.** `hasTest` se activa cuando un archivo de test importa el símbolo y, para métodos, contiene `.método(` (`app/src/project-versions/inventory/existing-test-resolver.service.ts:55-93`); el símbolo se omite sin ejecutar nada (`validation/analysis-run-validation-job.handler.ts:262-265`). Aun así el Run fija `functionalBehaviorValidated=true` (`:316-319`).

**H3 — OC02: Core no distingue tests del PR.** El snapshot es el HEAD completo (`snapshot-intelligence/snapshot-analysis-job.handler.ts:210-216`), así que un test aportado por el PR cuenta como existente (H2).

**H4 — OC04: `continuationAttemptId` solo existe si no quedan preguntas.** Con más construcciones sin cubrir, `evaluate` crea la siguiente pregunta y el Run sigue `ACTION_REQUIRED` con `continuationAttemptId: null` (`functional-knowledge/functional-knowledge.service.ts:181-198`); además el valor es un `randomUUID()` no persistido (`:186`). El contador real es `attemptCount`.

**H5 — OC05: alcanzabilidad.** El evaluador no pregunta si ya hay regla `ACTIVE` de la clave (`functional-knowledge/functional-context-evaluator.service.ts:126-135`), de modo que el conflicto solo ocurre si la regla apareció después de crear la pregunta (otro Run del mismo Project o carrera). La carrera solo está probada con dobles.

**H6 — OC06: `history` no implementado.** INT §6.10 define `history` con motivos `RUN_CREATED`, `GITHUB_HEAD_SUPERSEDED`, etc. y lo marca «pendiente de implementación»; `AnalysisRunDetailResponse` no lo expone (`analysis-runs/dto/analysis-run.response.ts:40-50`) y ningún código usa esos motivos.

**H7 — OC06/OC15: sin prueba del webhook con HEAD nuevo.** Las pruebas de `github-webhooks.service.spec.ts` cubren `opened`, pre-binding, cierre, base fuera de rama y recuperación; ninguna crea un segundo Run por `synchronize` con HEAD nuevo. La obsolescencia está probada en `analysis-runs.service.spec.ts` y `analysis-runs.repository.spec.ts`.

**H8 — OC07: no se exige regla `ACTIVE`.** `BEHAVIORAL_MISMATCH` sale de `failureType === 'TEST_ASSERTION'` (`validation/analysis-run-validation-job.handler.ts:568-574`, `sandbox/map-sandbox-result.ts:99-110`), no de una regla contradicha. Las propuestas `AVAILABLE` de otros símbolos no pasan a `HELD`; la publicación se bloquea por el estado del Run (`publications/test-publications.service.ts:53`).

**H9 — OC08: infraestructura del Sandbox clasificada como técnica.** Excepciones por símbolo (Sandbox no disponible, `TIMED_OUT`, categoría `INFRASTRUCTURE`) acaban en `TECHNICAL_GENERATION_FAILURE` (`validation/…handler.ts:535-565`, `sandbox/map-sandbox-result.ts:57-67`), contra SYS «Baseline, generación y clasificación» que asigna plataforma a `INFRASTRUCTURE_FAILURE`. Probado por «treats a Sandbox-unavailable symbol as a per-symbol failure without aborting the whole run».

**H10 — OC11: compare ≥ 300 archivos.** `UNVERIFIABLE` → `GithubAppUnavailableError` 503 (`github-app/github-repository-content.service.ts:157-171`) → `INFRASTRUCTURE_FAILURE` y Check `neutral` (`snapshot-analysis-job.handler.ts:386-401`). No hay filtrado, priorización ni batches (`validation/…handler.ts:257-303` procesa en serie).

**H11 — OC10: sin progreso.** Core solo expone `QUEUED`/`PROCESSING`; `indexMode` pasa a `BOOTSTRAP` cuando no hay `ProjectVersion` completada (`snapshot-analysis-job.handler.ts:246-250`) y reindexa el árbol completo en cada Run (`:132-133`). El progreso de INT §6.6 es solo de `ProjectVersion`.

**H12 — OC13: impacto solo por imports relativos.** `importResolvesToChangedFile` descarta specifiers que no empiezan por `.` (`snapshot-analysis-job.handler.ts:112-124`); un `POTENTIALLY_IMPACTED` no genera preguntas ni propuestas (`functional-context-evaluator.service.ts:29-38`, `validation/…handler.ts:239-243`).

**H13 — OC15: contradicción interna de la spec 013.** §Pipeline («Un HEAD nuevo conserva la respuesta como evidencia/regla potencial y la reevalúa en otro Run») frente al código, que responde `404 FUNCTIONAL_QUESTION_NOT_FOUND` a toda respuesta posterior a la obsolescencia (`functional-knowledge.service.ts:134-141`). El nombre de código no está enumerado en INT (solo la regla general de `404`, INT §4).

**H14 — Encabezado de la spec 013.** `Contrato: SYSTEM-2.6 / INTEROP-2.7` y `Story IDs: HU02, HU06-HU09, HU13-HU16` no reflejan SYSTEM-2.9/INTEROP-2.8/GH-INTEROP-1.7 ni HU03–HU05, HU10–HU12 que la sección nueva cita. No se modificó; queda como corrección editorial a decidir con el usuario.

## Discrepancias de la formalización de Console (`c4379ec`) frente a Core

1. **OC04.** Console afirma que una respuesta válida «devuelve `202` y continúa el mismo Run con un `continuationAttemptId`»; Core solo lo hace si no queda otra pregunta (H4).
2. **OC06.** Console muestra la transición `GITHUB_HEAD_SUPERSEDED` «en su historial»; Core no expone `history` (H6).
3. **OC07.** Console exige «regla `ACTIVE` aplicable»; Core no lo comprueba (H8). Console dice propuestas `HELD`; solo la del símbolo fallido lo está.
4. **OC08.** Console distingue técnico de `INFRASTRUCTURE_FAILURE`; Core reporta fallos de plataforma por símbolo como técnicos (H9).
5. **OC09.** Console formaliza `BASELINE_FAILED` como observable; Core no puede producirlo (H1).
6. **OC10/OC11.** Console los deja `DECISION_REQUIRED` por progreso y batches; en Core el progreso no existe y el límite de 300 es `INFRASTRUCTURE_FAILURE` (H10, H11). OC10 no requiere decisión de Core; la presentación de progreso es de Console.
7. **OC03.** Console dice «tests existentes que Core considera suficientes»; la suficiencia implementada es existencia de test asociado, sin ejecutar, y marca `functionalBehaviorValidated=true` (H2).
8. **OC12.** Console solo cita un origen; Core tiene dos (CHANGESET sin fuente y sin candidatos `METHOD`/`FUNCTION`), con `resultSummary` distintos.
9. **OC13.** Console habla de «símbolos relacionados»; Core solo implementa imports relativos (H12).
10. **OC15.** Console dice que el error de respuesta sobre pregunta obsoleta «no está fijado»; Core lo implementa como `404 FUNCTIONAL_QUESTION_NOT_FOUND` (H13).

Las correcciones de Console, si el usuario las aprueba, viajan como un handoff compacto al agente de Console; este análisis no las ejecuta.

## Cortes propuestos (sin implementar; requieren aprobación del usuario)

1. **Corte A — consolidación documental (este WI).** Revisión del diff por el usuario, respuesta a PQ-OC02/-OC11/-OC14/-OC15, entrada en `CHANGELOG.md` y, si procede, corrección editorial de H14 y de §Pipeline (H13). Sin cambios en `app/`.
2. **Corte B — pruebas de integración de pipeline (WI nuevo, solo si el usuario lo aprueba).** Un archivo por caso formalizado, con GitHub, Sandbox y LLM simulados en frontera, priorizando OC01, OC03, OC04, OC06/OC15 y OC12 (estados y Checks de las secciones «Prueba propuesta»). Incluye la prueba de webhook con HEAD nuevo (H7).
3. **Corte C — baseline (WI nuevo, impacto en Sandbox).** Implementar `phase=BASELINE` y `BASELINE_FAILED` (H1); depende de que el Sandbox publicado entregue `phase`; puede requerir Contract Sync al revisar, por lo que no se estima sin `contract-reviewer`.
4. **Corte D — `history` de Run (WI nuevo).** Implementar el historial append-only ya definido en INT §6.10 (H6).
5. **Corte E — subcasos `OCxx.a`.** Solo cuando el usuario apruebe cuáles; este análisis no propone ninguno.

## Actualización del leader (2026-10-12): decisiones del usuario incorporadas
Las cuatro preguntas (PQ-OC02, PQ-OC11, PQ-OC14, PQ-OC15), la política de OC10 y la condición de OC08 fueron resueltas por el usuario directamente en el chat de Core el 2026-10-12 («Sí, las seis aprobadas»; ver `harness/reports/wi-core-004-user-decisions-2026-10-12.md`). La sección de la feature 013 se actualizó en consecuencia: OC02, OC11, OC14 y OC15 pasan a FORMALIZADO con la decisión citada, OC10 anota la deuda «umbral de repo grande + progreso» y OC08 anota que primero se precisa el contrato; la narrativa de §Pipeline de la feature 013 se corrigió (respuesta tardía: `404 FUNCTIONAL_QUESTION_NOT_FOUND`, sin persistir). Quedan para el WI de contrato (INTEROP/SYSTEM, con Contract Sync): el código de error de OC15 en INTEROP §6.11, la tabla y precedencia de OC08, la semántica de `functionalBehaviorValidated` y `continuationAttemptId` null. La corrección editorial del encabezado de la feature 013 (H14) y las correcciones de la vista de Console quedan a decisión del usuario. Ningún caso cambia de `O-CATALOGUED`.
