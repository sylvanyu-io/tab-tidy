# Combined adaptive planner correction

Date: 2026-06-26

## Why this exists

The product requirement was: one user action should produce one generated
preview containing both grouping recommendations and cleanup recommendations.

The implementation briefly misread that as: the product path must use exactly
one full-detail AI request. That was the wrong constraint. It disabled the
adaptive coarse/refine planner whenever cleanup analysis was enabled, even
though earlier benchmark evidence showed large inventories should keep the
adaptive harness.

## Incorrect state before this correction

Code path:

- `shouldUseHierarchicalPlanner()` returned `false` when
  `settings.analyzeCleanup` was enabled.
- Product-default 50+ tab sessions therefore stayed on the single full-detail
  route when cleanup was enabled.
- Documentation described the product default as "one full-detail planner
  request."

Evidence trail:

- `docs/combined-grouping-cleanup-planner-2026-06-26.md`
- `docs/agent-planner-optimization.md`
- `tests/gateway-planner.test.mjs`, previous test name:
  `AI gateway planner keeps 50-tab product sessions on the single full-detail path`

## Corrected behavior

Product semantics:

- One user-visible analysis job.
- One generated preview containing grouping and cleanup.
- Zero AI close-tab authority; cleanup remains explicit user action.

Implementation semantics:

- Below 50 tabs: one full-detail request.
- At 50+ tabs: coarse pass plus bounded bucket-worker refinement.
- The coarse pass creates broad grouping buckets only.
- Bucket workers can return both refined groups and cleanup candidates.
- Cleanup candidates are deduplicated and merged locally by priority and
  original tab order.
- Activity rows sent to a worker are filtered to that worker's bucket.

## Before/after comparison

| Area | Before | After |
| --- | --- | --- |
| Product promise | Grouping and cleanup share a preview | Same |
| Implementation interpretation | One preview meant one full-detail request | One preview can use multiple internal requests |
| 50+ tabs with cleanup enabled | Forced single full-detail route | Adaptive coarse/refine route |
| Coarse request | N/A on product path | Broad buckets only; no cleanup instructions |
| Worker request | N/A on product path | Refined groups plus bucket-local cleanup |
| Cleanup merge | Full-detail top-level cleanup only | Worker candidates deduped, priority sorted, order stable |
| Safety model | Local validation and explicit close | Same |

## Regression checks

Executed:

```bash
node --test tests/gateway-planner.test.mjs
```

Result:

- 34/34 passing.

New or updated coverage:

- 50-tab product sessions route through hierarchical workers with cleanup
  enabled.
- Coarse requests do not carry cleanup instructions.
- Refinement workers do carry cleanup instructions.
- Worker activity rows are bucket-local.
- Cleanup candidates from multiple workers merge into one preview and sort high
  priority before lower-priority candidates while remaining deterministic.

## Benchmark status

This correction restores the route supported by earlier measurements; it does
not claim a fresh live latency win yet.

Relevant prior measurement documents:

- `docs/benchmarks/small-session-hierarchical-threshold-2026-06-26.md`
- `docs/benchmarks/gateway-planner-before-after-parallel.md`
- `docs/benchmarks/adaptive-refine-experiment.md`

Next measurable comparison should run with grouping and cleanup both enabled:

```bash
BENCHMARK_STRATEGIES=auto,single_full_detail \
BENCHMARK_TAB_COUNTS=50,120,300,400 \
BENCHMARK_REPORT_PATH=docs/benchmarks/combined-adaptive-planner-after-correction.md \
npm run benchmark:planner-scale
```

Record latency, request count, validation status, grouped/review counts, cleanup
candidate count, and obvious over-splitting. Do not use passing unit tests as
performance evidence.
