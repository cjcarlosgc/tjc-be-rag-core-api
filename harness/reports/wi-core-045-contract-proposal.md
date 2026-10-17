# WI-CORE-045 — propuesta de texto contractual (previa a editar INTEROP/SYSTEM)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Estado: PROPUESTA para sdd-analyst y contract-reviewer. Ningún contrato ha sido editado todavía. Hechos verificados contra `app/` (solo lectura).

## Hechos del código (base de las aclaraciones)
- `functional-knowledge.service.ts submitAnswer`: orden fijo `404 ANALYSIS_RUN_NOT_FOUND` (Run no visible) → `404 FUNCTIONAL_QUESTION_NOT_FOUND` (pregunta inexistente o de otro Run; `PENDING` con Run no `ACTION_REQUIRED` o no `current` -> se obsoleta y 404; pregunta no `PENDING`) → `403 PROJECT_ROLE_INSUFFICIENT` (rol < Maintainer) → rama `UNKNOWN` (202 `ABSTAINED`) → rama normal. Una carrera entre lectura y escritura condicional también responde `404 FUNCTIONAL_QUESTION_NOT_FOUND`. Ninguna rama 404 persiste respuesta, conocimiento, abstención ni continuación. La respuesta no se guarda como regla potencial.
- `continuationAttemptId`: tras `ANSWERED`, si el evaluador funcional aún exige `ACTION_REQUIRED` es `null` (no hay continuación); si no, Core encola `FUNCTIONAL_CONTINUATION_JOB_TYPE` y devuelve un UUID generado en ese momento (`randomUUID()`), que hoy es un identificador de correlación opaco y no la clave de una fila consultable por otro endpoint.
- `functionalBehaviorValidated` (`analysis-run-validation-job.handler.ts:324-326`) es `true` solo cuando el Run termina `SUCCESS` o `NO_ADDITIONAL_TESTS_REQUIRED` (este último con tests existentes que no se ejecutaron); es `false` en `NO_TEST_RELEVANT_CHANGES` (nada se evaluó), `BEHAVIORAL_MISMATCH`, fallos, `ACTION_REQUIRED` y mientras el Run no completó.
- `classifyRun` (`analysis-run-validation-job.handler.ts`): `BEHAVIORAL_MISMATCH` > `TECHNICAL_GENERATION_FAILURE` > `SUCCESS` (algún `AVAILABLE`) > `NO_TEST_RELEVANT_CHANGES` (0 símbolos) > `NO_ADDITIONAL_TESTS_REQUIRED`. `INFRASTRUCTURE_FAILURE` solo lo fija el job cuando falla binding, versión, materializado, compare o el job completo; una excepción del Sandbox por símbolo (`SandboxUnavailableError`, `TIMED_OUT`, categoría `INFRASTRUCTURE`) hoy es `TECHNICAL_GENERATION_FAILURE`.
- Check: `BEHAVIORAL_MISMATCH` y `TECHNICAL_GENERATION_FAILURE` → `failure`; `INFRASTRUCTURE_FAILURE` y `BASELINE_FAILED` → `neutral`; la publicación del companion PR exige Run `SUCCESS` (`409 TEST_PUBLICATION_INVALID_RUN_STATUS`).

## A. INTEROP §6.11 (aclaración, sin cambio de forma)
Insertar tras la lista de rutas y antes de «El inbox de preguntas…»:

> **Respuesta a una pregunta que ya no es accionable.** `POST …/answers` responde `404 FUNCTIONAL_QUESTION_NOT_FOUND` cuando la pregunta no existe, no pertenece al `AnalysisRun` indicado, ya no está `PENDING` (`ANSWERED` u `OBSOLETE`) o su Run dejó de ser accionable (`OBSOLETE`, no `current` o fuera de `ACTION_REQUIRED`, por ejemplo tras un HEAD nuevo, `synchronize` o PR cerrado). Aplica a cualquier `choice`, incluida `UNKNOWN`. El rechazo es previo a la autorización por rol y no persiste respuesta, no crea ni modifica Functional Knowledge, no registra abstención y no encola continuación: una respuesta tardía no se conserva como regla potencial. El Run vigente evalúa su propio contexto y formula, si hace falta, sus propias preguntas. Un Run inexistente o no visible responde `404 ANALYSIS_RUN_NOT_FOUND`.

Corregir la frase de `UNKNOWN`: «Si el HEAD cambió, la pregunta queda `OBSOLETE`, no se reanuda el Run viejo y cualquier regla potencial se reevalúa contra el Run actual.» →
> «Si el HEAD cambió, la pregunta queda `OBSOLETE` y no se reanuda el Run viejo; responderla después responde `404 FUNCTIONAL_QUESTION_NOT_FOUND` y no persiste nada. El Run actual evalúa su propio contexto.»

En `FunctionalAnswerAcceptedResponse` (comentario del campo) y debajo de la interfaz:
> `continuationAttemptId` es `null` cuando no se encola continuación: abstención `UNKNOWN` y respuesta `ANSWERED` tras la cual el Run permanece `ACTION_REQUIRED` porque quedan preguntas por responder. Solo es distinto de `null` cuando Core encoló la continuación del Run; es un identificador opaco de correlación y no es consultable por otro endpoint. `knowledgeId` sigue siendo `null` con `KEEP_EXISTING` y con `UNKNOWN`.

