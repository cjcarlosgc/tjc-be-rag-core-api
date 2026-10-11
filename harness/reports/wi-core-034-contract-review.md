[contract-reviewer::GPT-6 Luna / high] · WI-CORE-034 · Revisión contractual
Modelo: contract-reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo high

status: APPROVED

findings:
- Los contratos canónicos implementan fielmente DEC-CHECK-001: identidad lógica por repositorio GitHub estable + GitHub App + `headSha` + `name` exacto; reserva/persistencia durable; unicidad y convergencia concurrente; actualización de un único candidato existente; no crear/actualizar si hay más de un candidato, con `GITHUB_CHECK_IDENTITY_AMBIGUOUS` 409 y `retryable: false` hasta reconciliación operativa. El mecanismo de unicidad, bloqueo y recuperación queda a GitHub Integration, no se sobreespecifica en Core.
- Se mantiene la superficie publicada por GH-INTEROP-1.3: misma ruta privada, request y respuesta `200 { checkId }`; `204` permanece tolerado por Core como `checkId: null`. El cambio documentado es semántico, no una ampliación de DTO/ruta ni de errores preexistentes, salvo el error específico de identidad ambigua.
- La propagación observada es coherente con el protocolo: `CS-CORE-20261010-001/002` están importados y `C-ACKNOWLEDGED` en el inbox de GitHub Integration; `CS-CORE-20261010-003` está importado y `C-RESOLVED` en el inbox de Console. En Core, `CS-GH-20261010-001` está `C-ACKNOWLEDGED`, no `C-RESOLVED`.
- Riesgo de estado separado de este veredicto contractual: ambos consumidores tienen los tres espejos byte por byte iguales a Core, pero sus archivos de contrato aparecen modificados y sin commit en sus worktrees. La evidencia prueba igualdad de contenido en los worktrees actuales, no persistencia en commits.
- El ACK de GitHub Integration NO acredita implementación de `WI-GH-012`: su `harness/work-items.json` local sigue en `W-DECISION_REQUIRED`; su reporte indica explícitamente que el acuse solo acepta el cambio y que el WI espera evidencia de cierre/aprobación del WI fuente y nueva revisión contractual local. No se infiere implementación por el ACK ni por los hashes.

blockers:
- Ninguno para la coherencia contractual revisada. Este APPROVED no cierra `WI-CORE-034`, no resuelve el `CS-GH-20261010-001` entrante y no certifica implementación de `WI-GH-012`.

filesAffected:
- `spec/contracts/github-integration-contract.md`
- `spec/contracts/system-contract.md`
- `spec/contracts/interoperability-contract.md`
- `spec/features/016-github-integration/spec.md`
- `CHANGELOG.md`
- `harness/contract-sync/outbox/CS-CORE-20261010-001.yaml`
- `harness/contract-sync/outbox/CS-CORE-20261010-002.yaml`
- `harness/contract-sync/outbox/CS-CORE-20261010-003.yaml`
- `harness/contract-sync/inbox/CS-GH-20261010-001.yaml`
- `../tjc-be-github-integration-api/harness/contract-sync/inbox/CS-CORE-20261010-001.yaml`
- `../tjc-be-github-integration-api/harness/contract-sync/inbox/CS-CORE-20261010-002.yaml`
- `../tjc-be-github-integration-api/harness/reports/wi-gh-012-contract-sync-acknowledgement.md`
- `../tjc-fe-rag-developer-console/harness/contract-sync/inbox/CS-CORE-20261010-003.yaml`
- `../tjc-fe-rag-developer-console/harness/reports/wi-console-020-contract-sync-acknowledgement.md`

evidence:
- `spec/features/016-github-integration/spec.md`: DEC-CHECK-001 is marked APROBADA por el usuario (2026-10-10); fija identidad/durabilidad/concurrencia y delega la solución de persistencia/bloqueo a GitHub Integration.
- `spec/contracts/github-integration-contract.md:3,53,124,143`: GH-INTEROP-1.4 status, endpoint/route table, unmodified request with `200 { checkId }` and tolerated `204`, and error semantics for ambiguous duplicate candidates.
- `spec/contracts/system-contract.md:412`: SYSTEM-2.6 references `WI-CORE-034`/`DEC-CHECK-001`, explicitly preserves Core's `204` compatibility, and does not declare GH implementation or deployment complete.
- `spec/contracts/interoperability-contract.md:1143,1168`: operational trace reads GH `checkId`; it remains nullable while GH responds `204` or does not report it.
- `CHANGELOG.md:3` records the approved contract clarification and expressly says no input DTO, route, deployment or cutover change.
- `git show 46c7046 --` for the three contracts: Check request fields, route, and success shape are preserved; changes add identity semantics, one ambiguity error, and references/version history. `git cat-file -e 46c7046d015d18e49b0e737f6b61cceef1d6889c^{commit}` resolves the outbox `sourceRevision` locally.
- Core outbox events `CS-CORE-20261010-001/002/003.yaml` all name `WI-CORE-034`, use the same source revision, and target GH for the first two, Console for the third. The producer-side outbox remains C-PENDING; the protocol records consumer transitions in each consumer inbox, so that alone is not treated as a failed import.
- GitHub Integration inbox `CS-CORE-20261010-001/002.yaml` reports `C-ACKNOWLEDGED` and links `wi-gh-012-contract-sync-acknowledgement.md`. That report says ACK means taking responsibility, not implementing `checkId`; current `WI-GH-012` is `W-DECISION_REQUIRED`.
- Console inbox `CS-CORE-20261010-003.yaml` reports `C-RESOLVED`; `wi-console-020-contract-sync-acknowledgement.md` records `cmp` verification and explicitly limits resolution to the three contract mirrors, with no code/deploy/cutover.
- SHA-256 equality, canonical vs both consumer worktrees: GH contract `24ba51156cf3d98edbbca836cc4563981a6f5df2b9adf2df9d0c3bd84f605e0a`; SYSTEM `52f98f596c3d4efe900739b68cdb43f30716cbfe681edbd87ffae3a6c903ccf8`; INTEROP `20adb87240b479b801f57febd18d3b8020efffaa6749b3157ebb7211a9835143`. Both consumer `git status --short -- spec/contracts/...` report those mirror files modified, not committed.
- Core `CS-GH-20261010-001.yaml` remains `C-ACKNOWLEDGED`; Core state at review time has WI-CORE-034 `W-SPEC_VERIFIED`, so this report does not claim its delivery/closure checkpoints have passed.

recommendedNextStep:
- Continuar con los gates y la revisión humana/cierre de `WI-CORE-034`; al llegar a `implementation-delivery`/`before-review`/`before-done`, registrar la resolución de `CS-GH-20261010-001` solo con evidencia canónica y cumplir Contract Sync. Mantener `WI-GH-012` como pendiente hasta que su propio Harness y evidencia local confirmen lo contrario; antes de dar por durable la propagación, pedir/confirmar que los mirrors modificados se guarden en sus respectivos repositorios.
