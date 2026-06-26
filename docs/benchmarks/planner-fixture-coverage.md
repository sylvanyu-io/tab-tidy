# Planner Fixture Coverage

Generated: 2026-06-26

This document records the synthetic benchmark fixture upgrade. The goal is to keep planner optimization tied to measurable quality, not just latency.

## What Changed

- Added reusable fixture scenarios in `scripts/planner-benchmark-fixtures.mjs`.
- Updated `scripts/benchmark-gateway-planner-scale.mjs` so live gateway runs can select scenarios with `BENCHMARK_SCENARIOS`.
- Updated `scripts/analyze-planner-benchmark-quality.mjs` to prefer explicit fixture truth over URL-path inference.
- Added topic-level and family-level pairwise metrics.
- Added tests proving benchmark truth is not sent to the planner payload.

## Scenario Matrix

| Scenario | Covers | Why It Matters |
| --- | --- | --- |
| `task_bursts` | Natural tab order, mixed domains, semantic topics | Baseline working-session shape. |
| `domain_traps` | Same hosts across unrelated topics | Catches regressions back to domain-only grouping. |
| `low_signal_samples` | Generic titles plus page summaries | Tests whether optional page content actually improves classification. |
| `media_type` | Docs, papers, issues, videos, dashboards, shopping/account pages | Supports the media-type organizing preset. |
| `old_tabs` | Age/activity signals plus semantic topics | Supports cleanup recommendation evaluation. |
| `multi_window` | Related topics split across windows | Protects cross-window behavior. |

## How To Run

```bash
BENCHMARK_SCENARIOS=all \
BENCHMARK_TAB_COUNTS=50,120 \
BENCHMARK_STRATEGIES=hierarchical,single_full_detail \
npm run benchmark:planner-scale
```

For a focused smoke:

```bash
BENCHMARK_SCENARIOS=domain_traps,low_signal_samples \
BENCHMARK_TAB_COUNTS=24 \
BENCHMARK_STRATEGIES=single_full_detail \
GATEWAY_MODEL=gpt-5.4 \
npm run benchmark:planner-scale
```

Then compute quality:

```bash
node scripts/analyze-planner-benchmark-quality.mjs \
  docs/benchmarks/data/<run>.json \
  --output=docs/benchmarks/<run>-quality.md
```

## First Smoke Evidence

Run:

- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T07-07-15-167Z.json`
- Latency report: `docs/benchmarks/planner-fixture-coverage-smoke.md`
- Quality report: `docs/benchmarks/planner-fixture-coverage-smoke-quality.md`
- Correction: the `low_signal_samples` row in this first smoke had empty sample fields because the fixture did not match production page-sample shape. See `docs/benchmarks/page-summary-payload-fix.md`.

Results:

| Scenario | Tabs | Model | Strategy | Time | Topic F1 | Family F1 | Read |
| --- | ---: | --- | --- | ---: | ---: | ---: | --- |
| `domain_traps` | 24 | `gpt-5.4` | single full-detail | 89.8s | 85.7% | 51.4% | The planner avoided pure domain grouping but merged design/frontend. |
| `low_signal_samples` | 24 | `gpt-5.4` | single full-detail | 97.3s | 54.5% | 17.2% | Invalid as page-summary evidence; sample content was empty due fixture bug. |

## Decision

Do not change the default model or planning strategy from this smoke alone.

Evidence:

- The run proves the new scenario harness works end to end against the real product gateway.
- The two 24-tab requests were slow enough that one-off latency observations are not stable enough for a model switch.
- The low-signal page-summary scenario needs corrected payload evidence before any planner decision.

Next optimization should target page-summary payload quality and compare before/after metrics before reducing refinement or lowering model strength.
