# WI-CORE-017 — Verificación de la especificación

## Alcance
Preparar el SDD SMART V3 de Core sin tocar `app/`: contratos SYSTEM-2.6 e INTEROP-2.7, decisiones, specs/planes/tareas de 004, 008, 011, 013, 014, providers y experimental-metrics, registro de WI-CORE-018 a WI-CORE-029 y Contract Sync.

## Fuentes
`HANDOFF_CORE_V3_SDD_SMART.md` y los handoffs V3 de Console y GitHub Integration, contrastados con la spec y con el código de `develop` (`bebaf79`).

## Matriz handoff / spec / código
| Requisito | Estado SDD previo | Estado del código | Acción |
|---|---|---|---|
| `UNKNOWN` mantiene `ACTION_REQUIRED` y no continúa | Contradicción: el contrato decía que podía cerrar la pregunta | Contradicción: responde, reevalúa y encola continuación (`functional-knowledge.service.ts`) | DEC-FK-002, WI-CORE-018 |
| Activación exacta de `ACTION_REQUIRED` | Parcial | Por revalidar en WI-CORE-018 | WI-CORE-018 |
| Rol WRITER | Falta | Enum ADMIN/MAINTAINER/READER | DEC-ORG-003, WI-CORE-019 |
| Procedencia de FK | Falta | Sin `confirmedBy*`, `originHeadSha`, `sourceRef` | WI-CORE-019 |
| Varias reglas ACTIVE | Contradicción (una por scope+target) | `findActive` único | DEC-FK-001, WI-CORE-020 |
| `functionalRules` en `GenerationContext` | Falta | Sin coincidencias | WI-CORE-021 |
| OE2 SE vs SEM | Falta | Sin `RETRIEVAL_MODE` | WI-CORE-022 |
| Paridad `LLMProvider` | Parcial | `LLM_PROVIDER` existe, pero el agente lee razonamiento y usa OpenAI aparte | WI-CORE-023 |
| Tests existentes visibles para GA | Contradicción con DEC-EXP-002 §4 | n/a | DEC-EXP-003, WI-CORE-024 |
| Pareado, orden, seed, reintentos | Falta | Sin `pairId`/seed | WI-CORE-025 |
| Trace de nueve enlaces | Falta | `executionId` solo del Sandbox | WI-CORE-026 |
| Evidencia versionada y jerarquía CF/CO/VT | Falta | `validRate` como agregado | WI-CORE-027 |
| `DEC-EXP-FK-001` | PENDING | n/a | Cerrada |
| Herramientas de solo lectura de GA | Ya cumple (DEC-EXP-002) | `list_files`, `read_file`, `search_text`, `inspect_symbol` | Sin trabajo |
| AnalysisRun por repo/PR/HEAD | Ya cumple | Cerrado en WI-011/WI-014 | Sin trabajo |
| PHP estructural y OE5 PHP | Falta | Bloqueado por Sandbox | Diferidos (WI-CORE-028/029) |

## Decisiones
Ninguna decisión bloquea este WI. `DEC-INF-001` y `DEC-VAL-001` siguen `PENDING` y no alcanzan este corte. `DEC-EXP-FK-001`, `DEC-EXP-003`, `DEC-FK-001`, `DEC-FK-002` y `DEC-ORG-003` quedan `APROBADO` por el usuario el 2026-10-08.

## Contract Sync
Productor: Core. Consumidores: Console (importa SYSTEM-2.6 e INTEROP-2.7 y adopta WRITER, `UNKNOWN`, OE2, OE5, trace y evidencia) y GitHub Integration (importa los espejos; sin cambio funcional, el contrato GH-INTEROP-1.2 no cambia).

## Validación
Se ejecutan `node scripts/sdd-check.mjs`, `harness/validate-harness.mjs`, `harness/validate-work-items.mjs` y `harness/validate-completions.mjs`; no hay cambios en `app/`.

## Auditorías de preparación (sdd-analyst, solo lectura)
Antes: `READY_WITH_NOTES` 007, 019, 021, 023, 024; `NOT_READY` 018, 020, 022, 025, 026, 027, 004, 005, 008. Los huecos de diseño de 007 y 018 a 027 se cierran en este WI con los textos propuestos por los auditores y tres decisiones del usuario; 004, 005 y 008 quedan fuera del bloque por decisión del usuario. Cada WI de implementación conserva su propia verificación SDD al seleccionarse.
