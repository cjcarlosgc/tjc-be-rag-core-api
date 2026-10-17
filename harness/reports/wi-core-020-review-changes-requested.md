# WI-CORE-020 — CHANGES_REQUESTED del Human Reviewer

Modelo: leader (Sonnet 5.5 / Medium), trabajo documental y de estado; sin implementación.

## Veredicto humano
CHANGES_REQUESTED en dos puntos. El leader no emite ni sustituye el veredicto.

## Punto 3 (docs) — resuelto
- `DEC-FK-003` (SYSTEM), nota de versión SYSTEM-2.6, cabecera de INTEROP-2.7, tipos `scenarioKind`/`abstention`/`outcome` y HU09 (§6.11) alineados con la semántica implementada (aplicabilidad y conflicto por `scenarioKey`; varias `ACTIVE` por target con escenarios distintos). `plan.md` de 013 sin referencias transitorias a 018/020. Commit bdd5700.
- `CS-CORE-20261008-005` (INTEROP a Console) no se tocó. Como cambió la revisión canónica de los contratos, se emitió `CS-CORE-20261008-006` (documental, sin cambio funcional): Console (SYSTEM + INTEROP) y GitHub Integration (SYSTEM). Ningún otro repositorio fue modificado.

## Punto 1 (migración) — DECISION_REQUIRED, detenido
Motivos verificados en la spec y el esquema:
1. `FunctionalKnowledgeStatus` solo tiene `ACTIVE | SUPERSEDED`; la «resolución humana» de HU09 es un diálogo de runtime (`409` + `conflictResolution`), no un estado persistido. Marcar filas para resolución humana exige un estado nuevo (cambio de contrato).
2. `DEC-FK-004` solo fija `scenarioKey` al crear la pregunta; para reglas históricas define `LEGACY`. No hay derivación determinista del escenario real de datos existentes, así que la identidad histórica efectiva es `targetRef + LEGACY`.
3. Ninguna decisión define «semánticamente equivalentes».
Registrado `DEC-FK-005` (PENDING, `Blocks` solo cierre de WI-CORE-020) con opciones A (abortar con reporte, sin cambiar `status`; propuesta), B (A + equivalencia por `normalizedRule` normalizado) y C (nuevo estado de revisión humana, con contrato).

No se rediseñó la migración ni se escribió la consulta de solo lectura: su política depende de la opción. Mientras tanto la migración de 5ffcdee (supersede por target) NO debe desplegarse. No se tocó Supabase, producción ni `app/.env`.

## Estado
`W-DECISION_REQUIRED`, `blockingDecisionIds: [DEC-FK-005]`. Gates de revisión independiente y de decisiones en `G-FAILED`. Al elegir opción: implementer-high rediseña migración, consulta de solo lectura y pruebas (equivalentes, contradictorios, mismo target con escenarios distintos, sin datos) contra Postgres docker desechable; luego validate-harness, lint, test, build, e2e y retorno a `W-IN_REVIEW`.
