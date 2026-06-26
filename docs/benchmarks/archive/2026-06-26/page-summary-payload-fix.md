# Page Summary Payload Fix

Generated: 2026-06-26

This note records a benchmark-harness bug and one rejected prompt experiment for low-signal pages.

## Finding

The `low_signal_samples` fixture originally produced page sample fields at the top level of each sample result. The production planner expects them under `sample`. As a result, the compact planner payload contained `pageSample.status = ok` but empty `title`, `metaDescription`, `headings`, `contentKind`, and `visibleText`.

This made the first low-signal smoke look like a page-summary test, but it was actually closer to generic-title metadata testing.

## Fix

`scripts/planner-benchmark-fixtures.mjs` now writes sample content using the same shape as `requestPageSample`:

```json
{
  "status": "ok",
  "sample": {
    "title": "...",
    "metaDescription": "...",
    "headings": ["..."],
    "visibleText": "..."
  }
}
```

`tests/planner-benchmark-fixtures.test.mjs` now asserts that the compact payload actually includes visible page-summary text and that benchmark truth labels are not sent to the planner.

## Before / After

Same scenario and model:

- Scenario: `low_signal_samples`
- Tabs: 24
- Strategy: `single_full_detail`
- Model: `gpt-5.4`
- Thinking: `high`

| Run | Payload State | Time | Groups | Grouped Tabs | Review Tabs | Topic F1 | Family F1 | Decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `planner-scale-2026-06-26T07-07-15-167Z` | Empty sample fields due fixture bug | 97.3s | 5 | 18 | 6 | 54.5% | 17.2% | Treat as invalid page-summary evidence. |
| `planner-scale-2026-06-26T07-19-43-332Z` | Correct sample payload | 78.9s | 6 | 18 | 6 | 76.9% | 57.5% | Keep the fixture fix. |

The fixed payload improved Topic F1 by 22.4 points and Family F1 by 40.3 points in this smoke, while also returning faster. This is one run, not a stable latency conclusion, but it proves the prior low-signal benchmark was underfeeding the model.

## Rejected Prompt Experiment

A follow-up prompt experiment told the planner to treat successful page samples as the strongest signal and avoid review for generic sampled pages.

| Run | Change | Time | Groups | Grouped Tabs | Review Tabs | Topic F1 | Family F1 | Decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `planner-scale-2026-06-26T07-22-51-770Z` | Strong page-sample weighting prompt | 98.8s | 5 | 22 | 2 | 45.1% | 62.9% | Reject. |

Reason:

- Review count improved from 6 to 2, and Family F1 rose from 57.5% to 62.9%.
- Fine-grained Topic F1 fell from 76.9% to 45.1%.
- The product premise is accurate semantic refinement, so a change that broadens groups and harms fine-grained accuracy should not ship.

## Next Direction

Do not blindly overweight page summaries in the system prompt.

Better next experiments:

- Add a compact per-tab `sampleSignal` summary that is easier for the model to compare without encouraging broad catch-all groups.
- Test page-summary improvements across `low_signal_samples`, `domain_traps`, and `media_type`, not only one scenario.
- Require before/after reporting for Topic F1, Family F1, coverage, review count, and elapsed time before accepting a planner prompt change.
