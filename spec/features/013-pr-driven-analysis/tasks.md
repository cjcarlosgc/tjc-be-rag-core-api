# 013 — Tareas

## Baseline T-001

- [x] Consolidar SYSTEM-2.2 e INTEROP-2.2 y sincronizar mirrors.
- [x] Re-baselinar backlog y registrar KEEP/ADAPT/DEFER/DROP.
- [x] Homologar SDD 2.0, constituciones, state y CHANGELOG en los tres repositorios.
- [x] Verificar los 15 casos, decisiones pendientes y ausencia de contradicciones legacy.
- [x] Registrar evidencia de T-001 sin iniciar implementación posterior.

## Implementación posterior — requiere selección/aprobación humana

- [x] HU30: repository binding user-centric: discovery OAuth efímero, validación de GitHub App por repositorio, ramas por installation token y `integrationBranch` obligatoria sin default. Smoke test end-to-end contra Render+Supabase+GitHub reales confirmado para verify-app-access/branches/create binding; discovery (`GET /integrations/github/repositories`) sigue sin probarse porque requiere login GitHub OAuth real (provider token) — ver `harness/state.json`.
- [x] HU31-HU32: dominio AnalysisRun, webhook y lifecycle PR/HEAD sobre bindings habilitados (firma HMAC, idempotencia por delivery, normalización `pull_request` opened/synchronize/edited/converted_to_draft/closed, chequeo de `integrationBranch`, `startRun`/`closeRun` — ver `github-webhooks.service.ts`). Pendiente real: revocación (`installation`/`installation_repositories` no se procesan, un binding no pasa a `REVOKED`/`DISABLED` cuando GitHub avisa que la App perdió acceso).
- [ ] HU31: revocación de instalación (ver nota anterior).
- [x] HU33-HU34: CHANGESET, INDEX DELTA, símbolos cambiados/impactados (reindexado completo del árbol en cada Run vía GitHub API real; sin persistencia incremental optimizada todavía — ver `snapshot-analysis-job.handler.ts`).
- [x] HU35-HU36: Functional Knowledge versionada (ACTIVE/SUPERSEDED), disparo de ACTION_REQUIRED por símbolo DIRECTLY_CHANGED sin cobertura, preguntas adaptativas una a la vez, conflicto HU51 (§6.11) y continuation job. Simplificaciones documentadas: sin normalización semántica de `normalizedRule` vía LLM, sin `visualAid`, conflicto por match exacto de scope+símbolo (sin jerarquía PROJECT⊃MODULE⊃CLASS) — ver `harness/state.json`.
- [x] Validation (plan.md corte #6, sin HU propia — soporta HU32/HU39/HU40): genera y valida pruebas (arm RAG) para símbolos DIRECTLY_CHANGED METHOD/FUNCTION cubiertos por Functional Knowledge y sin test existente; corre en Sandbox, clasifica el Run (SUCCESS/BEHAVIORAL_MISMATCH/TECHNICAL_GENERATION_FAILURE/NO_ADDITIONAL_TESTS_REQUIRED) y persiste `GeneratedTestProposal`. Cierra el hueco "Run queda en PROCESSING" de HU33-36. Simplificaciones documentadas: sin baseline real (`phase=BASELINE` del contrato Sandbox 2.0 no existe en `SandboxExecutionService`, requiere migración coordinada con el repo del Sandbox — un símbolo con test existente se salta sin confirmar que siga en verde, sin `BASELINE_FAILED` todavía); `TEST_ASSERTION` se clasifica como BEHAVIORAL_MISMATCH y `COMPILATION`/`TEST_RUNTIME`/config como TECHNICAL_GENERATION_FAILURE sin juicio semántico vía LLM; solo arm RAG (GENERALIST_AGENT queda reservado para HU19); símbolos en serie — ver `harness/state.json`.
- [ ] HU39-HU40: Checks, review, freshness y companion PR (contrato §6.12 ya definido salvo lista explícita de errores de dominio; ahora sí hay `GeneratedTestProposal`/Run `SUCCESS` reales que publicar — ver `GET .../test-proposals` ya implementado).
- [ ] HU41-HU42: adapters PHP/Laravel/PHPUnit en Core.
