# Media-Type Preset Axis Experiment

Date: 2026-06-26

## Problem

The `media_type` benchmark remained weak after the accepted `pageSampleSignals`
change. The previous guardrail run showed only 45.6% Topic F1 for the media-type
scenario, so the "media type" organizing mode was not yet proven useful.

The root cause was prompt conflict:

- the base planner prompt said to classify by semantic topic, task, or intent;
- `pageSampleSignals` told the planner to keep grouping fine-grained;
- refinement prompts told large buckets to split by semantic tasks or topics;
- the `media_type` preset only lightly suggested using page type.

That made the model keep producing topic groups such as "side panel docs" and
"rate limit docs" instead of a stable "Documentation" media-type group.

## Change

Two implementation changes were made:

1. The benchmark runner now accepts `BENCHMARK_PROMPT_PRESET`, so prompt modes
   can be compared directly on the same fixture.
2. `media_type` now overrides the default topic axis in planner, page-sample,
   coarse, and refinement prompts. Default smart-topic behavior is unchanged for
   other presets.

## Evidence

All runs used:

- Scenario: `media_type`
- Model: `gpt-5.4`
- Thinking: `high`
- Gateway: built-in default
- Synthetic fixture truth: explicit `benchmarkTruth.topicByTabId`

### 24 Tabs, Single Full-Detail Request

| Run | Prompt state | Raw data | Time | Groups | Grouped | Review | Topic Precision | Topic Recall | Topic F1 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline default preset | `conservative` | `planner-scale-2026-06-26T07-59-58-543Z` | 107.8s | 8 | 19 | 5 | 100.0% | 31.8% | 48.3% |
| Old media preset | weak media-type hint only | `planner-scale-2026-06-26T08-01-57-051Z` | 114.7s | 10 | 22 | 2 | 70.0% | 31.8% | 43.8% |
| Strong preset text only | base prompt still partly conflicted | `planner-scale-2026-06-26T08-07-36-878Z` | 78.9s | 11 | 22 | 2 | 100.0% | 31.8% | 48.3% |
| Final media axis override | planner/page-sample/size rules aligned | `planner-scale-2026-06-26T08-10-10-126Z` | 43.0s | 6 | 23 | 1 | 100.0% | 100.0% | 100.0% |

### 120 Tabs, Hierarchical Coarse/Refine

| Run | Prompt state | Raw data | Time | Requests | Groups | Grouped | Review | Topic Precision | Topic Recall | Topic F1 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Media axis before refinement fix | coarse improved, refinement still split by topic | `planner-scale-2026-06-26T08-11-46-367Z` | 48.1s | 3 | 21 | 120 | 0 | 94.8% | 33.1% | 49.1% |
| Final refinement axis override | coarse and refinement both preserve media axis | `planner-scale-2026-06-26T08-15-10-417Z` | 37.9s | 3 | 10 | 120 | 0 | 98.0% | 87.8% | 92.6% |

The final 120-tab output still split Documentation into `40 + 4` tabs. That is
expected because `maxTabsPerGroup` is 40 and the fixture contains 44
documentation tabs.

## Decision

Keep the final media-axis prompt changes.

Reasons:

- The accepted change improves 24-tab Topic F1 from 48.3% to 100.0%.
- It improves 120-tab hierarchical Topic F1 from 49.1% to 92.6%.
- It reduces measured live-gateway latency in both accepted comparisons:
  107.8s to 43.0s for 24 tabs, and 48.1s to 37.9s for 120 tabs.
- It preserves the product premise: more accurate semantic organization comes
  before speed, and the speed improvement is a bonus rather than the reason for
  acceptance.

The old media-type preset text is rejected. It grouped more tabs but reduced
Topic F1, so it was not a product-quality improvement.

## Follow-Up

- Repeat media-type checks at 300-tab scale before claiming large-session
  completeness.
- Consider max-group-aware quality metrics so legal splits caused by
  `maxTabsPerGroup` are not over-penalized.
- Add a real-browser fixture once enough anonymized, consented tab sessions are
  available.
