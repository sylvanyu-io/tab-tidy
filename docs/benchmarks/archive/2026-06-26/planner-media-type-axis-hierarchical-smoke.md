# Gateway Planner Scale Benchmark

Generated: 2026-06-26T08:12:34.489Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: high
- Prompt preset: media_type
- Strategy filter: hierarchical
- Scenario filter: media_type
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T08-11-46-367Z.json`

## Scenario Coverage

- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Media type preference | 120 | current hierarchical coarse/refine | ok | 48.1s | 3 | 21 | 120 | 0 | ok |

## Takeaways

- 120 tabs: hierarchical completed successfully in 48.1s with 3 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

