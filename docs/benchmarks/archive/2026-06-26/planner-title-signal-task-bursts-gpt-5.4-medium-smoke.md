# Gateway Planner Scale Benchmark

Generated: 2026-06-26T09:38:10.335Z

This benchmark records a filtered planner strategy run. It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Prompt preset: conservative
- Strategy filter: hierarchical
- Scenario filter: task_bursts
- Planner option overrides: none
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T09-37-21-325Z-pid19741.json`

## Scenario Coverage

- Task bursts with natural tab order: Adjacent tabs are often part of the same work burst, with semantic topics spread across domains.

## Results

| Scenario | Tabs | Strategy | Route | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Task bursts with natural tab order | 48 | current hierarchical coarse/refine | hierarchical | ok | 35.4s | 2 | 12 | 48 | 0 | ok |
| Task bursts with natural tab order | 50 | current hierarchical coarse/refine | hierarchical | ok | 13.4s | 2 | 8 | 50 | 0 | ok |
| Task bursts with natural tab order | 60 | current hierarchical coarse/refine | hierarchical | failed | 0.1s | 1 | - | - | - | 默认 AI 服务这次没有成功完成。请稍后再试，或在更多选项里临时切换自定义 AI 网关。 |
| Task bursts with natural tab order | 120 | current hierarchical coarse/refine | hierarchical | failed | 0.1s | 1 | - | - | - | 默认 AI 服务这次没有成功完成。请稍后再试，或在更多选项里临时切换自定义 AI 网关。 |

## Takeaways

- 48 tabs: hierarchical completed successfully in 35.4s with 2 request(s).
- 50 tabs: hierarchical completed successfully in 13.4s with 2 request(s).
- 60 tabs: hierarchical completed with failure in 0.1s with 1 request(s).
- 120 tabs: hierarchical completed with failure in 0.1s with 1 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

