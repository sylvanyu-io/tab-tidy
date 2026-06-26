# Gateway Planner Scale Benchmark

Generated: 2026-06-26T06:34:02.132Z

This benchmark records a filtered planner strategy run. It uses synthetic metadata-only tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Thinking intensity: medium
- Strategy filter: hierarchical
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T06-32-53-023Z.json`

## Results

| Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 50 | current hierarchical coarse/refine | ok | 27.4s | 2 | 11 | 49 | 1 | ok |
| 120 | current hierarchical coarse/refine | ok | 41.7s | 2 | 12 | 120 | 0 | ok |

## Takeaways

- 50 tabs: hierarchical completed successfully in 27.4s with 2 request(s).
- 120 tabs: hierarchical completed successfully in 41.7s with 2 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

