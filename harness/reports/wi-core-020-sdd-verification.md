# WI-CORE-020 — Verificación de suficiencia SDD

Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-08. Solo lectura sobre `app/`, `state.json` y `work-items.json`; se añadió un bloque de detalle técnico a `spec/features/013-pr-driven-analysis/plan.md`.

## Resultado: SPEC_VERIFIED (sin bloqueos)

Verificaciones del rol: HU07 y HU09 pertenecen a HU01–HU18; `ST-CORE-027` existe en `tasks.md` de 013 (`T-READY`); componente CORE; sin `caseIds` OC; `WI-CORE-019` está W-DONE; `contractSyncReview` ya revisa CS-20260920-001 y CS-20260921-003 como NOT_RELEVANT.

## Decisiones aplicables

| ID | Estado | Blocks / alcance | ¿Bloquea? |
|---|---|---|---|
| DEC-FK-001 | APROBADO 2026-10-08 | varias ACTIVE por scenarioKey; conflicto solo con mismo scope+targetRef+scenarioKey | No |
| DEC-FK-003 | APROBADO | aplicabilidad = mismo target hasta WI-CORE-020, luego mismo scenarioKey | No |
| DEC-FK-004 | APROBADO (incl. normalización y mapeo) | derivación y backfill LEGACY | No |

DEC-FK-001/003/004 no declaran un campo `Blocks` explícito en el texto; todas están APROBADO. Ninguna PENDING/PROPOSED alcanza el WI. `decisionGate`: PASS; registrar los tres IDs en `state.json`.

## Matriz criterio -> spec -> código actual -> brecha

| Criterio | Spec | Código actual | Brecha |
|---|---|---|---|
| Herencia de scenarioKind/Key desde la pregunta | DEC-FK-004; plan 013 «Reglas por escenario»; INTEROP §6.11 | `FunctionalQuestion.scenarioKind/Key` existen y se rellenan (018). `resolveKnowledge` no copia nada; `FunctionalKnowledge` sin columnas | Añadir columnas y copiar de la pregunta; pregunta histórica -> LEGACY |
| findActive/conflicto por Project+scope+targetRef+scenarioKey + índice único parcial | DEC-FK-001; plan; INTEROP §6.11 (HU09) | `findActive(projectId, scope, targetRef)` con `findFirst`; índice no único `(projectId,scope,targetRef,status)`; `supersede` en `$transaction` sin captura de unicidad | Parámetro scenarioKey, índice único parcial, mapear P2002 a 409 |
| Listado/recuperación devuelve todas las ACTIVE; 409 conserva forma; aplicabilidad de 018 refinada | INTEROP §6.11; plan | `findByProjectForOwner` ya lista sin límite de una por target; evaluador llama `findActive` sin clave (`covered` por target) | Evaluador debe pasar `pending.scenarioKey`; DTO `toFunctionalKnowledgeResponse` sin los campos nuevos |
| Backfill reversible EXPECTED_RESULT/LEGACY | DEC-FK-004 | Ninguna migración; últimas: 20261008140000 (provenance) | Nueva migración (columnas, backfill, índice) |
| Pruebas y Contract Sync | WI AC5; plan | specs existen (`functional-knowledge.service.spec.ts`, `repository.spec.ts`, `functional-context-evaluator.service.spec.ts`, `controller.spec.ts`) | Ampliar; Contract Sync a Console |

## Mapa de archivos (app/)

- `prisma/schema.prisma`, nueva `prisma/migrations/<ts>_functional_knowledge_scenarios/migration.sql`.
- `src/functional-knowledge/functional-knowledge.repository.ts` (+ spec): findActive con clave, create/supersede con scenario y manejo de P2002.
- `src/functional-knowledge/functional-knowledge.service.ts` (+ spec): herencia y 409 en carrera.
- `src/functional-knowledge/functional-context-evaluator.service.ts` (+ spec): aplicabilidad por scenarioKey.
- `src/functional-knowledge/dto/functional-knowledge.response.ts` (+ controller spec): campos en la respuesta.
- Consumidores de `FunctionalKnowledge` fuera de la carpeta: solo código generado; confirmar con grep al implementar (no se halló otro).
- Spec: INTEROP §4/§6.11 marcar implementado al cerrar; CHANGELOG; `tasks.md` al cerrar.

## Cortes propuestos

1. Migración + schema + repositorio (columnas, backfill, índice parcial, findActive con clave, P2002). Refs: HU07, HU09.
2. Servicio + evaluador + DTO (herencia, aplicabilidad por clave, 409 en carrera, campos en respuesta). Refs: HU07, HU09.
3. Pruebas de determinismo/coexistencia/conflicto/supersede/carrera, cierre documental y Contract Sync a Console. Refs: HU07, HU09.
(Los cortes 1 y 2 pueden fusionarse; el repositorio no compila coherente sin el servicio si cambia la firma de findActive.)

## Ambigüedades y cierre

1. Regla desde pregunta histórica sin clave: detalle técnico -> LEGACY/EXPECTED_RESULT (cerrado en plan.md).
2. Datos existentes con más de una ACTIVE por target (el sistema no lo garantizaba por BD): el índice fallaría. Detalle técnico: paso previo que deja la más reciente ACTIVE (cerrado en plan.md). Si el usuario prefiere no mutar historia, es decisión suya; no se plantea porque la migración es reversible solo en columnas, no en el cambio de status (ver riesgos).
3. `targetRef` NULL en índice único: COALESCE en la expresión (cerrado en plan.md).
4. Forma del conflicto en carrera: se conserva la forma 409 con la regla ganadora (cerrado en plan.md).
5. KEEP_EXISTING + supersede cuando existe regla LEGACY y llega pregunta con clave real: coexisten (claves distintas); es consecuencia de DEC-FK-001, sin ambigüedad de producto, pero la regla LEGACY seguirá activa junto a las nuevas sin ser reemplazable por clave. Aceptado.

## Riesgos

- Migración: el paso que supersede duplicados ACTIVE no se revierte con DROP COLUMN; documentar. Backfill + NOT NULL en tabla pequeña, sin RLS nueva (no se crean tablas).
- Índice único parcial con expresión: Prisma no lo representa; riesgo de drift en `prisma migrate diff`. Documentar en schema; añadir prueba de integración si hay BD de test.
- Carrera: sin captura de P2002 la segunda respuesta devuelve 500; cubrir con prueba. `supersede` en `$transaction` array: si el nuevo create viola el índice, la transacción revierte el UPDATE (correcto).
- Retrocompatibilidad: los campos nuevos son aditivos en la respuesta; Console debe tolerar su ausencia hasta el sync. Preguntas históricas en vuelo (scenarioKey nulo) producen reglas LEGACY: una sola LEGACY por target, coherente con la cobertura total del target de 018.
- Evaluador: con varias ACTIVE por target, la lógica `covered` por clave evita preguntas repetidas; verificar que un target con regla LEGACY y construcciones nuevas siga preguntando (LEGACY no cubre claves reales).
- Contract: impacto contractual (respuesta de reglas); recomendar contract-reviewer/Contract Sync de implementación a Console antes de cerrar.
