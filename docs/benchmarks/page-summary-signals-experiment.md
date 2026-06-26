# Page Summary Signals Experiment

Generated: 2026-06-26

This note records the accepted `pageSampleSignals` payload experiment. The goal was to improve low-signal page classification without shipping the rejected "page samples are strongest" prompt from `docs/benchmarks/page-summary-payload-fix.md`.

## Change

The planner payload now includes a compact page-summary index when page samples are available:

```json
{
  "pageSampleSignalFields": ["id", "contentKind", "title", "headings", "summary"],
  "pageSampleSignals": [[10000, "docs", "Title", ["Heading"], "Short visible-content summary"]]
}
```

The full `tabs[].pageSample` row is still present. `pageSampleSignals` is only an easier comparison index; it does not include benchmark truth, expected labels, or any model-generated answer.

The system prompt also adds a narrow instruction: use `pageSampleSignals` to disambiguate generic titles and sanitized URLs, while keeping grouping fine-grained and avoiding broad workflow merges.

## Request Size Check

Synthetic `low_signal_samples` payload size with page samples and signals:

| Tabs | Request Body Bytes |
| ---: | ---: |
| 24 | 24,723 |
| 120 | 105,803 |
| 300 | 258,741 |
| 400 | 343,310 |

The default Worker body limit is 1,000,000 bytes, so this change is not close to the current gateway cap in the synthetic high-summary case.

## Before / After Evidence

Same low-signal scenario:

- Scenario: `low_signal_samples`
- Tabs: 24
- Strategy: `single_full_detail`
- Model: `gpt-5.4`
- Thinking: `high`

| Run | Payload | Time | Groups | Grouped Tabs | Review Tabs | Topic F1 | Family F1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `planner-scale-2026-06-26T07-19-43-332Z` | Correct page samples, no signals | 78.9s | 6 | 18 | 6 | 76.9% | 57.5% |
| `planner-scale-2026-06-26T07-31-52-908Z` | Correct page samples plus signals | 74.4s | 9 | 22 | 2 | 97.1% | 49.3% |

Read:

- Topic F1 improved by 20.2 points.
- Review count dropped from 6 to 2 without lowering topic precision.
- Family F1 dropped because the accepted output became more fine-grained. That is acceptable for this product goal: precision and semantic refinement are the product premise.
- Latency improved in this one run, but single-run latency remains noisy and should not be treated as a stable speed conclusion.

## Guardrail Evidence

To check that the new prompt line did not damage non-summary scenarios, the same model and tab count were run on no-summary scenarios.

| Scenario | Baseline Run | Baseline Topic F1 | Signals Run | Signals Topic F1 | Read |
| --- | --- | ---: | --- | ---: | --- |
| `domain_traps` | `planner-scale-2026-06-26T07-07-15-167Z` | 85.7% | `planner-scale-2026-06-26T07-33-44-803Z` | 94.1% | No regression observed. |
| `media_type` | `planner-scale-2026-06-26T07-39-28-048Z` | 43.8% | `planner-scale-2026-06-26T07-33-44-803Z` | 45.6% | No quality regression observed, but media-type accuracy remains weak overall. |

Latency notes:

- `domain_traps`: 89.8s baseline vs 76.9s signals run.
- `media_type`: 90.4s baseline vs 108.1s signals run.
- These are single live-gateway observations and should be treated as noisy.

## Decision

Keep `pageSampleSignals`.

Reason:

- It directly improves the previously weak low-signal page-summary scenario.
- It does not leak fixture truth into the planner payload.
- It does not show quality regression in the two no-summary guardrail scenarios tested.
- It keeps the planner's fine-grained grouping goal intact, unlike the rejected prompt-overweighting experiment.

Follow-up:

- Media-type grouping remains weak. Optimize that preset separately; do not use the page-summary signal experiment to claim media-type quality is solved.
- Repeat this comparison at 50/120 tabs before making broader model-routing decisions.
