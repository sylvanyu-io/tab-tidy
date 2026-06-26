# Gateway Planner Scale Benchmark

Generated: 2026-06-26T06:16:05.588Z

This benchmark records a filtered planner strategy run. It uses synthetic metadata-only tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Thinking intensity: high
- Strategy filter: hierarchical
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T06-12-33-835Z.json`

## Results

| Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 120 | current hierarchical coarse/refine | ok | 20.5s | 1 | 9 | 108 | 12 | ok |
| 300 | current hierarchical coarse/refine | ok | 79.7s | 3 | 18 | 271 | 29 | ok |
| 400 | current hierarchical coarse/refine | ok | 111.6s | 11 | 29 | 396 | 4 | ok |

## Takeaways

- 120 tabs: hierarchical completed successfully in 20.5s with 1 request(s).
- 300 tabs: hierarchical completed successfully in 79.7s with 3 request(s).
- 400 tabs: hierarchical completed successfully in 111.6s with 11 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

