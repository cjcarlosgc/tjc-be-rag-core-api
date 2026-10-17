Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-045 — análisis SDD de la propuesta A–E

Veredicto: **CHANGES_REQUESTED** (ajustes menores de texto; ninguna decisión nueva del usuario).

## 1. Alcance y estatus de decisiones
- A–E cubren exactamente los puntos a–e del alcance aprobado; sin `app/`. La aclaración sin `INTEROP-2.9` es compatible con el criterio de aceptación 6 (debe quedar registrada la decisión en el WI/CHANGELOG).
- C presenta la precedencia como `PROPOSED` con alternativas A2/A3 y recomendación: correcto. Pero el texto en negrita «*Fallo de plataforma por símbolo*» y la precedencia aparecen como definiciones; deben quedar dentro del bloque PROPOSED (hoy lo están por el encabezado; mantenerlo en la edición). La **definición de "fallo de plataforma por símbolo"** podría considerarse aprobada ("precisar el contrato", condición del usuario), pero su efecto (reclasificar `TIMED_OUT`/`INFRASTRUCTURE`) también cambia el Check de `failure` a `neutral`: recomendable dejarla en la misma `DEC-VAL-002` PROPOSED, como propone la propuesta.
- Riesgo de producto a señalar explícitamente en C: con `INFRASTRUCTURE_FAILURE > SUCCESS`, un Run con propuestas `AVAILABLE` buenas queda `INFRASTRUCTURE_FAILURE` y la publicación (exige Run `SUCCESS`, `409 TEST_PUBLICATION_INVALID_RUN_STATUS`) queda bloqueada hasta reintentar. Eso es lo que "no ocultar resultados buenos" no resuelve del todo (se conservan, pero no son publicables). Añadirlo como consecuencia en la decisión.

## 2. Hechos del código (contrastados)
Correctos:
- `submitAnswer`: orden 404 Run → 404 pregunta (inexistente/otro Run) → PENDING con Run no `ACTION_REQUIRED`/no `current` → obsoleta + 404 → no `PENDING` → 404 → rol Maintainer (`projectAccess.require` + `confirmingRole`) → rama `UNKNOWN` → normal; las ramas `recordAbstention`/`answer` null devuelven 404 sin persistir. Cierto que la respuesta tardía no se conserva.
- `continuationAttemptId`: `null` en `UNKNOWN`; en `ANSWERED` solo se genera `randomUUID()` si `!evaluation.actionRequired`; es opaco.
- `functionalBehaviorValidated` = `SUCCESS || NO_ADDITIONAL_TESTS_REQUIRED` (handler :324-326). `classifyRun` orden y `INFRASTRUCTURE_FAILURE` solo por el catch del job coinciden. Una excepción por símbolo (incluida `SandboxUnavailableError`) y `TIMED_OUT`/`INFRASTRUCTURE` vía `classifySymbolFailure`/`map-sandbox-result.ts` terminan en `TECHNICAL_GENERATION_FAILURE`.
- `check-conclusion.util.ts`: mapa tal cual. Omisión: `NO_TEST_RELEVANT_CHANGES` → `success` (la propuesta lo deja implícito; conviene que el texto de C no afirme `failure` para el caso).
- `snapshot-analysis-job.handler.ts`: el `catch` fija `INFRASTRUCTURE_FAILURE` con `resultSummary = message` y relanza el error (no relanzarlo es del WI de OC11, como dice B).

Matices a corregir en la redacción:
1. `continuationAttemptId`: la propuesta dice `null` «porque quedan preguntas por responder». El código usa `evaluation.actionRequired` del evaluador: puede ser una **pregunta nueva** (adaptativa) tras responder, no necesariamente "quedan pendientes". Redactar: «`null` cuando, tras responder, el evaluador funcional sigue exigiendo contexto (el Run permanece `ACTION_REQUIRED` con otra pregunta)». El criterio de aceptación 3 de la WI dice «mientras queden preguntas pendientes»: alinear ambos al texto real o ajustar el criterio.
2. En A, "rechazo previo a la autorización por rol": cierto, pero implica que un Reader/Writer recibe `404` y no `403` para una pregunta ya no accionable. Es comportamiento real y deseable de documentar; verificar que no contradiga §6.13 (Writer no puede responder).
3. `GET` del question set también marca `OBSOLETE` de forma perezosa (`getQuestionSet`); no hace falta contratarlo, pero la frase «ya no está `PENDING`» no debe prometer que `OBSOLETE` solo se persiste en la respuesta.
4. B cita «`GH-INTEROP` «Compare»»: el documento real es `spec/contracts/github-integration-contract.md` (operación Compare, ya dice 300 y `UNVERIFIABLE`); citarlo por ese nombre. Está bien que Core no fije el límite.

