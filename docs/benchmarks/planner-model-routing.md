# Planner Model Routing Decision Record

Date: 2026-06-26

This document records why Tab Tidy should not route every planning step through
the largest/highest-effort model.

## Product Workload

Tab Tidy planning is a bounded classification task:

- input: tab ids, window ids, titles, sanitized URLs, original tab order, optional
  short page summaries, and local activity signals;
- output: strict JSON containing semantic groups, review tabs, and cleanup
  candidates;
- local runtime: validates tab ids, preserves original order, previews browser
  mutations, and executes only validated operations.

This is not a deep coding or math task. The main risk is slow or invalid JSON,
not missing a hidden proof.

## Internal Benchmark Evidence

Raw data is stored in:

- `docs/benchmarks/data/planner-scale-2026-06-26T02-58-49-708Z.json`
- `docs/benchmarks/data/planner-scale-2026-06-26T03-20-51-401Z.json`

Summary report:

- `docs/benchmarks/gateway-planner-scale.md`

Before/after result after the parallel-refinement change:

- `docs/benchmarks/gateway-planner-before-after-parallel.md`

Measured with synthetic metadata-only inventories through the live gateway:

| Tabs | Strategy | Model / effort | Status | Time | Requests | Result |
| ---: | --- | --- | --- | ---: | ---: | --- |
| 120 | hierarchical coarse/refine | `gpt-5.5` / high | ok | 40.4s | 2 | 120 grouped, 0 review |
| 120 | single full-detail | `gpt-5.5` / high | ok | 77.5s | 1 | 106 grouped, 14 review |
| 300 | hierarchical coarse/refine | `gpt-5.5` / high | ok | 57.7s | 1 | 300 grouped, 0 review |
| 300 | single full-detail | `gpt-5.5` / high | failed | 121.7s | 1 | underlying fetch failed |
| 400 | hierarchical coarse/refine | `gpt-5.5` / high | failed | 240.0s | 9 | strategy timeout |

Internal conclusion:

- One full-detail request is not automatically faster, even when context is
  enough.
- Serial refinement is the real wall-clock problem at 300-400 tabs.
- `gpt-5.5` with high thinking is too heavy to apply to every refinement slice by
  default.

## Public Leaderboard Snapshot

Sources checked on 2026-06-26:

- Artificial Analysis GPT-5.5 model page:
  `https://artificialanalysis.ai/models/gpt-5-5`
- Artificial Analysis OpenAI provider page:
  `https://artificialanalysis.ai/providers/openai`
- Artificial Analysis GDPval-AA v2 leaderboard:
  `https://artificialanalysis.ai/evaluations/gdpval-aa`
- Artificial Analysis GPT-5.4 vs Claude Sonnet 4.6 comparison:
  `https://artificialanalysis.ai/models/comparisons/gpt-5-4-vs-claude-sonnet-4-6-adaptive`

Recorded signals:

| Source | Data point | Product implication |
| --- | --- | --- |
| GPT-5.5 model page | GPT-5.5 xhigh is top-tier but expensive, slow, and verbose; listed at 55.5 tokens/s, 97.87s TTFT, $5/M input and $30/M output. | Strong model, but a poor default for every bucket refinement. |
| OpenAI provider page | OpenAI's top intelligence models include GPT-5.5 xhigh/high and GPT-5.4 xhigh; GPT-5.4 mini is called out among the lowest-latency models at 0.72s TTFT. | Add GPT-5.4/GPT-5.4-mini as practical options for tab classification. |
| GDPval-AA v2 | GPT-5.5 high, GPT-5.4 xhigh, Claude Sonnet 4.6, GPT-5.5 medium, and GPT-5.4 mini xhigh are all visible in the leaderboard, with Sonnet near GPT-5.4/GPT-5.5 medium on that agentic eval. | Sonnet is capable, but not enough reason to spend limited Claude quota on every tab bucket. |
| GPT-5.4 vs Sonnet comparison | Comparison emphasizes both are large-context proprietary reasoning models. | Keep Sonnet as a manual/repair option instead of a bulk default. |

Public-data conclusion:

- GPT-5.5 remains a reasonable default visible model for best quality.
- For the harness, high thinking should be reserved for the coarse/global
  decision or explicit user choice, not repeated automatically for every bucket.
- GPT-5.4-mini deserves exposure because the product workload is short JSON
  classification, not frontier reasoning.
- Claude Sonnet should be available, but not silently used as the default bulk
  worker while Claude quota is constrained.

## Implemented Decision

Commits:

- `12645bf test: add gateway planner scale benchmark`
- `31567fc feat: add GPT 5.4 planner model options`
- `a93160b perf: parallelize gateway planner refinement`

Runtime behavior after these commits:

- UI model options include:
  - `gpt-5.5`
  - `gpt-5.4`
  - `gpt-5.4-mini`
  - `claude-opus-4-8`
  - `claude-sonnet-4-6`
  - custom model, when a custom gateway URL is configured
- Worker default allowlist includes the same planner models plus
  `gpt-5.3-codex-spark` for progress copy only.
- Coarse planning still uses low thinking.
- Hierarchical refinement runs with bounded concurrency.
- Large-job refinement defaults to medium thinking unless the user picked low.

## What Is Not Yet Proven

The repository now records architecture and scale evidence, but it does not yet
contain a live model-matrix benchmark across:

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `claude-sonnet-4-6`

That should be the next benchmark before changing the product default away from
`gpt-5.5`.

## Reproduction Commands

Run current strategy comparison:

```bash
npm run benchmark:planner-scale
```

Run a model-specific benchmark:

```bash
GATEWAY_MODEL=gpt-5.4-mini \
GATEWAY_THINKING_INTENSITY=medium \
BENCHMARK_TAB_COUNTS=120,300,400 \
npm run benchmark:planner-scale
```

Suggested next data document:

- append a model-matrix report under `docs/benchmarks/`;
- store raw JSON under `docs/benchmarks/data/`;
- record both latency and output quality:
  - validation pass/fail;
  - grouped/review counts;
  - group count;
  - whether review-like groups stay at the bottom;
  - whether cleanup candidates point to stale/duplicate tabs rather than active
    core work.
