# Gateway Planner Scale Benchmark

Generated: 2026-06-26T07:33:07.297Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: high
- Strategy filter: single_full_detail
- Scenario filter: low_signal_samples
- Page content: synthetic inventory with optional page summary snippets
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T07-31-52-908Z.json`

## Scenario Coverage

- Low-signal titles with page samples: Titles are generic and the useful signal lives in optional page summary snippets.

## Results

| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Low-signal titles with page samples | 24 | single full-detail request | ok | 74.4s | 1 | 9 | 22 | 2 | ok |

## Takeaways

- This filtered benchmark did not complete any comparable strategy rows.

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

