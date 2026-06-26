# Gateway Planner Scale Benchmark

Generated: 2026-06-26T08:57:37.095Z

This benchmark records the product-default auto-routing planner path. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: conservative
- Strategy filter: auto
- Scenario filter: task_bursts
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T08-56-42-501Z.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 24 | product default auto route | single_full_detail | ok | 29.2s | 1 | 9 | 21 | 3 | ok |
| Task bursts with natural tab order | 60 | product default auto route | hierarchical | ok | 25.3s | 2 | 12 | 60 | 0 | ok |

## Takeaways

- Task bursts with natural tab order, 24 tabs: auto used single_full_detail and completed successfully in 29.2s with 1 request(s).
- Task bursts with natural tab order, 60 tabs: auto used hierarchical and completed successfully in 25.3s with 2 request(s).

## Notes

- Auto runs use the product-default planner router instead of forcing a specific route.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

