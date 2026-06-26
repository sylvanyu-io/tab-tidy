# Gateway Planner Scale Benchmark

Generated: 2026-06-26T08:41:49.194Z

This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4-mini
- Thinking intensity: medium
- Prompt preset: conservative
- Strategy filter: hierarchical,single_full_detail
- Scenario filter: task_bursts,media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T08-35-28-104Z.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.
- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 24 | current hierarchical coarse/refine | ok | 48.7s | 2 | 9 | 23 | 1 | ok |
| Task bursts with natural tab order | 24 | single full-detail request | ok | 56.2s | 1 | 9 | 22 | 2 | ok |
| Task bursts with natural tab order | 60 | current hierarchical coarse/refine | ok | 16.6s | 1 | 9 | 60 | 0 | ok |
| Task bursts with natural tab order | 60 | single full-detail request | ok | 84.1s | 1 | 10 | 57 | 3 | ok |
| Media type preference | 24 | current hierarchical coarse/refine | ok | 24.3s | 3 | 8 | 24 | 0 | ok |
| Media type preference | 24 | single full-detail request | ok | 98.1s | 1 | 8 | 20 | 4 | ok |
| Media type preference | 60 | current hierarchical coarse/refine | ok | 37.6s | 1 | 9 | 60 | 0 | ok |
| Media type preference | 60 | single full-detail request | failed | 15.3s | 1 | - | - | - | 默认 AI 服务暂时不可用。请稍后再试，或在更多选项里临时切换自定义 AI 网关。 |

## Takeaways

- Task bursts with natural tab order, 24 tabs: single full-detail was slower than hierarchical (56.2s vs 48.7s, 1.15x).
- Task bursts with natural tab order, 60 tabs: single full-detail was slower than hierarchical (84.1s vs 16.6s, 5.07x).
- Media type preference, 24 tabs: single full-detail was slower than hierarchical (98.1s vs 24.3s, 4.04x).

## Notes

- Both strategies use the same synthetic inventory for each tab count.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

