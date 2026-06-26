# Small-Session Hierarchical Threshold Decision

Date: 2026-06-26

## Question

Tab Tidy previously used the hierarchical coarse/refine path only at 100+ tabs.
The user called out that small-session optimizations had become slower in some
runs, so this decision must be based on measured accuracy and latency, not on a
generic belief that "more stages are faster."

The product goal remains accuracy first. A threshold change is acceptable only
when it preserves or improves grouping quality and does not introduce obvious
latency regressions.

## Harness Pattern Check

A fresh source check on 2026-06-26 still supports the local lightweight
orchestrator-worker direction:

- Anthropic's agent guidance emphasizes simple, composable workflows before
  heavier autonomous agents.
- LangGraph documents orchestrator-worker workflows where an orchestrator sends
  dynamic worker jobs and synthesizes outputs through shared state.
- Microsoft's AutoGen documents mixture-of-agents as layered workers plus a
  single orchestrator.

Tab Tidy should keep borrowing the pattern, not the framework weight: compact
coarse routing, bounded refinement workers, deterministic local merge,
validation, preview, and undo.

## Evidence

### Existing GPT-5.5 High Baseline

Raw data:

- `docs/benchmarks/data/planner-scale-2026-06-26T05-59-23-988Z.json`
- quality rollup in `docs/benchmarks/adaptive-refine-experiment.md`

| Tabs | Strategy | Time | Coverage | Pair F1 / Topic F1 | Result |
| ---: | --- | ---: | ---: | ---: | --- |
| 20 | hierarchical | 19.6s | 100.0% | 61.1% | Slower than ideal quality, but still faster than single. |
| 20 | single full-detail | 39.0s | 85.0% | not accepted as better | Slower and more review. |
| 50 | hierarchical | 17.9s | 100.0% | 98.0% | Better speed and quality. |
| 50 | single full-detail | 43.7s | 90.0% | lower than hierarchical | Slower and more review. |
| 80 | hierarchical | 46.7s | 90.0% | 94.8% | Faster with equal coverage. |
| 80 | single full-detail | 70.6s | 90.0% | comparable coverage | Slower. |

The later "skip uncertain refinement" experiment was rejected because it made
some rows faster but lowered automatic grouping quality. The threshold decision
below does not adopt that skipped-refinement behavior.

### Current GPT-5.4 Medium, Default Smart Topics

Raw data:

- `docs/benchmarks/data/planner-scale-2026-06-26T08-30-08-901Z.json`
- `docs/benchmarks/planner-small-current-gpt-5.4-medium-quality.md`

| Scenario | Tabs | Strategy | Time | Coverage | Topic F1 | Decision signal |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| task_bursts | 24 | hierarchical | 24.6s | 91.7% | 66.7% | Do not force hierarchy this small. |
| task_bursts | 24 | single full-detail | 21.9s | 91.7% | 97.1% | Better at 24 tabs. |
| task_bursts | 60 | hierarchical | 24.8s | 100.0% | 100.0% | Better speed and quality. |
| task_bursts | 60 | single full-detail | 31.3s | 88.3% | 92.6% | Worse coverage, slower. |

The same run included `media_type` with the default smart-topic preset. Those
rows are useful as a negative control but should not be used to judge the
media-type product mode.

### Current GPT-5.4 Medium, Media-Type Preset

Raw data:

- `docs/benchmarks/data/planner-scale-2026-06-26T08-42-24-205Z.json`
- `docs/benchmarks/planner-small-media-type-gpt-5.4-medium-quality.md`

| Tabs | Strategy | Time | Coverage | Topic F1 | Decision signal |
| ---: | --- | ---: | ---: | ---: | --- |
| 24 | hierarchical | 28.7s | 95.8% | 100.0% | Accurate, but slower than single. |
| 24 | single full-detail | 21.9s | 95.8% | 100.0% | Better at 24 tabs. |
| 60 | hierarchical | 16.3s | 100.0% | 98.4% | Better speed and coverage. |
| 60 | single full-detail | 28.3s | 90.0% | 97.2% | Slower and less complete. |

### Current GPT-5.4 Mini Medium

Raw data:

- `docs/benchmarks/data/planner-scale-2026-06-26T08-35-28-104Z.json`
- `docs/benchmarks/planner-small-current-gpt-5.4-mini-medium-quality.md`
- `docs/benchmarks/data/planner-scale-2026-06-26T08-44-23-601Z.json`
- `docs/benchmarks/planner-small-media-type-gpt-5.4-mini-medium-quality.md`

| Scenario | Tabs | Strategy | Time | Coverage | Topic F1 | Decision signal |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| task_bursts | 24 | hierarchical | 48.7s | 95.8% | 70.0% | Not a small-session default. |
| task_bursts | 24 | single full-detail | 56.2s | 91.7% | 83.3% | Still slow. |
| task_bursts | 60 | hierarchical | 16.6s | 100.0% | 91.0% | Fast, acceptable but below GPT-5.4 quality. |
| task_bursts | 60 | single full-detail | 84.1s | 95.0% | 94.4% | Higher F1, much slower. |
| media_type | 24 | hierarchical | 22.5s | 100.0% | 100.0% | Good, but not enough to change small threshold. |
| media_type | 24 | single full-detail | 34.5s | 95.8% | 100.0% | Slower than GPT-5.4 single. |
| media_type | 60 | hierarchical | 17.6s | 100.0% | 88.9% | Fast but lower precision. |
| media_type | 60 | single full-detail | 75.1s | 100.0% | 98.4% | More accurate but too slow for default. |

Mini is not a proven default replacement. It sometimes runs fast, but the
latency is inconsistent and quality can trail GPT-5.4.

## Decision

Lower the automatic hierarchical threshold from 100 tabs to 50 tabs.

Keep sub-50-tab sessions on the single full-detail path.

Why:

- 24-tab evidence is mixed and often favors single full-detail on quality or
  latency.
- 50/60/80-tab evidence repeatedly favors hierarchical for coverage and latency,
  especially on GPT-5.5 high and GPT-5.4 medium.
- The accepted change keeps refinement available; it does not repeat the
  rejected "skip uncertain refinement" experiment.
- The browser mutation safety model is unchanged: plans still pass local
  validation, preview, and undo.

Implemented guardrail:

- `tests/gateway-planner.test.mjs` verifies 50 tabs automatically enter the
  coarse path.
- `tests/gateway-planner.test.mjs` verifies 49 tabs stay on the single
  full-detail path.

## Follow-up

- Add an explicit `auto` strategy to the benchmark runner so future reports can
  record product-default routing directly instead of comparing only forced
  strategies.
- Repeat the threshold check on a real anonymized tab session when available.
- Do not lower below 50 without evidence that 20-30 tab sessions keep or improve
  quality.
