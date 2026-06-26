# Gateway Planner Scale Benchmark

Generated: 2026-06-26T09:38:02.528Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: media_type
- Strategy filter: hierarchical
- Scenario filter: media_type
- Planner option overrides: none
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T09-37-21-325Z-pid19739.json`

## Scenario Coverage

- Media type preference: Tabs should cluster by information shape: docs, issues, videos, papers, dashboards, and shopping/account pages.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Media type preference | 50 | current hierarchical coarse/refine | hierarchical | ok | 41.1s | 3 | 9 | 50 | 0 | ok |
| Media type preference | 120 | current hierarchical coarse/refine | hierarchical | failed | 0.1s | 1 | - | - | - | 默认 AI 服务这次没有成功完成。请稍后再试，或在更多选项里临时切换自定义 AI 网关。 |

## Takeaways

- 50 tabs: hierarchical completed successfully in 41.1s with 3 request(s).
- 120 tabs: hierarchical completed with failure in 0.1s with 1 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

