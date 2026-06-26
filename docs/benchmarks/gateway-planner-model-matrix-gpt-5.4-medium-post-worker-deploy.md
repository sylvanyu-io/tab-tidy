# Gateway Planner Scale Benchmark

Generated: 2026-06-26T06:48:46.002Z

This benchmark records a filtered planner strategy run. It uses synthetic metadata-only tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Strategy filter: hierarchical
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T06-47-42-153Z.json`

## Results

| Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 50 | current hierarchical coarse/refine | ok | 27.1s | 2 | 12 | 50 | 0 | ok |
| 120 | current hierarchical coarse/refine | ok | 36.7s | 2 | 12 | 120 | 0 | ok |

## Takeaways

- 50 tabs: hierarchical completed successfully in 27.1s with 2 request(s).
- 120 tabs: hierarchical completed successfully in 36.7s with 2 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

