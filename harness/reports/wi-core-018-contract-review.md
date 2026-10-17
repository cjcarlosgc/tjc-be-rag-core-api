Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# Revisión contractual WI-CORE-018 (INTEROP-2.7 §6.11, SYSTEM-2.6 DEC-FK-002/003/004)

Rango: f07c9fe..HEAD en `app`. Solo lectura; sin modificar código, harness/state ni work-items.

## Veredicto: CONFORME, sin blockers

| Punto | Resultado |
|---|---|
| `FunctionalQuestionResponse`: scenarioKind, scenarioKey, abstention | Conforme. `FunctionalAbstentionSummary {count,lastAt,lastByUserId,lastByRole}` coincide; `ConfirmingRole = ADMIN\|MAINTAINER`; `abstention=null` sin filas; resumen de la fila más reciente (orden createdAt desc, id desc). |
| `FunctionalAnswerAcceptedResponse.outcome` | Conforme: `'ANSWERED'\|'ABSTAINED'`; la rama UNKNOWN devuelve `continuationAttemptId=null`, `knowledgeId=null`, 202. |
| UNKNOWN (DEC-FK-002) | Conforme: no llama a `resolveKnowledge`, no evalúa ni encola continuación, la pregunta sigue PENDING, registra usuario/rol/fecha. |
| 403 `PROJECT_ROLE_INSUFFICIENT` | Conforme: `projectAccess.require(..., 'MAINTAINER')` y guarda `confirmingRole` que lanza `projectRoleInsufficient` si el rol no es ADMIN/MAINTAINER. |
| scenarioKey (DEC-FK-004) | Conforme: `<kind>:<sha256(targetRef+"\n"+forma)[0:16]>` (`scenarioKeyFor`); mapeo de kind y comparación base/HEAD por huella sin targetRef coinciden con la spec. |
| Activación (DEC-FK-003) | Conforme con plan.md (construcciones nuevas/modificadas, aplicabilidad por target hasta WI-CORE-020). |

## Observaciones (no bloqueantes)

1. Orden de errores en `submitAnswer`: 404 (run, pregunta, obsoleta, no PENDING) ahora precede al 403 de rol (antes el rol se exigía tras el Run). Está fijado en el plan de WI-CORE-018 y el contrato no lo define; para un Reader sobre pregunta inexistente/no PENDING la respuesta es 404, no 403. Sin impacto contractual, pero conviene que Console no asuma 403 en ese caso. Opcional: una línea en §6.11.
2. Preguntas históricas: el mapeo `scenarioKind=EXPECTED_RESULT` / `scenarioKey=LEGACY` con columnas nulas (en `toFunctionalQuestionResponse`) está registrado solo en `plan.md` de 013 y apoyado por analogía con DEC-FK-004 (que lo define solo para reglas históricas). Es compatible con los tipos no nulos de INTEROP-2.7 (`scenarioKind`/`scenarioKey` no nullable). REQUIERE nota contractual breve: una frase en §6.11 (o en la entrada INTEROP-2.7 del CHANGELOG) indicando que las preguntas anteriores a la migración se exponen con `EXPECTED_RESULT`/`LEGACY`, para que Console no trate `LEGACY` como error. No cambia versión.
3. Estados "pendiente de implementación (WI-CORE-018)" en §6.11 quedan por actualizar en la consolidación de cierre; el contract-sync a Console (outcome, abstention, scenarioKind/Key) se hará aparte, como se indicó.
4. Alcance fuera de 018: `scenarioKind/Key`, `confirmedBy*` en `FunctionalKnowledgeResponse` siguen pendientes (WI-019/020), correcto.

## Evidencia
- `app/src/functional-knowledge/dto/functional-question.response.ts`, `functional-answer-accepted.response.ts`
- `app/src/functional-knowledge/functional-knowledge.service.ts` (submitAnswer, confirmingRole)
- `app/src/functional-knowledge/behavior-fingerprint/behavior-fingerprint.ts` (scenarioKeyFor, l.129-133)
- `app/src/functional-knowledge/functional-questions.repository.ts` (recordAbstention, NEWEST_FIRST)
- Specs: service.spec (ABSTAINED, 403), repository.spec, behavior-fingerprint.spec. No se ejecutaron tests en esta revisión.
