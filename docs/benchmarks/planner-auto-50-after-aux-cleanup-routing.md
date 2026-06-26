# Gateway Planner Scale Benchmark

Generated: 2026-06-26T20:28:52.364Z

This benchmark records the product-default auto-routing planner path. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Auxiliary model: gpt-5.3-codex-spark
- Thinking intensity: high
- Prompt preset: conservative
- Grouping granularity: balanced
- Strategy filter: auto
- Scenario filter: task_bursts
- Planner option overrides: none
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T20-28-51-975Z-pid94449.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Tokens | I/O bytes | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 50 | product default auto route | hierarchical | failed | 0.4s | 1 | - | 11.6 KB | - | - | - | 默认 AI 服务这次没有成功完成。请稍后再试，或在更多选项里临时切换自定义 AI 网关。 |

## Takeaways

- Task bursts with natural tab order, 50 tabs: auto used hierarchical and completed with failure in 0.4s with 1 request(s).

## Notes

- Auto runs use the product-default planner router instead of forcing a specific route.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- `degraded` means final plan validation passed, but at least one gateway request failed and the planner used fallback output.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

