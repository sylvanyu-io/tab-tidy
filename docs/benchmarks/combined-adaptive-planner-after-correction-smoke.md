# Gateway Planner Scale Benchmark

Generated: 2026-06-26T20:02:38.224Z

This benchmark records the product-default auto-routing planner path. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Thinking intensity: high
- Prompt preset: conservative
- Strategy filter: auto,single_full_detail
- Scenario filter: task_bursts
- Planner option overrides: none
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T20-00-09-680Z-pid42392.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Failed Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 50 | product default auto route | hierarchical | failed | 27.6s | 1 | 1 | - | - | - | 默认 AI 服务暂时不可用。请稍后再试，或在更多选项里临时切换自定义 AI 网关。 |
| Task bursts with natural tab order | 50 | single full-detail request | single_full_detail | failed | 120.9s | 1 | 1 | - | - | - | fetch failed |

## Takeaways

- Task bursts with natural tab order, 50 tabs: auto used hierarchical and completed with failure in 27.6s with 1 request(s).

## Notes

- Auto runs use the product-default planner router instead of forcing a specific route.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- `degraded` means final plan validation passed, but at least one gateway request failed and the planner used fallback output.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