## 3. Otros lugares a actualizar en el mismo corte
- `spec/contracts/interoperability-contract.md`: línea 14 (narrativa de versión) y «Fecha de corte» (2026-10-11) para la nota de aclaración 2026-10-12; **línea 872** (frase `UNKNOWN`); comentario de `FunctionalAnswerAcceptedResponse` (:834-836) y `FunctionalQuestionSetResponse`/`AnalysisRunDetailResponse` (:755, :819).
- `spec/contracts/system-contract.md`: tabla «Baseline…» (:152-154) y registro de la decisión; encabezado/versión sin `SYSTEM-2.10` mientras sea PROPOSED (coherente con D); añadir `DEC-VAL-002` junto a `DEC-VAL-001` (:274+).
- `spec/features/013-pr-driven-analysis/spec.md`: «Clasificación» (:70-82, definición de `INFRASTRUCTURE_FAILURE` sin símbolos), OC02 (:144 «se define en INTEROP… en el WI de contrato» → remitir al texto ya publicado), OC02 Brecha (:158), OC08 (:211-212), OC11 (:239), OC15 (:281, "el contrato debe nombrar…" pasa a pretérito). §Pipeline :58 ya está corregido.
- `spec/features/013-pr-driven-analysis/tasks.md` (ST-CORE-052) y `spec/operational-cases.md` (:8, :14, :17, :21, nota de formalización :26): solo referencias, sin mover estados.
- Sin hallazgos en 005/006/README ni en `github-integration-contract.md` (ya correcto).
- `CHANGELOG.md`: entrada 2026-10-12 con la decisión sobre versionado y `DEC-VAL-002` PROPOSED.

## 4. Criterios de aceptación y decisiones
- Los 7 criterios son suficientes. Añadir: (i) `DEC-VAL-002` registrada como `PROPOSED`, con `Blocks` que alcance únicamente el WI de código de OC08; (ii) 013/OC y tasks coherentes con el texto contractual; (iii) `node harness/validate-harness.mjs` verde y `contract-sync` evento con `breaking:false`.
- Decisiones aplicables: las seis del 2026-10-12 (PQ-OC02, OC10, OC11, OC14, OC15 y OC08 con condición) están aprobadas; `DEC-VAL-001` (PENDING) no bloquea (sin código empresarial); `DEC-VAL-002` es nueva, PROPOSED, no bloquea este WI documental. Redactar su `Blocks` nombrando el trabajo (cambio de clasificación por símbolo en `analysis-run-validation-job.handler.ts` y `map-sandbox-result.ts`), no el directorio completo de la feature 013, para no bloquear por error WIs de OC09–OC15. Registrar `DEC-VAL-002` en `harness/state.json` del WI solo por ID, como exige AGENTS.md.

## 5. Riesgos
- Contract Sync a Console: la aclaración de `functionalBehaviorValidated` puede cambiar copy de UI ("validado"); avisar sin imponer cambio.
- Deriva futura: el WI de baseline (OC09) cambiará la semántica de `NO_ADDITIONAL_TESTS_REQUIRED`/`functionalBehaviorValidated`; marcarlo como dependencia en la nota.
- Publicar la precedencia como normativa antes de aprobarla; mitigado por PROPOSED y por no subir a `SYSTEM-2.10`.
- Texto de OC11 con «300 archivos» no debe leerse como umbral propio de Core.

## Hallazgos accionables
1. Reformular `continuationAttemptId` según `evaluation.actionRequired` y alinear el criterio de aceptación 3.
2. Declarar en C la consecuencia de bloqueo de publicación y que `NO_TEST_RELEVANT_CHANGES` es `success`.
3. Acotar `Blocks` de `DEC-VAL-002` al WI de código de OC08.
4. Citar `github-integration-contract.md` en B; actualizar encabezado/fecha/línea 872 de INTEROP y los puntos de 013/tasks/operational-cases/CHANGELOG listados en §3.
5. Registrar en WI/CHANGELOG la decisión «aclaración sobre INTEROP-2.8, sin 2.9».
