# Gateway Planner Scale Benchmark

Generated: 2026-06-26T06:32:03.141Z

This benchmark records a filtered planner strategy run. It uses synthetic metadata-only tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.

## Configuration

- Gateway: built-in default
- Model: gpt-5.4
- Thinking intensity: medium
- Strategy filter: hierarchical
- Page content: metadata-only synthetic inventory
- Raw data: `docs/benchmarks/data/planner-scale-2026-06-26T06-32-02-652Z.json`

## Results

| Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 50 | current hierarchical coarse/refine | failed | 0.4s | 1 | - | - | - | 默认 AI 服务这次没有成功完成。请稍后再试，或在更多选项里临时切换自定义 AI 网关。 |
| 120 | current hierarchical coarse/refine | failed | 0.1s | 1 | - | - | - | 默认 AI 服务这次没有成功完成。请稍后再试，或在更多选项里临时切换自定义 AI 网关。 |

## Takeaways

- 50 tabs: hierarchical completed with failure in 0.4s with 1 request(s).
- 120 tabs: hierarchical completed with failure in 0.1s with 1 request(s).

## Notes

- This filtered run should be compared against a separate baseline report.
- The hierarchical strategy may issue one coarse request plus one or more refinement requests.
- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.

