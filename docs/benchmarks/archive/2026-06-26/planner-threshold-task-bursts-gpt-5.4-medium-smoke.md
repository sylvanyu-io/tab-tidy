# Gateway Planner Scale Benchmark

Generated: 2026-06-26T09:20:13.624Z

This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: conservative
- Strategy filter: none
- Scenario filter: task_bursts
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T09-17-25-037Z-pid91629.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 36 | current hierarchical coarse/refine | hierarchical | ok | 33.8s | 2 | 9 | 34 | 2 | ok |
| Task bursts with natural tab order | 36 | single full-detail request | single_full_detail | ok | 31.2s | 1 | 8 | 32 | 4 | ok |
| Task bursts with natural tab order | 48 | current hierarchical coarse/refine | hierarchical | ok | 13.9s | 1 | 8 | 48 | 0 | ok |
| Task bursts with natural tab order | 48 | single full-detail request | single_full_detail | ok | 35.0s | 1 | 10 | 46 | 2 | ok |
| Task bursts with natural tab order | 50 | current hierarchical coarse/refine | hierarchical | ok | 28.6s | 2 | 12 | 50 | 0 | ok |
| Task bursts with natural tab order | 50 | single full-detail request | single_full_detail | ok | 25.9s | 1 | 9 | 43 | 7 | ok |

## Takeaways

- Task bursts with natural tab order, 36 tabs: single full-detail was faster than hierarchical (31.2s vs 33.8s, 0.92x).
- Task bursts with natural tab order, 48 tabs: single full-detail was slower than hierarchical (35.0s vs 13.9s, 2.51x).
- Task bursts with natural tab order, 50 tabs: single full-detail was faster than hierarchical (25.9s vs 28.6s, 0.90x).
- Single full-detail planning completed successfully at every measured size from 36 to 50 tabs.

## Notes

- Both strategies use the same synthetic inventory for each tab count.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

