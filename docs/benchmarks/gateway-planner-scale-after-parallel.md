# Gateway Planner Scale Benchmark

Generated: 2026-06-26T05:07:41.495Z

This benchmark records a filtered planner strategy run. It uses synthetic metadata-only tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Thinking intensity: high
- Strategy filter: hierarchical
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T05-03-27-199Z.json`

## Results

| Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 120 | current hierarchical coarse/refine | ok | 64.5s | 2 | 9 | 108 | 12 | ok |
| 300 | current hierarchical coarse/refine | ok | 66.0s | 2 | 12 | 300 | 0 | ok |
| 400 | current hierarchical coarse/refine | ok | 123.8s | 11 | 89 | 351 | 49 | ok |

## Takeaways

- 120 tabs: hierarchical completed successfully in 64.5s with 2 request(s).
- 300 tabs: hierarchical completed successfully in 66.0s with 2 request(s).
- 400 tabs: hierarchical completed successfully in 123.8s with 11 request(s).
- This is an after-change hierarchical-only run. Use `gateway-planner-before-after-parallel.md` for the before/after comparison.

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.
