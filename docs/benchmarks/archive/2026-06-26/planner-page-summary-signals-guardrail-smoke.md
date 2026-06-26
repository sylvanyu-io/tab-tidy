# Gateway Planner Scale Benchmark

Generated: 2026-06-26T07:36:49.783Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: high
- Strategy filter: single_full_detail
- Scenario filter: domain_traps,media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T07-33-44-803Z.json`

## Scenario Coverage

- Domain traps: The same public platforms host many unrelated topics, so domain-only grouping should score poorly.
- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Domain traps | 24 | single full-detail request | ok | 76.9s | 1 | 10 | 23 | 1 | ok |
| Media type preference | 24 | single full-detail request | ok | 108.1s | 1 | 10 | 20 | 4 | ok |

## Takeaways

- This filtered benchmark did not complete any comparable strategy rows.

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- The single full-detail strategy sends every eligible tab in one planner request.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

