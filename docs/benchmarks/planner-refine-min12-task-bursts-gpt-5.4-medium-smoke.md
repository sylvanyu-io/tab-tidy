# Gateway Planner Scale Benchmark

Generated: 2026-06-26T09:32:11.912Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: conservative
- Strategy filter: hierarchical
- Scenario filter: task_bursts
- Planner option overrides: refineBucketMinTabs=12
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T09-30-04-592Z-pid10717.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 50 | current hierarchical coarse/refine | hierarchical | ok | 26.5s | 2 | 12 | 50 | 0 | ok |
| Task bursts with natural tab order | 60 | current hierarchical coarse/refine | hierarchical | ok | 27.0s | 2 | 12 | 60 | 0 | ok |
| Task bursts with natural tab order | 120 | current hierarchical coarse/refine | hierarchical | ok | 73.8s | 11 | 29 | 119 | 1 | ok |

## Takeaways

- 50 tabs: hierarchical completed successfully in 26.5s with 2 request(s).
- 60 tabs: hierarchical completed successfully in 27.0s with 2 request(s).
- 120 tabs: hierarchical completed successfully in 73.8s with 11 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

