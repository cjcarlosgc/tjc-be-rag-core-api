# 013 — Tareas

## Baseline T-001

- [x] Consolidar SYSTEM-2.2 e INTEROP-2.2 y sincronizar mirrors.
- [x] Re-baselinar backlog y registrar KEEP/ADAPT/DEFER/DROP.
- [x] Homologar SDD 2.0, constituciones, state y CHANGELOG en los tres repositorios.
- [x] Verificar los 15 casos, decisiones pendientes y ausencia de contradicciones legacy.
- [x] Registrar evidencia de T-001 sin iniciar implementación posterior.

## Implementación posterior — requiere selección/aprobación humana

- [ ] HU30: repository binding user-centric: discovery OAuth efímero, validación de GitHub App por repositorio, ramas por installation token y `integrationBranch` obligatoria sin default.
- [ ] HU31-HU32: dominio AnalysisRun, webhook y lifecycle PR/HEAD sobre bindings habilitados.
- [ ] HU31: GitHub App real, webhooks, idempotencia y revocación.
- [x] HU33-HU34: CHANGESET, INDEX DELTA, símbolos cambiados/impactados (reindexado completo del árbol en cada Run vía GitHub API real; sin persistencia incremental optimizada todavía — ver `snapshot-analysis-job.handler.ts`).
- [ ] HU35-HU36: Functional Knowledge, Action Required y continuation.
- [ ] HU39-HU40: Checks, review, freshness y companion PR.
- [ ] HU41-HU42: adapters PHP/Laravel/PHPUnit en Core.