En `FunctionalQuestionSetResponse`, debajo de la interfaz:
> `functionalBehaviorValidated` significa «el pipeline terminó sin hallar discrepancia», no «se ejecutó una validación»: es `true` solo cuando el Run termina `SUCCESS` o `NO_ADDITIONAL_TESTS_REQUIRED` (en este último caso los tests existentes suficientes no se ejecutaron). Es `false` mientras el Run no completó y en `NO_TEST_RELEVANT_CHANGES` (no hubo candidato evaluado), `BEHAVIORAL_MISMATCH`, `ACTION_REQUIRED` y los fallos. No acredita que un baseline se haya ejecutado (OC09).

## B. INTEROP §6.10 — mismo campo y `resultSummary` (aclaración)
Debajo de `AnalysisRunDetailResponse`:
> `functionalBehaviorValidated` tiene la semántica definida en §6.11. `resultSummary` es texto para personas, no un enum. Cuando el compare del PR alcanza el límite de 300 archivos que GitHub expone y GitHub Integration devuelve `UNVERIFIABLE` (`GH-INTEROP` «Compare»), el Run termina `INFRASTRUCTURE_FAILURE` con Check `neutral` y `resultSummary` «PR excede 300 archivos; análisis no realizado», distinto de una caída de Core (estado actual: el texto genérico del fallo; el mensaje y el no relanzar el error los entrega el WI de OC11). El límite pertenece a GitHub Integration (constante `COMPARE_MAX_CHANGED_FILES`, repositorio ajeno): este contrato no lo fija ni lo hace configurable.

## C. SYSTEM «Baseline, generación y clasificación» (decisión PROPOSED)
Añadir tras la lista de clasificación:

> **Resultados mezclados por símbolo (`DEC-VAL-002`, PROPOSED; no implementar hasta su aprobación).**
> *Fallo de plataforma por símbolo:* el símbolo no obtuvo veredicto porque el Sandbox no estuvo disponible o rechazó la ejecución, la ejecución agotó el tiempo límite del Sandbox o el Sandbox reportó una falla de categoría `INFRASTRUCTURE` (Docker, red, almacenamiento, worker o runtime de plataforma). No lo son compilación, aserción, error de ejecución de la prueba, dependencia ni configuración del framework, que siguen siendo fallo técnico de generación; un fallo `UNKNOWN` no se atribuye a la plataforma sin evidencia.
> *Precedencia del estado del Run* (de mayor a menor): `BEHAVIORAL_MISMATCH` > `TECHNICAL_GENERATION_FAILURE` > `INFRASTRUCTURE_FAILURE` > `SUCCESS` > `NO_ADDITIONAL_TESTS_REQUIRED` > `NO_TEST_RELEVANT_CHANGES`. El resultado de cada símbolo se conserva siempre (propuestas `AVAILABLE`, evidencia de discrepancia y fallo por símbolo), y `resultSummary` cuenta por separado los fallos de plataforma y los técnicos; el estado del Run es solo el más accionable.
> *Razón:* una discrepancia demostrada no se oculta por un fallo ajeno de plataforma en otro símbolo; un fallo técnico atribuible no se degrada a `neutral`; un Run con un símbolo sin veredicto no es `SUCCESS` ni permite publicar como si todo estuviera validado.
> *Alternativas:* (A2) plataforma sobre técnico: el Check pasa a `neutral` y un fallo técnico real queda enmascarado hasta reintentar; (A3) la falla de plataforma de un símbolo no altera el Run si otros pasan: permitiría publicar con un símbolo sin validar. Recomendación: la precedencia anterior.

Registrar `DEC-VAL-002` en SYSTEM como «### DEC-VAL-002 — Fallo de plataforma por símbolo y precedencia del Run», `Estado: PROPOSED`, `Blocks: spec/features/013-pr-driven-analysis` (solo el WI de código de OC08; no bloquea este WI documental).

## D. Versionado propuesto
- INTEROP: sin `INTEROP-2.9`; una nota de estado fechada («Aclaración 2026-10-12 sobre INTEROP-2.8») porque no cambia ruta, campo ni código ya emitido: `FUNCTIONAL_QUESTION_NOT_FOUND` y `ANALYSIS_RUN_NOT_FOUND` ya son emitidos por Core y los consumidores ignoran campos desconocidos.
- SYSTEM: sin `SYSTEM-2.10` mientras `DEC-VAL-002` sea PROPOSED; la aprobación (cambio normativo de la clasificación) lo exigirá.
- Contract Sync: un evento `CS-CORE-20261012-NNN` a `console` y `github-integration` con `scopePaths` de ambos contratos, `breaking: false`; Sandbox solo si el contrato SYSTEM le afecta (la clasificación por plataforma depende de las categorías que Sandbox ya emite; no requiere acción local).

## E. Feature 013 y casos operativos (consolidación)
Actualizar OC02 («Semántica aprobada»), OC08 (referencia a `DEC-VAL-002`), OC11 y OC15 para citar los textos anteriores; `spec/operational-cases.md` solo referencia, sin mover estados.
