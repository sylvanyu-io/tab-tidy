# Gateway Planner Scale Benchmark

Generated: 2026-06-26T06:12:18.605Z

This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request. It uses synthetic metadata-only tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Thinking intensity: high
- Strategy filter: none
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T06-08-59-938Z.json`

## Results

| Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 20 | current hierarchical coarse/refine | ok | 10.7s | 1 | 6 | 18 | 2 | ok |
| 20 | single full-detail request | ok | 38.6s | 1 | 6 | 18 | 2 | ok |
| 50 | current hierarchical coarse/refine | ok | 14.6s | 1 | 9 | 44 | 6 | ok |
| 50 | single full-detail request | ok | 43.7s | 1 | 9 | 44 | 6 | ok |
| 80 | current hierarchical coarse/refine | ok | 17.2s | 1 | 9 | 70 | 10 | ok |
| 80 | single full-detail request | ok | 73.8s | 1 | 9 | 72 | 8 | ok |

## Takeaways

- 20 tabs: single full-detail was slower than hierarchical (38.6s vs 10.7s, 3.61x).
- 50 tabs: single full-detail was slower than hierarchical (43.7s vs 14.6s, 2.99x).
- 80 tabs: single full-detail was slower than hierarchical (73.8s vs 17.2s, 4.28x).
- Single full-detail planning completed successfully at every measured size from 20 to 80 tabs.

## Notes

- Both strategies use the same synthetic inventory for each tab count.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

