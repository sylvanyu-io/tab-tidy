# Gateway Planner Scale Benchmark

Generated: 2026-06-26T08:58:22.140Z

This benchmark records the product-default auto-routing planner path. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: media_type
- Strategy filter: auto
- Scenario filter: media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T08-57-52-609Z.json`

## Scenario Coverage

- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Media type preference | 24 | product default auto route | single_full_detail | ok | 14.3s | 1 | 6 | 23 | 1 | ok |
| Media type preference | 60 | product default auto route | hierarchical | ok | 15.2s | 1 | 9 | 60 | 0 | ok |

## Takeaways

- Media type preference, 24 tabs: auto used single_full_detail and completed successfully in 14.3s with 1 request(s).
- Media type preference, 60 tabs: auto used hierarchical and completed successfully in 15.2s with 1 request(s).

## Notes

- Auto runs use the product-default planner router instead of forcing a specific route.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

