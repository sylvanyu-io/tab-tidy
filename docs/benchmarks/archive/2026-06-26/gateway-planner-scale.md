# Gateway Planner Scale Benchmark

Generated: 2026-06-26

This benchmark compares the current hierarchical coarse/refine planner path
against a forced single full-detail planner request. It uses synthetic
metadata-only tab inventories, so it measures gateway planning latency and
output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: `gpt-5.5`
- Thinking intensity: `high`
- Page content: metadata-only synthetic inventory
- Raw data:
  - `docs/benchmarks/data/planner-scale-2026-06-26T02-58-49-708Z.json`
  - `docs/benchmarks/data/planner-scale-2026-06-26T03-20-51-401Z.json`

## Results

| Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Notes |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 120 | current hierarchical coarse/refine | ok | 40.4s | 2 | 12 | 120 | 0 | coarse + one refinement |
| 120 | single full-detail request | ok | 77.5s | 1 | 9 | 106 | 14 | slower but valid |
| 300 | current hierarchical coarse/refine | ok | 57.7s | 1 | 10 | 300 | 0 | coarse result alone was accepted |
| 300 | single full-detail request | failed | 121.7s | 1 | - | - | - | underlying `fetch failed` before HTTP status |
| 400 | current hierarchical coarse/refine | failed | 240.0s | 9 | - | - | - | strategy-level benchmark timeout |
| 400 | single full-detail request | not completed | - | - | - | - | - | run interrupted before this leg completed |

## Takeaways

- The current large-tab path is not optimized. It can become too serial because
  refinement buckets are processed one after another.
- Single full-detail planning is not automatically faster. At 120 tabs it was
  1.92x slower than hierarchical; at 300 tabs it failed before returning an HTTP
  response.
- The current model/settings are probably too heavy for this classification
  task: `gpt-5.5` with `high` thinking is being used even though the task is
  mostly semantic classification and JSON normalization.
- The right direction is not simply "hierarchical vs single". It should be an
  adaptive harness: cheap routing/coarse pass, bounded parallel workers, local
  deterministic merge, validator repair, and measured fallback.

## Evidence Quality

- These are live gateway measurements, not mocked timings.
- Inputs are synthetic, so they do not prove quality on real user tab sets.
- The 400-tab comparison is incomplete because the run was interrupted after the
  hierarchical leg timed out. The partial failure is still useful because it
  shows the serial refinement path can exceed an acceptable wall-clock budget.

