# Gateway Planner Scale Benchmark

Generated: 2026-06-26T07:40:58.409Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: high
- Strategy filter: single_full_detail
- Scenario filter: media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T07-39-28-048Z.json`

## Scenario Coverage

- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Media type preference | 24 | single full-detail request | ok | 90.4s | 1 | 8 | 20 | 4 | ok |

## Takeaways

- This filtered benchmark did not complete any comparable strategy rows.

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

