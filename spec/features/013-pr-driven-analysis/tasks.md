# 013 — Tareas

## Baseline T-001

- [x] Consolidar SYSTEM-2.2 e INTEROP-2.2 y sincronizar mirrors.
- [x] Re-baselinar backlog y registrar KEEP/ADAPT/DEFER/DROP.
- [x] Homologar SDD 2.0, constituciones, state y CHANGELOG en los tres repositorios.
- [x] Verificar los 15 casos, decisiones pendientes y ausencia de contradicciones legacy.
- [x] Registrar evidencia de T-001 sin iniciar implementación posterior.

## Implementación posterior — requiere selección/aprobación humana

- [x] HU30: repository binding user-centric: discovery OAuth efímero, validación de GitHub App por repositorio, ramas por installation token y `integrationBranch` obligatoria sin default. Smoke test end-to-end contra Render+Supabase+GitHub reales confirmado para verify-app-access/branches/create binding; discovery (`GET /integrations/github/repositories`) sigue sin probarse porque requiere login GitHub OAuth real (provider token) — ver `harness/state.json`.
- [ ] HU31-HU32: dominio AnalysisRun, webhook y lifecycle PR/HEAD sobre bindings habilitados.
- [ ] HU31: GitHub App real, webhooks, idempotencia y revocación.
- [x] HU33-HU34: CHANGESET, INDEX DELTA, símbolos cambiados/impactados (reindexado completo del árbol en cada Run vía GitHub API real; sin persistencia incremental optimizada todavía — ver `snapshot-analysis-job.handler.ts`).
- [x] HU35-HU36: Functional Knowledge versionada (ACTIVE/SUPERSEDED), disparo de ACTION_REQUIRED por símbolo DIRECTLY_CHANGED sin cobertura, preguntas adaptativas una a la vez, conflicto HU51 (§6.11) y continuation job. Simplificaciones documentadas: sin normalización semántica de `normalizedRule` vía LLM, sin `visualAid`, conflicto por match exacto de scope+símbolo (sin jerarquía PROJECT⊃MODULE⊃CLASS) — ver `harness/state.json`. Cuando hay contexto suficiente el Run queda en PROCESSING: retrieval/generación (HU37+) no existen todavía.
- [ ] HU39-HU40: Checks, review, freshness y companion PR.
- [ ] HU41-HU42: adapters PHP/Laravel/PHPUnit en Core.
