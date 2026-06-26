# Planner Benchmark Quality Analysis

Generated: 2026-06-26T21:08:23.892Z

This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.

## Inputs

- `docs/benchmarks/data/planner-scale-2026-06-26T20-27-14-111Z-pid91961.json` (planner-scale-2026-06-26T20-27-14-111Z-pid91961, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T21-07-15-117Z-pid65535.json` (planner-scale-2026-06-26T21-07-15-117Z-pid65535, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T20-54-51-676Z-pid40765.json` (planner-scale-2026-06-26T20-54-51-676Z-pid40765, partial: false)
- `docs/benchmarks/data/planner-scale-2026-06-26T20-52-24-931Z-pid36868.json` (planner-scale-2026-06-26T20-52-24-931Z-pid36868, partial: false)

## Metrics

| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planner-scale-2026-06-26T20-27-14-111Z-pid91961.json | low_signal_samples | 33 | single_full_detail | ok | 69.6s | 1 | 9 | 93.9% | 100.0% | 97.5% | 98.7% | 53.4% |
| planner-scale-2026-06-26T21-07-15-117Z-pid65535.json | low_signal_samples | 33 | auto | ok | 41.3s | 2 | 9 | 93.9% | 100.0% | 97.5% | 98.7% | 53.4% |
| planner-scale-2026-06-26T20-54-51-676Z-pid40765.json | task_bursts | 50 | auto | ok | 11.8s | 2 | 11 | 100.0% | 100.0% | 96.1% | 98.0% | 56.2% |
| planner-scale-2026-06-26T20-52-24-931Z-pid36868.json | task_bursts | 120 | auto | ok | 36.6s | 2 | 10 | 100.0% | 96.4% | 97.0% | 96.7% | 58.5% |
| planner-scale-2026-06-26T20-52-24-931Z-pid36868.json | task_bursts | 300 | auto | ok | 69.9s | 3 | 12 | 99.3% | 94.9% | 90.5% | 92.6% | 56.6% |

## Reading The Numbers

- Topic precision answers: when Tab Tidy puts two tabs in the same group, how often do they share the fine-grained synthetic topic?
- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did Tab Tidy keep them together?
- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.
- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.
- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.
- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review.
