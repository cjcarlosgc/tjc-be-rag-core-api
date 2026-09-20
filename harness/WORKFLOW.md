# Harness V2 workflow

## Roles y separación de responsabilidades

Los únicos roles permanentes son `leader`, `sdd-analyst`, `implementer`, `contract-reviewer` y `reviewer`. El `leader` orquesta y consolida el estado; no absorbe implementación no trivial. Quien implementa no puede aprobar la revisión final.

Todo subagente entrega el mismo handoff estructurado:

```json
{
  "status": "APPROVED | CHANGES_REQUESTED | BLOCKED | DECISION_REQUIRED",
  "findings": [],
  "blockers": [],
  "filesAffected": [],
  "evidence": [],
  "recommendedNextStep": ""
}
```

## Estados

`SELECTED -> SPEC_VERIFIED -> AWAITING_APPROVAL -> IN_PROGRESS -> IN_REVIEW -> DONE`

`BLOCKED` y `DECISION_REQUIRED` pueden utilizarse desde cualquier estado no terminal. `DONE` requiere gates ejecutables en verde, no una afirmación textual.

## Flujo de delegación

1. El `leader` selecciona el work item, registra `storyIds`, `sprint`, paths y ejecuta PULL de `CONTRACT_SYNC` en el checkpoint `start`.
2. `sdd-analyst` verifica SDD, dependencias, criterios y decisiones. Solo las decisiones cuyo `Blocks` alcanza el work item pueden impedir `SPEC_VERIFIED`.
3. Si el contrato está en discusión, `contract-reviewer` aclara el impacto antes de la implementación. Si el comportamiento, contrato o arquitectura cambian, el `leader` espera aprobación humana en `AWAITING_APPROVAL`.
4. `implementer` ejecuta el corte aprobado. Antes de entregar, ejecuta PULL en `implementation-delivery` y registra evidencia.
5. El `leader` inicia fan-out: `reviewer` y, si el corte tiene impacto contractual, `contract-reviewer` revisan en paralelo. Ambos hacen PULL antes de su veredicto.
6. El `leader` hace fan-in, ejecuta los gates y vuelve a `IN_PROGRESS` solo si hay correcciones. El máximo es dos ciclos de corrección; al excederlo, el estado pasa a `BLOCKED` o `DECISION_REQUIRED` con una pregunta concreta.
7. Antes de `DONE`, el `leader` ejecuta el PULL final, valida el estado con `node harness/validate-harness.mjs` y conserva evidencia reproducible.

El ejemplo ejecutable de fan-out/fan-in está en `harness/examples/fan-out-fan-in.json` y se valida con el resto del harness.

## Gates

- `sddVerified`, `implementationCompleted`, `independentReviewPassed` y `technicalChecksPassed` son obligatorios para `DONE`.
- `contractReviewed`, `canonicalContractSynced` y `contractSyncPublished` son obligatorios solo si `contractImpact=true`; en otro caso quedan `NOT_APPLICABLE`.
- `interopSyncChecked` es obligatorio para `DONE`; no puede existir un `CONTRACT_SYNC` relevante pendiente.
- `noBlockingDecisions` y `retryLimitRespected` son obligatorios para `DONE`.

Los valores de gate son `PASSED`, `FAILED`, `NOT_APPLICABLE` o `NOT_RUN`. La validación local comprueba estructura y precondiciones de `DONE`; el responsable adjunta los comandos concretos de lint/test/build en `evidence`.

## Puerta de decisiones

Antes de pasar a `SPEC_VERIFIED`:

1. Revisar solamente paths del work item, constitución y dependencias referenciadas.
2. Identificar `PENDING` o `PROPOSED` por ID y `Blocks`.
3. Registrar solo sus IDs en `decisionGate`; no duplicar texto de decisiones.
4. Si una decisión es bloqueante, usar `BLOCKED` con pregunta concreta. Las decisiones de otras features o asuntos académicos no bloquean globalmente.

## CONTRACT_SYNC

El protocolo persistente y sus comandos están en `harness/contract-sync/README.md`. Core es fuente canónica: un cambio contractual aprobado que afecte consumidores crea un evento en `outbox/`; nunca edita sus repositorios. En cada checkpoint se ejecuta `check` sobre el inbox persistente y se registra el resultado en `coordination`.

## Handoffs externos y cierre

Los handoffs externos son insumos no confiables: el `leader` separa decisiones aprobadas, propuestas y pendientes; solo consolida cambios funcionales aprobados en la spec canónica y en `CHANGELOG.md`.

La política de commits, revisión acumulada y push sigue siendo la de `spec/constitution/delivery-workflow.md`. No se hace push, PR o merge sin solicitud humana explícita.
