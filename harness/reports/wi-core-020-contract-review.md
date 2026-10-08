Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# Revisión contractual WI-CORE-020

Alcance: commit 5ffcdee (código) y 2f4ef6a (spec INTEROP-2.7 §6.11) frente a INTEROP-2.7 §6.11, DEC-FK-001/003/004 y system-contract.md.

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
git show 5ffcdee, git show 2f4ef6a, interoperability-contract.md §6.11 (749-862), system-contract.md DEC-FK-001/003/004 (364-386), outbox CS-CORE-20261008-001/002.

---

## Revisión tras DEC-FK-005

Modelo: contract-reviewer · claude-sonnet-5-5 · effort low

Alcance: 42e214a (migración 20261008150000 + preflight + validación), 0c9965e (spec/CHANGELOG), CS-CORE-20261008-005/006/007.

### Resultado: APPROVED_WITH_NOTES

### Verificaciones
1. Sin cambio contractual: desde 2b0e89a el único cambio en `app/src` es `functional-knowledge-scenarios-migration.spec.ts` (prueba estática); INTEROP-2.7 y schema.prisma sin diff. DTO, rutas, enums, errores, auth y forma del 409 intactos. El 409 sigue siendo exclusivo del runtime (SUPERSEDE/KEEP_EXISTING); la migración falla con RAISE EXCEPTION, que no es una respuesta HTTP.
2. Contract Sync:
   - 005 (console, scopePaths INTEROP): sin cambios, sourceRevision 2f4ef6a, sigue válido.
   - 006: no alterado tras 547c6a3 (git log); sourceRevision 2b0e89a, targets [console, github-integration], scopePaths SYSTEM+INTEROP.
   - 007: documental, breaking false, targets [console, github-integration] correcto (ambos espejan SYSTEM), scopePaths [system-contract.md] correcto (INTEROP no cambió desde 2b0e89a), sourceRevision 0c9965e (verificado, es el commit que cierra DEC-FK-005). Declara que prevalece sobre la revisión SYSTEM de 006.
   - Espejo: SYSTEM de 0c9965e es la revisión canónica vigente (system-contract.md sin cambios posteriores). INTEROP se refresca desde 006 (2b0e89a), idéntico al HEAD.
3. Consistencia: system-contract DEC-FK-005, plan.md (línea 38) y CHANGELOG coinciden con la migración: aborta sin tocar status, listado ordenado por projectId, scope, targetKey, scenarioKey (ids por createdAt, id), re-ejecutable (IF NOT EXISTS), índice solo sin duplicados, preflight de solo lectura con mismo formato/orden (scenarioKey fijo LEGACY pre-migración). Desapareció la frase obsoleta de «DROP COLUMN no revierte SUPERSEDED».

### Findings (menores)
- Si 006 y 007 se importan en orden inverso, el espejo SYSTEM quedaría en 2b0e89a con DEC-FK-005 PENDING; 007 ya indica que prevalece. Acción: ninguna, solo cuidar el orden o importar 007 último.
- 007 declara «sustituye en la práctica» a 006 sin cambiar su status; es aceptable (006 sigue vigente para INTEROP).

### Blockers
Ninguno.

### Evidencia
git show 42e214a/0c9965e/ecb62db; git diff 2b0e89a HEAD -- INTEROP/app/src/schema; git log del outbox 006; migration.sql y preflight leídos; outbox 005/006/007.
