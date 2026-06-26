# Gateway Planner Scale Benchmark

Generated: 2026-06-26T20:28:23.685Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.5
- Auxiliary model: gpt-5.3-codex-spark
- Thinking intensity: high
- Prompt preset: conservative
- Grouping granularity: balanced
- Strategy filter: single_full_detail
- Scenario filter: low_signal_samples
- Planner option overrides: none
- Page content: synthetic inventory with optional page summary snippets
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T20-27-14-111Z-pid91961.json`

## Scenario Coverage

- Low-signal titles with page samples: Titles are generic and the useful signal lives in optional page summary snippets.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Tokens | I/O bytes | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Low-signal titles with page samples | 33 | single full-detail request | single_full_detail | ok | 69.6s | 1 | 9801 | 35.2 KB | 9 | 31 | 2 | ok |

## Takeaways

- This filtered benchmark did not complete any comparable strategy rows.

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- `degraded` means final plan validation passed, but at least one gateway request failed and the planner used fallback output.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

