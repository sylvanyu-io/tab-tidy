# Planner Optimization Decision - 2026-06-26

## 结论

当前默认路线改为：

- 20-49 个标签页：主模型 `gpt-5.5` 只做分组；辅助模型 `gpt-5.3-codex-spark` 生成清理检查清单。
- 50 个及以上标签页：先用 `gpt-5.3-codex-spark` 粗分；只对大组、不确定组或标题模式混杂组调用主模型精分；最后用 `gpt-5.3-codex-spark` 生成清理检查清单。
- 清理检查清单默认尽量覆盖更多标签页：80 个以内尽量全列；更大规模最多列 200 个，按优先级排序，用户手动决定是否关闭。
- 清理检查清单使用 low 思考强度；分组主模型仍尊重用户选择的模型和思考强度。
- 分组粒度新增 `compact / balanced / detailed`，默认 `balanced`，避免 AI 把 30 多个 tabs 拆成过多小组。

这样做的原因：分组准确度仍由主模型兜底，清理排序属于轻量判断和列表生成，不值得让 `gpt-5.5 high` 承担全部输出成本。

## 前后对比

| 样本 | 旧路线 | 新路线 | 耗时变化 | 主模型用量变化 | 清理清单 |
| --- | --- | --- | ---: | ---: | ---: |
| 33 tabs, 带页面摘要 | single full-detail, `gpt-5.5 high` 一次完成分组+清理 | split cleanup: `gpt-5.5 high` 分组 + spark low 清理 | 69.6s -> 50.2s | `gpt-5.5` 9801 tokens -> 7972 tokens | 15 -> 33 |
| 50 tabs | spark 粗分 + `gpt-5.5` 精分 + spark cleanup | spark 粗分 + spark cleanup，未触发不必要精分 | 24.3s -> 11.8s | `gpt-5.5` 1512 tokens -> 0 | 50 -> 50 |
| 120 tabs | spark cleanup medium | spark cleanup low | 59.7s -> 36.6s | 主模型 0 -> 0 | 84 -> 84 |
| 300 tabs | spark cleanup medium | spark cleanup low | 190.1s -> 69.9s | `gpt-5.5` 2152 tokens -> 2168 tokens | 200 -> 191 |

## 原始数据

- 33 tabs single baseline: `docs/benchmarks/data/planner-scale-2026-06-26T20-27-14-111Z-pid91961.json`
- 33 tabs split cleanup compact: `docs/benchmarks/data/planner-scale-2026-06-26T20-45-18-572Z-pid25926.json`
- 50 tabs before compact cleanup input: `docs/benchmarks/data/planner-scale-2026-06-26T20-37-11-655Z-pid10910.json`
- 50 tabs cleanup low: `docs/benchmarks/data/planner-scale-2026-06-26T20-54-51-676Z-pid40765.json`
- 120/300 tabs cleanup medium: `docs/benchmarks/data/planner-scale-2026-06-26T20-47-29-928Z-pid29866.json`
- 120/300 tabs cleanup low: `docs/benchmarks/data/planner-scale-2026-06-26T20-52-24-931Z-pid36868.json`
- Worker spark planner rejection before deploy: `docs/benchmarks/data/planner-scale-2026-06-26T20-28-51-975Z-pid94449.json`

## 已修正的问题

- Worker 之前把所有 `gpt-5.3-codex-spark` 请求都当成进度文案请求，导致辅助规划被 `spark_token_cap_exceeded` 拒绝。现在 Worker 按请求形状区分：进度文案继续限制 1200 token，Tab Tidy 辅助规划允许走 planner 校验。
- 50 个以上的粗分请求曾经没有带压缩后的 `pageSampleSignals`，在页面摘要开启时会损失摘要信息。现在粗分和 cleanup 都使用压缩摘要信号。
- cleanup 请求曾经重复携带完整 `pageSample` 行。现在只给 cleanup 请求发送精简 tab 行和压缩摘要信号，减少重复输入。
- cleanup 子请求曾经使用 medium 思考强度。实测对大清单非常慢，改为 low 后 300 tabs 从 190.1s 降到 69.9s。

## 保留风险

- 大规模 cleanup 输出接近 200 个候选时，响应仍然会比较长；这是为了满足“尽量把大部分可清理标签页列出来给用户手动判断”的产品目标。
- `gpt-5.5` 的单次请求偶发 502 已被记录为失败样本，不属于本地 planner 契约错误。失败数据保留在 `docs/benchmarks/data/planner-scale-2026-06-26T20-41-33-843Z-pid18515.json`。
