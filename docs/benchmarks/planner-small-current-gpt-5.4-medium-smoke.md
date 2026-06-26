# Gateway Planner Scale Benchmark

Generated: 2026-06-26T08:34:49.684Z

This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: conservative
- Strategy filter: hierarchical,single_full_detail
- Scenario filter: task_bursts,media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T08-30-08-901Z.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.
- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 24 | current hierarchical coarse/refine | ok | 24.6s | 2 | 7 | 22 | 2 | ok |
| Task bursts with natural tab order | 24 | single full-detail request | ok | 21.9s | 1 | 9 | 22 | 2 | ok |
| Task bursts with natural tab order | 60 | current hierarchical coarse/refine | ok | 24.8s | 1 | 10 | 60 | 0 | ok |
| Task bursts with natural tab order | 60 | single full-detail request | ok | 31.3s | 1 | 9 | 53 | 7 | ok |
| Media type preference | 24 | current hierarchical coarse/refine | ok | 24.3s | 4 | 10 | 24 | 0 | ok |
| Media type preference | 24 | single full-detail request | ok | 33.8s | 1 | 8 | 22 | 2 | ok |
| Media type preference | 60 | current hierarchical coarse/refine | ok | 38.9s | 4 | 16 | 60 | 0 | ok |
| Media type preference | 60 | single full-detail request | ok | 81.1s | 1 | 18 | 50 | 10 | ok |

## Takeaways

- Task bursts with natural tab order, 24 tabs: single full-detail was faster than hierarchical (21.9s vs 24.6s, 0.89x).
- Task bursts with natural tab order, 60 tabs: single full-detail was slower than hierarchical (31.3s vs 24.8s, 1.26x).
- Media type preference, 24 tabs: single full-detail was slower than hierarchical (33.8s vs 24.3s, 1.39x).
- Media type preference, 60 tabs: single full-detail was slower than hierarchical (81.1s vs 38.9s, 2.09x).
- Single full-detail planning completed successfully at every measured size from 24 to 60 tabs.

## Notes

- Both strategies use the same synthetic inventory for each tab count.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

