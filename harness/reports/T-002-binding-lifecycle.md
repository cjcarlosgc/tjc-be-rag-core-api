# T-002-binding-lifecycle — estado archivado (2026-09-20)

`harness/state.json` admite un solo `activeWorkItem`. Este work item terminó en `DONE` y se archiva aquí para abrir `T-003-org-workspaces` en `feature/T-003`.

Alcance: HU56 (borrado lógico de Project) y HU57 (`REPOSITORY_ALREADY_BOUND`, `enable` y pausa reversible del binding). Un ciclo de corrección de los dos permitidos. Commits: `caa4336` (spec SYSTEM-2.3/INTEROP-2.3), `16da507` (HU57), `77cab80` (HU56), `362198a` (hallazgos de revisión), `695a82b` y `8dc8a07` (cierre), `a9a9307` (migraciones aplicadas a Supabase, publicado en origin/feature/T-002). Verificación final: lint, 479/479 tests, e2e 8/8 y build. `CONTRACT_SYNC` publicados a Console: CS-20260920-002 y CS-20260920-003. Migraciones aplicadas a Supabase el 2026-09-20.

Estado al archivar:

```json
{
  "id": "T-002-binding-lifecycle",
  "storyIds": [
    "HU56",
    "HU57",
    "HU30"
  ],
  "sprint": "T-002",
  "status": "DONE",
  "approved": true,
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
    "pullCheckpoints": [
      {
        "checkpoint": "start",
        "checkedAt": "2026-09-20T01:03:54-05:00",
        "relevantPendingSyncIds": []
      },
      {
        "checkpoint": "contract-approval",
        "checkedAt": "2026-09-20T02:00:00-05:00",
        "relevantPendingSyncIds": []
      },
      {
        "checkpoint": "implementation-delivery",
        "checkedAt": "2026-09-20T06:18:12.115Z",
        "relevantPendingSyncIds": []
      },
      {
        "checkpoint": "implementation-delivery",
        "checkedAt": "2026-09-20T06:27:36Z",
        "relevantPendingSyncIds": []
      },
      {
        "checkpoint": "before-done",
        "checkedAt": "2026-09-20T06:33:05.027Z",
        "relevantPendingSyncIds": []
      }
    ],
    "publishedSyncIds": [
      "CS-20260920-002",
      "CS-20260920-003"
    ],
    "pendingRelevantSyncIds": []
  }
}
```
