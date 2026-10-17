# OE5 pilot evidence manifest proposal

**Status:** DRAFT 0.1 — operational proposal only; not frozen, not a product DTO, and not evidence of a completed run.

## Purpose and boundaries

This proposal consolidates the minimum trial fields from the Cross handoff, the PI2 evidence protocol, and thesis §3.3.14. It is intended to make each RAG/GENERALIST_AGENT pair reconstructable after the experiment. It does not extend Core's public Evidence v1 contract, publish logs or test source through an API, authorize an experiment, or replace `EV-OE5-01..06`.

The PO freezes the oracle separately before generation. The manifest carries its `oracle_id` and version/hash only; the oracle itself remains outside both strategy inputs and repository snapshots. Raw generated tests, traces, stdout/stderr, and runner reports belong in controlled private evidence storage, referenced by path/URI and SHA-256, not copied into a public DTO.

## Proposed record model

Use one **case manifest** plus one **trial record per strategy and repetition**. Field names below are proposed snake_case; `evidenceId` from the handoff maps to the thesis `evidence_id`.

| Group | Fields | Rules |
|---|---|---|
| Schema and identity | `schema_version`, `evidence_id`, `case_id`, `trial_id`, `pair_id` | `evidence_id` is stable in the academic register; `trial_id` is unique; one `pair_id` joins the two strategies for the same repetition. |
| Repository snapshot | `repository`, `branch`, `pull_request`, `base_sha`, `head_sha`, `effective_project_root`, `frozen_at` | The two arms in a pair use identical repo, `head_sha`, project root, and target. Preserve paths as repo-relative in evidence. |
| Target and oracle | `target_path`, `qualified_name`, `target_kind`, `stratum`, `oracle_id`, `oracle_version`, `oracle_sha256` | `oracle_id` references a separately approved instrument; never include oracle contents in the repository, prompt, retrieval context, or GA trace. |
| Experimental assignment | `strategy`, `repetition`, `attempt`, `pair_position`, `randomization_seed` | One strategy per trial; `strategy ∈ {RAG, GENERALIST_AGENT}`. Three repetitions per case/strategy. Order is fixed by recorded randomization. Proposed attempt numbering starts at 1. |
| Model and budgets | `provider`, `model`, `served_model`, `model_version`, `reasoning_effort`, `parameters`, `budgets` | Record configured values separately from observed values. Use `unknown` for served model when it cannot be observed; do not infer it from configuration. |
| Run and trace | `analysis_run_id`, `experiment_id`, `retrieval_context_ref`, `generalist_trace_ref`, `files_inspected`, `tool_calls` | Populate only the applicable arm-specific trace. Each reference includes a private location and SHA-256. Do not store chain-of-thought. |
| Generated test | `generated_test_ref`, `generated_test_sha256`, `generated_test_language`, `generated_test_framework` | Preserve the exact bytes presented to Sandbox, including any permitted deterministic wrapper; record any transformation separately. Never manually edit without an explicit versioned record. |
| Sandbox execution | `sandbox_execution_id`, `sandbox_profile`, `command`, `exit_code`, `stdout_ref`, `stderr_ref`, `runner_report_ref`, `duration_ms` | Artifacts remain private, with SHA-256. Record the effective command/profile and IDs; do not expose secrets, credentials, or raw contents in public evidence. |
| Technical result | `compiled`, `executed`, `passed`, `failure_category`, `failure_code`, `technically_evaluable`, `retry_reason` | A retry is allowed once only for a demonstrable external infrastructure failure, under the same configuration. Strategy-attributable failures are retained without retry. |
| Scoring | `vt`, `cf`, `co`, `scored_by`, `scored_at`, `scoring_notes_ref` | Post-generation human scoring against the frozen oracle. Keep not-evaluable separate from a failing test; do not treat execution pass as functional conformity. |
| Provenance | `created_at`, `verified_at`, `evidence_location`, `claim_supported` | Register each artifact/status and the concrete claim it supports. States follow the thesis register: `PLANIFICADA`, `DISPONIBLE`, `VERIFICADA`, or `NO DISPONIBLE`. |

## Pair integrity checks

Before either strategy runs, validate that both trial records share `case_id`, `pair_id`, repo, branch/PR, `base_sha`, `head_sha`, target, stratum, `oracle_id`/version/hash, model configuration, budgets, Sandbox profile, and seed. The only planned differences are `strategy`, strategy-specific traces, exact generated test, and resulting execution/scoring. Record `pair_position` before the run; do not reorder after observing output.

For the pilot size in Table 66, the planned dataset is 9 cases × 2 strategies × 3 repetitions = 54 trial records grouped into 27 pairs. This count remains blocked until the case/oracle discrepancy is resolved. A trial record must not be created with a placeholder oracle as if it were frozen.

## Freeze sequence

1. PO approves the nine case-to-target mappings and oracle contents; save the instrument outside the pilot repos and both strategy contexts.
2. Record and hash the protocol, oracle instrument, case manifests, and model/budget configuration.
3. Freeze repo/branch/PR/base SHA/head SHA and effective project root for each case.
4. Run the two arms in randomized pair order, retaining exact generated test, trace, Sandbox artifacts, and result.
5. Score CF/CO/VT afterward against the frozen oracle; register every artifact with an `evidence_id`.

No schema or product contract change is proposed by this draft. Any future public API exposure of additional evidence must go through contract review and Contract Sync independently.

