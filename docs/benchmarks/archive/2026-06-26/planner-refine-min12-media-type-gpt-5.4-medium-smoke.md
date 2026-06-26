# Gateway Planner Scale Benchmark

Generated: 2026-06-26T09:31:39.996Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: media_type
- Strategy filter: hierarchical
- Scenario filter: media_type
- Planner option overrides: refineBucketMinTabs=12
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T09-30-04-592Z-pid10702.json`

## Scenario Coverage

- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Media type preference | 50 | current hierarchical coarse/refine | hierarchical | ok | 25.1s | 3 | 8 | 49 | 1 | ok |
| Media type preference | 60 | current hierarchical coarse/refine | hierarchical | ok | 26.3s | 2 | 9 | 60 | 0 | ok |
| Media type preference | 120 | current hierarchical coarse/refine | hierarchical | ok | 44.0s | 6 | 10 | 120 | 0 | ok |

## Takeaways

- 50 tabs: hierarchical completed successfully in 25.1s with 3 request(s).
- 60 tabs: hierarchical completed successfully in 26.3s with 2 request(s).
- 120 tabs: hierarchical completed successfully in 44.0s with 6 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

