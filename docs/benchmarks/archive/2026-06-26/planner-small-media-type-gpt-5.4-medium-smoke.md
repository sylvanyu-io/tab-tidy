# Gateway Planner Scale Benchmark

Generated: 2026-06-26T08:43:59.501Z

This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: media_type
- Strategy filter: hierarchical,single_full_detail
- Scenario filter: media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T08-42-24-205Z.json`

## Scenario Coverage

- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Media type preference | 24 | current hierarchical coarse/refine | ok | 28.7s | 2 | 6 | 23 | 1 | ok |
| Media type preference | 24 | single full-detail request | ok | 21.9s | 1 | 6 | 23 | 1 | ok |
| Media type preference | 60 | current hierarchical coarse/refine | ok | 16.3s | 1 | 9 | 60 | 0 | ok |
| Media type preference | 60 | single full-detail request | ok | 28.3s | 1 | 7 | 54 | 6 | ok |

## Takeaways

- Media type preference, 24 tabs: single full-detail was faster than hierarchical (21.9s vs 28.7s, 0.76x).
- Media type preference, 60 tabs: single full-detail was slower than hierarchical (28.3s vs 16.3s, 1.74x).
- Single full-detail planning completed successfully at every measured size from 24 to 60 tabs.

## Notes

- Both strategies use the same synthetic inventory for each tab count.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

