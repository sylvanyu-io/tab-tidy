# Gateway Planner Scale Benchmark

Generated: 2026-06-26T20:05:02.450Z

This benchmark records the product-default auto-routing planner path. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Thinking intensity: high
- Prompt preset: conservative
- Strategy filter: auto
- Scenario filter: task_bursts
- Planner option overrides: none
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T20-03-54-179Z-pid48901.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Failed Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 50 | product default auto route | hierarchical | ok | 68.3s | 11 | 0 | 28 | 48 | 2 | ok |

## Takeaways

- Task bursts with natural tab order, 50 tabs: auto used hierarchical and completed successfully in 68.3s with 11 request(s).

## Notes

- Auto runs use the product-default planner router instead of forcing a specific route.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- `degraded` means final plan validation passed, but at least one gateway request failed and the planner used fallback output.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

