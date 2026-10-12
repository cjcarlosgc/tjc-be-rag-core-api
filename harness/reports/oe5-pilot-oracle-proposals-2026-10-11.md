# OE5 pilot oracle proposals for PO validation

**Status:** DRAFT — not approved, not frozen, and not authorized for experimental runs.

**Authority:** Jean is the functional authority/PO for the controlled pilot in `tjc-piloto-ventas`, `tjc-piloto-reservas`, and `tjc-piloto-suscripciones`. This authority does not extend to the confirmatory enterprise evaluation; there the company's PO or another authorized functional actor validates expected behavior.

## Basis and guardrails

The source thesis, Anexo K, Table 66, lists eight atomic behaviors: two for Sales/Discounts, three for Reservations, and three for Subscriptions, while stating a design of nine cases. Core's current `spec/features/008-experimental-comparison/spec.md` separately fixes nine case IDs, targets, and strata. These mappings must be reconciled, not silently changed. The thesis §3.3.6 requires target, preconditions, input, expected behavior, expected result, and source; the PO validates behavior and the oracle stays outside both strategy inputs. The PI2 evidence protocol further requires freezing the case/snapshot/oracle before either arm sees the test.

No pilot run was performed for this proposal. The three repositories remain at their base `main` SHAs, each with an untracked `public/index.php` outside that Git snapshot. No oracle has an approved `oracleId`; the IDs below are temporary labels only.

## Proposed records

| Case / draft ID | Canonical target and stratum | Preconditions and input proposal | Expected behavior and result from Table 66 | Source and PO decision needed |
|---|---|---|---|---|
| SAL-1 / `DRAFT-SAL-1` | `DiscountCalculator::applyPercentage()` — Local | `amount=200.00`; `percentage=15`; call `applyPercentage(200.00, 15.0)`. | Apply a 15% reduction once; result `170.00`. This isolates arithmetic, not the business rule that grants Premium a 15% rate. | Table 66 says Premium S/200 → 15% (S/170); pilot method signature/implementation. Confirm whether this local case is an acceptable decomposition of the Premium scenario and whether the displayed result is pre-tax. |
| SAL-2 / `DRAFT-SAL-2` | `DiscountPolicy::discountFor()` — Functional | Proposed isolation input: `Customer(premium=true)`, no active promotion. | Return a discount rate of `15.0` for Premium; at a S/200 base that implies S/170 before tax. | Table 66 says Premium S/200 → 15%. Confirm that 15% is the Premium rule without requiring a promotion. Base code currently returns 10% for Premium, so this is a known expected-vs-baseline difference, not a reason to change the oracle. |
| SAL-3 / `DRAFT-SAL-3` | `OrderPricingService::calculateTotal()` — Structural | Proposed isolation input: non-Premium customer, no promotion, one line with quantity 1 and unit price S/199.99; existing `TaxPolicy` is 18%. | Table 66 says “S/199.99 sin descuento”: expected discount rate `0%`. Under the current tax-inclusive service, candidate total is S/235.99 (S/199.99 + S/36.00 tax), but Table 66 does not say whether its amount is pre-tax or total. | Table 66's second Sales behavior + pilot `TaxPolicy`/pricing code. Confirm customer/promotion preconditions and whether “sin descuento” is scored on discount rate or final total. This maps an existing behavior to the third Sales target; it does not add a third business behavior. |
| RES-1 / `DRAFT-RES-1` | `ReservationPeriod::durationMinutes()` — Local | No input proposed. | Table 66 gives no duration behavior or result for this target. | No matching behavior in Table 66. PO must either identify an already-authorized mapping/source or leave this target/case unresolved; Cross will not invent a duration oracle. |
| RES-2 / `DRAFT-RES-2` | `AvailabilityService::canReserve()` — Structural | Candidate pair of inputs: existing confirmed interval `[10:00,11:00)` and request `[10:30,11:30)`; then request `[11:00,12:00)`. Resource active and party within capacity. | Overlap rejects (`false`); adjacency accepts (`true`). Half-open endpoint notation and exact times are proposed to make the cases reproducible, not stated in Table 66. | Table 66. Confirm interval boundary semantics and whether the two behaviors may be represented under this target. Current code delegates overlap to `ReservationRepository::hasConfirmedOverlap`; no concrete repository implementation was found, so a mock alone would not validate end-to-end overlap semantics. |
| RES-3 / `DRAFT-RES-3` | `CancellationPolicy::refundAmount()` — Functional | `paidAmount=100.00`; cancellation occurs 23 hours before reservation start (a proposed representative input for `<24 h`). | Refund 50%; result S/50.00. | Table 66. Confirm 23h as representative and that the expected result is a 50% refund. Base code instead returns S/0 before 48h and full paid amount from 48h; PO approval must decide which behavior is authoritative for the pilot. |
| SUB-1 / `DRAFT-SUB-1` | `PlanPriceCalculator::monthlyAmount()` — Local | Candidate input `licenses=1`, `unitPrice=60.00`. | Monthly amount S/60.00. Table 66 describes this in the context of an active renewal, while this local target only computes a price. | Table 66 + pilot calculator. Confirm this local calculation is an acceptable decomposition of “renovación activa S/60”; it does not test active status or a charge. |
| SUB-2 / `DRAFT-SUB-2` | `RenewalService::renew()` — Structural | Active subscription; plan monthly price S/60.00; gateway succeeds; fixed next-billing timestamp. | Charge S/60.00 and advance/save the renewal. Exact date behavior should follow the approved billing-date rule. | Table 66 + pilot service. Confirm active-state precondition and whether charging plus schedule advancement are the required observable results. Current method charges unconditionally, including cancelled subscriptions. |
| SUB-3 / `DRAFT-SUB-3` | `Subscription::handleFailedPayment()` — Functional | No input proposed. | Table 66 says a pending S/90 plan becomes effective at renewal; this target only handles payment failure. | No mapping demonstrated. `SubscriptionStatus` has no `PENDING` value and the target is unrelated to applying a pending plan. PO must identify a source-backed mapping or leave the case unresolved; no new behavior/target will be inferred. |

## Unassigned Table 66 behavior

“Cancelled subscription is not charged” has no unambiguous one-to-one case assignment in the canonical target list. `RenewalService::renew()` is a plausible place to observe charging, but it is already the proposed active-renewal target in SUB-2. Please confirm whether SUB-2 is one multi-scenario oracle or whether the case mapping in Core's SDD is inconsistent with Table 66. Do not duplicate a target or change a case ID without approval.

## Gate 0 decision list

1. Confirm whether the three Sales targets intentionally decompose the two listed behaviors as proposed, including the tax interpretation for S/199.99.
2. Resolve the unmapped `RES-1`, the missing concrete overlap repository behavior, and the 50% cancellation rule versus the current 48-hour full-or-zero implementation.
3. Resolve how the cancelled/no-charge and pending/S90 subscription behaviors map to SUB-1…SUB-3; confirm what `pending` means, since it is absent from the code model.
4. Confirm the interpretation of nine cases versus the eight behaviors listed in Table 66.
5. After approval, create the separate oracle instrument, record its version/hash and authorization, then freeze repo/branch/PR/baseSha/headSha and manifests before any pilot strategy observes or generates tests.

