# Roadmap SDD 2.0

## Baseline histórica

SDD 1.16 y HU01-HU29 conservan la historia de la primera arquitectura. Sus capacidades se reevalúan en `spec/backlog-migration-sdd-2.0.md`; no determinan la prioridad por inercia.

## Frontend — mock-first

1. Migrar Developer Console a control plane con Projects, Runs, Action Required, Focus Mode e Integrations/GitHub.
2. Demostrar nueve escenarios SDD 2.0 mediante fixtures INTEROP-2.0 señalizados como demo.
3. Revisar UX/arquitectura y sustituir adapters mock por live progresivamente.

## Core — implementación real

1. Milestone A: AnalysisRun/state model, repository binding y Functional Knowledge.
2. Milestone B: GitHub App, webhooks verificados, normalization e idempotencia.
3. Milestone C: snapshot SHA, CHANGESET/INDEX DELTA, changed/impacted symbols.
4. Milestone D: functional retrieval, ACTION_REQUIRED y continuation jobs.
5. Milestone E: adapters PHP/Laravel/PHPUnit.
6. Milestone F: Checks, review/freshness y companion PR.

## Sandbox — implementación real

1. Preservar aislamiento y profile Node/TypeScript.
2. Adoptar INTEROP-2.0 y abstracción de execution profiles.
3. Implementar PHP, Composer, materialización Laravel-compatible y PHPUnit.
4. Normalizar evidence PHP y verificar integración real con Core.

## Puertas posteriores

Mutation testing (`DEC-MET-001`), VM remota (`DEC-INF-001`), validación empresarial (`DEC-VAL-001`) y paridad de Functional Knowledge en el experimento (`DEC-EXP-FK-001`) se resuelven solo antes del trabajo que bloquean.

No se inicia automáticamente ningún work item posterior hasta revisión humana de T-001/SDD 2.0.
