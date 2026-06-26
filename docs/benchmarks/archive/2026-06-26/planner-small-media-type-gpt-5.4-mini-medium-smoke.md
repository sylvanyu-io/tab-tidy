# Gateway Planner Scale Benchmark

Generated: 2026-06-26T08:46:53.310Z

This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4-mini
- Thinking intensity: medium
- Prompt preset: media_type
- Strategy filter: hierarchical,single_full_detail
- Scenario filter: media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T08-44-23-601Z.json`

## Scenario Coverage

- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Media type preference | 24 | current hierarchical coarse/refine | ok | 22.5s | 2 | 7 | 24 | 0 | ok |
| Media type preference | 24 | single full-detail request | ok | 34.5s | 1 | 6 | 23 | 1 | ok |
| Media type preference | 60 | current hierarchical coarse/refine | ok | 17.6s | 1 | 8 | 60 | 0 | ok |
| Media type preference | 60 | single full-detail request | ok | 75.1s | 1 | 9 | 60 | 0 | ok |

## Takeaways

- Media type preference, 24 tabs: single full-detail was slower than hierarchical (34.5s vs 22.5s, 1.53x).
- Media type preference, 60 tabs: single full-detail was slower than hierarchical (75.1s vs 17.6s, 4.27x).
- Single full-detail planning completed successfully at every measured size from 24 to 60 tabs.

## Notes

- Both strategies use the same synthetic inventory for each tab count.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

