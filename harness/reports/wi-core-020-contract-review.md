Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# Revisión contractual WI-CORE-020

Alcance: commit 27c8519 (código) y 2f4ef6a (spec INTEROP-2.7 §6.11) frente a INTEROP-2.7 §6.11, DEC-FK-001/003/004 y system-contract.md.

## Resultado: APPROVED_WITH_NOTES

## Verificaciones
- DTO FunctionalKnowledgeResponse: agrega scenarioKind y scenarioKey (§6.11 líneas 834-835). Heredados de la pregunta; históricas EXPECTED_RESULT/LEGACY. Coincide con DEC-FK-001/004. Aditivo.
- 409 FUNCTIONAL_KNOWLEDGE_CONFLICT: misma AppException, HttpStatus.CONFLICT, mismo mensaje y details FunctionalKnowledgeConflictResponse (conflictId=questionId, analysisRunId, questionId, conflictingKnowledge, proposedNormalizedRule). La forma no cambió. conflictingKnowledge solo gana los dos campos aditivos. La carrera (P2002 -> ActiveKnowledgeConflictError -> regla ganadora) produce el mismo 409; coincide con §6.11.
- Conflicto/SUPERSEDE acotados a project+scope+targetRef+scenarioKey; distinta clave coexiste. Coincide con DEC-FK-001. KEEP_EXISTING sin cambio.
- Listado GET /projects/{id}/functional-knowledge: sin cambio de ruta ni parámetros; devuelve todas las ACTIVE (varias por target). Cambio de cardinalidad ya documentado en §6.11; no rompe el tipo Page<FunctionalKnowledgeResponse>.
- Migración 20261008150000: columnas, backfill EXPECTED_RESULT/LEGACY, paso idempotente (una ACTIVE por target, único cambio de status), NOT NULL, índice único parcial ACTIVE con COALESCE(targetRef,''), reversión manual documentada. Consistente con DEC-FK-004 (migración reversible) y §6.11.
- Evaluador: aplicabilidad por scenarioKey; regla LEGACY u otra clave no cubre construcciones nuevas. Coincide con DEC-FK-003 ("comparte target y scenarioKey").

## Findings
1. (menor, documental) system-contract.md DEC-FK-003 conserva "hasta que se implementen los escenarios (WI-CORE-020), cuando comparte target". Ahora es histórico; conviene aclararlo o dejarlo como historia en CHANGELOG. No bloquea.
2. (menor, documental) interoperability-contract.md línea 14 dice que todo lo agregado en INTEROP-2.7 está pendiente; §6.11 ya marca partes implementadas (018, 019, 020). Las notas por sección prevalecen; sin acción obligatoria.
3. (menor) Línea 795 (scenarioKey de la pregunta) sigue "pendiente, WI-CORE-018" mientras CS-...-002 la declara implementada en 018; verificar que el marcador sea coherente (fuera del alcance de 020).

## Contract Sync
- Solo Console es consumidor: es quien lee FunctionalKnowledgeResponse y el 409 en Focus Mode. Sandbox y GitHub Integration no consumen estas rutas. Targets [console] correcto.
- CS-CORE-20261008-005 propuesto: breaking:false es correcto (campos aditivos, 409 y rutas intactas; la coexistencia de varias ACTIVE por target solo cambia cardinalidad ya anunciada en CS-...-001). scopePaths [spec/contracts/interoperability-contract.md] correcto. Sugerencia: en requiredAction indicar a Console que tolere varias reglas ACTIVE por target en el listado y use scenarioKind/scenarioKey solo para mostrar/agrupar, sin enviarlos nunca. Los números -003 y -004 ya existen; confirmar que 005 es el siguiente libre (ls outbox) y fijar sourceRevision al commit 2f4ef6a.

## Blockers
Ninguno.

## Evidencia
git show 27c8519, git show 2f4ef6a, interoperability-contract.md §6.11 (749-862), system-contract.md DEC-FK-001/003/004 (364-386), outbox CS-CORE-20261008-001/002.
