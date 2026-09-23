# T-003-org-workspaces — estado archivado (2026-09-21)

El work item terminó en `DONE` en `feature/T-004`. Alcance: HU55 y HU58-HU64 (workspaces personal y de organización, roles derivados de GitHub, acceso revocable, login solo GitHub, restricciones de binding, webhooks y reconciliación).

Commits funcionales principales: `6236255`, `8ad4fa5`, `f1eed4d`, `c0844af`, `81419ae`, `2c81f39`, `8f6e6b8`, `5e537f3`, `f33a78d`, `39d6414` y `1118326`; evidencia final consolidada en `ce2fc04` y `550bcfe`. La rama incorporó después `56301b5` (ACK de Console) antes de publicar el sync del bundle B.

El usuario confirmó las decisiones derivadas (aa)-(ac) de `DEC-ORG-002` tal cual: lista de owners vacía y listado truncado usado para negar se tratan como no verificables; un fallo determinista de reverificación sigue los reintentos normales.

Verificación final: `node harness/validate-harness.mjs` aprobado; `npm run lint`, `npm test` (1096 passed, 36 skipped), `npm run build` y `npm run test:e2e` (211 passed) aprobados. El checkpoint `before-done` devolvió `relevantPendingSyncIds: []` el `2026-09-22T00:34:47.995Z`.

`CONTRACT_SYNC` publicados a Console: `CS-20260921-001`, `CS-20260921-002` y `CS-20260921-003`. El último corresponde a la implementación del bundle B, usa `sourceRevision: 56301b5` y su outbox se creó el `2026-09-21T19:34:06-05:00`.

No se hizo push, PR, merge, despliegue ni migración desde este cierre.

## Validación post-despliegue (2026-09-23)

El usuario confirmó que el PR del bundle B fue fusionado y desplegado. Verificación de solo lectura contra la base compartida: las migraciones `20260921140000_project_workspace_columns`, `20260921150000_project_access` y `20260921160000_jobs_dedupe_key` constan aplicadas el 2026-09-21 a las `19:40:23Z`, `19:40:31Z` y `19:43:55Z`, respectivamente. Las tablas `projects`, `project_access` y `jobs` tienen RLS habilitado.

Con una identidad GitHub real vinculada y la GitHub App instalada en `rag-tesis-org` con permiso `Members: read`, una ejecución temporal de la API construida realizó `GET /workspaces` autenticado y obtuvo `200`: devolvió el workspace personal `72415400` y el workspace de organización `rag-tesis-org` (`330283583`), ambos con rol `ADMIN`. No se modificaron datos ni se reabrió la implementación de Core.

Estado al archivar:

```json
{
  "id": "T-003-org-workspaces",
  "storyIds": ["HU58", "HU59", "HU60", "HU61", "HU62", "HU63", "HU64", "HU55"],
  "sprint": "T-003",
  "status": "DONE",
  "gates": {
    "sddVerified": "PASSED",
    "implementationCompleted": "PASSED",
    "independentReviewPassed": "PASSED",
    "technicalChecksPassed": "PASSED",
    "contractReviewed": "PASSED",
    "canonicalContractSynced": "PASSED",
    "contractSyncPublished": "PASSED",
    "interopSyncChecked": "PASSED",
    "noBlockingDecisions": "PASSED",
    "retryLimitRespected": "PASSED"
  },
  "coordination": {
    "contractImpact": true,
    "publishedSyncIds": ["CS-20260921-001", "CS-20260921-002", "CS-20260921-003"],
    "pendingRelevantSyncIds": []
  }
}
```
