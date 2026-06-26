# Title-Cluster Refinement Guardrail

Date: 2026-06-26

## Problem

Lowering the hierarchical threshold to 50 made 48-tab sessions stay on the
single coarse pass. In the task-bursts fixture, the coarse planner produced a
high-confidence 15-tab `Chrome Extension Build` bucket that mixed three real
topics:

- `chrome-extension`: 5 tabs;
- `frontend`: 5 tabs;
- `design`: 5 tabs.

That row looked fast but was not accurate enough for the product goal.

## Rejected Candidate: Globally Refine Buckets At 12 Tabs

Experiment:

- model: `gpt-5.4`;
- thinking intensity: `medium`;
- strategy: hierarchical;
- override: `BENCHMARK_REFINE_BUCKET_MIN_TABS=12`.

Evidence:

| Scenario | Tabs | Time | Requests | Topic F1 | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| task bursts | 50 | 26.5s | 2 | 95.9% | acceptable |
| task bursts | 60 | 27.0s | 2 | 97.3% | acceptable |
| task bursts | 120 | 73.8s | 11 | 49.0% | reject |
| media type | 50 | 25.1s | 3 | 99.0% | acceptable |
| media type | 120 | 44.0s | 6 | 92.6% | acceptable |

Decision: rejected. A global low bucket threshold made the 120-tab task-bursts
case both slower and much less accurate. This is exactly the failure mode the
product must avoid: more LLM calls can create more fragmentation and worse
semantic recall.

Evidence files:

- `docs/benchmarks/planner-refine-min12-task-bursts-gpt-5.4-medium-quality.md`
- `docs/benchmarks/planner-refine-min12-media-type-gpt-5.4-medium-quality.md`
- `docs/benchmarks/data/planner-scale-2026-06-26T09-30-04-592Z-pid10717.json`
- `docs/benchmarks/data/planner-scale-2026-06-26T09-30-04-592Z-pid10702.json`

## Implemented Guardrail: Repeated Title-Pattern Signal

Instead of refining every 12-tab bucket, the planner now asks for a second pass
only when a high-confidence mid-sized bucket contains multiple repeated title
stems. The intent is narrow:

- catch coarse buckets that are likely mixed subtopics;
- avoid changing media-type organization mode;
- avoid broad threshold changes that over-refine large sessions.

Trigger shape:

- bucket has at least 12 tabs;
- at least 3 repeated title stems;
- each repeated stem appears at least 2 times;
- no single repeated stem dominates more than 75% of the bucket;
- disabled for the `media_type` preset.

## Evidence

Valid title-signal rows:

| Scenario | Tabs | Route | Time | Requests | Topic F1 | Before | Change |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| task bursts | 48 | hierarchical | 35.4s | 2 | 95.5% | 71.0% | +24.5 F1, +21.5s |
| media type | 50 | hierarchical | 41.1s | 3 | 98.5% | 99.0% from min-12 media run | no material regression in available row |

The 48-tab row directly addresses the observed mixed bucket:

| Run | Result |
| --- | --- |
| baseline 48 | one 15-tab `Chrome Extension Build` group mixing `chrome-extension`, `frontend`, and `design` |
| title-signal 48 | separate 5-tab `Chrome Extension Development`, 5-tab `Frontend Implementation`, and 5-tab `Product UI Design` groups |

Invalid or incomplete rows:

| Scenario | Tabs | Status | Reason |
| --- | ---: | --- | --- |
| task bursts | 50 | degraded | refinement request was `ip_rate_limited`, then fallback coarse plan was used |
| task bursts | 60 | failed | first request failed during local quota/rate-limit pressure |
| task bursts | 120 | failed | first request failed during local quota/rate-limit pressure |
| media type | 120 | failed | first request failed during local quota/rate-limit pressure |

Decision: keep the narrow title-pattern guardrail, but do not treat the
rate-limited rows as quality evidence. The valid 48-tab row proves the guardrail
fixes the specific mixed-bucket failure. The 120-tab safety claim still depends
on the rejected global-threshold evidence plus the narrow trigger design, not on
a completed title-signal 120-tab run.

## Harness Fix

The benchmark harness previously marked the 50-tab title-signal row as `ok`
because final plan validation passed after fallback. That was misleading for
quality analysis: the row was usable product output, but not a completed
refinement run.

The harness now records:

- `requestFailureCount`;
- `requestFailures`;
- `degraded` when validation passes but at least one gateway request failed.

The quality analyzer also backfills this status for older raw files by checking
`requests[].ok === false`.

## Follow-up

When GPT/Codex quota pressure is gone, rerun:

```bash
BENCHMARK_TAB_COUNTS=48,50,60,120 \
BENCHMARK_SCENARIOS=task_bursts \
BENCHMARK_STRATEGIES=hierarchical \
BENCHMARK_PROMPT_PRESET=conservative \
GATEWAY_MODEL=gpt-5.4 \
GATEWAY_THINKING_INTENSITY=medium \
BENCHMARK_REPORT_PATH=docs/benchmarks/planner-title-signal-task-bursts-gpt-5.4-medium-smoke.md \
npm run benchmark:planner-scale
```

The guardrail should remain accepted only if:

- no completed 120-tab task-bursts row repeats the min-12 over-refinement
  collapse;
- completed 50/60-tab rows stay close to or above the pre-guardrail Topic F1;
- degraded rows are not used as positive evidence.
