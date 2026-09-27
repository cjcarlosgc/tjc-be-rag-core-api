# Contract Sync CS-CORE-20260926-001

- **Work item:** `WI-CORE-003`
- **Source revision:** `e610677c266ad174ee57df799014c98ea7ae8553`
- **Target:** Console
- **Scope:** `spec/contracts/interoperability-contract.md`
- **Breaking:** no
- **Status at publication:** `C-PENDING`

Core published the clarification that `GET /action-required` contains only `PENDING` questions linked to a current `ACTION_REQUIRED` run. Console must update its INTEROP-2.5 mirror byte-for-byte and verify no client-side cache keeps stale items actionable. Any required UI adaptation belongs in a separate local Console work item.

This report proves publication only. It does not claim that Console acknowledged/resolved the event, that the mirrors are synchronized, or that `WI-CORE-003` is ready to close.
