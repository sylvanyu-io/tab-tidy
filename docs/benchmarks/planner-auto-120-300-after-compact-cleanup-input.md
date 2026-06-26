# Gateway Planner Scale Benchmark

Generated: 2026-06-26T20:51:39.730Z

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
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T20-47-29-928Z-pid29866.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Tokens | I/O bytes | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 120 | product default auto route | hierarchical | ok | 59.7s | 2 | 56171 | 62.8 KB | 10 | 120 | 0 | ok |
| Task bursts with natural tab order | 300 | product default auto route | hierarchical | ok | 190.1s | 3 | 113712 | 148.3 KB | 11 | 299 | 1 | ok |

## Takeaways

- Task bursts with natural tab order, 120 tabs: auto used hierarchical and completed successfully in 59.7s with 2 request(s).
- Task bursts with natural tab order, 300 tabs: auto used hierarchical and completed successfully in 190.1s with 3 request(s).

## Notes

- Auto runs use the product-default planner router instead of forcing a specific route.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- `degraded` means final plan validation passed, but at least one gateway request failed and the planner used fallback output.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

