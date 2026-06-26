# Gateway Planner Scale Benchmark

Generated: 2026-06-26T09:19:54.183Z

This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: media_type
- Strategy filter: none
- Scenario filter: media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T09-17-25-877Z-pid91707.json`

## Scenario Coverage

- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Media type preference | 36 | current hierarchical coarse/refine | hierarchical | ok | 22.4s | 2 | 8 | 35 | 1 | ok |
| Media type preference | 36 | single full-detail request | single_full_detail | ok | 22.7s | 1 | 7 | 35 | 1 | ok |
| Media type preference | 48 | current hierarchical coarse/refine | hierarchical | ok | 19.6s | 2 | 8 | 48 | 0 | ok |
| Media type preference | 48 | single full-detail request | single_full_detail | ok | 30.9s | 1 | 7 | 45 | 3 | ok |
| Media type preference | 50 | current hierarchical coarse/refine | hierarchical | ok | 32.8s | 2 | 9 | 50 | 0 | ok |
| Media type preference | 50 | single full-detail request | single_full_detail | ok | 19.8s | 1 | 7 | 47 | 3 | ok |

## Takeaways

- Media type preference, 36 tabs: single full-detail was roughly tied with hierarchical (22.7s vs 22.4s, 1.02x).
- Media type preference, 48 tabs: single full-detail was slower than hierarchical (30.9s vs 19.6s, 1.58x).
- Media type preference, 50 tabs: single full-detail was faster than hierarchical (19.8s vs 32.8s, 0.61x).
- Single full-detail planning completed successfully at every measured size from 36 to 50 tabs.

## Notes

- Both strategies use the same synthetic inventory for each tab count.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

