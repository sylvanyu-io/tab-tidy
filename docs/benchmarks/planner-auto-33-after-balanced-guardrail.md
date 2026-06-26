# Gateway Planner Scale Benchmark

Generated: 2026-06-26T21:04:04.052Z

This benchmark records the product-default auto-routing planner path. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Auxiliary model: gpt-5.3-codex-spark
- Thinking intensity: high
- Prompt preset: conservative
- Grouping granularity: balanced
- Strategy filter: auto
- Scenario filter: low_signal_samples
- Planner option overrides: none
- Page content: synthetic inventory with optional page summary snippets
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T21-03-27-380Z-pid59051.json`

## Scenario Coverage

- Low-signal titles with page samples: Titles are generic and the useful signal lives in optional page summary snippets.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Tokens | I/O bytes | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Low-signal titles with page samples | 33 | product default auto route | split_cleanup | ok | 36.7s | 2 | 19681 | 52.0 KB | 9 | 31 | 2 | ok |

## Takeaways

- Low-signal titles with page samples, 33 tabs: auto used split_cleanup and completed successfully in 36.7s with 2 request(s).

## Notes

- Auto runs use the product-default planner router instead of forcing a specific route.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- `degraded` means final plan validation passed, but at least one gateway request failed and the planner used fallback output.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

