# Agent Harness Research Notes

Date: 2026-06-26

This document records how current public agent-harness patterns should map to
Tab Tidy. The product is a bounded tab-classification workflow, not an
open-ended autonomous agent.

## Sources Checked

- Anthropic, "Building effective agents":
  https://www.anthropic.com/engineering/building-effective-agents
- LangGraph, "Workflows and agents":
  https://docs.langchain.com/oss/python/langgraph/workflows-agents
- Microsoft AutoGen, "Mixture of Agents":
  https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/mixture-of-agents.html
- OpenAI Agents SDK, "Tracing":
  https://openai.github.io/openai-agents-python/tracing/

## Relevant Patterns

### Routing

Use a cheap first pass to determine the shape of the work:

- easy small inventory;
- many clean topics;
- one oversized mixed bucket;
- uncertain/review-heavy inventory;
- cleanup-heavy stale tabs.

Tab Tidy already has a coarse planner. The next step is to make routing
measurable: every route must record request count, latency, coverage, pairwise
precision, pairwise recall, and pairwise F1.

### Parallel Workers

Use workers only when there are independent buckets or slices. This matches Tab
Tidy's large-bucket refinement problem, where a single coarse bucket can be
split by original tab order and refined concurrently.

Parallel workers should not be used just to add sophistication. They are useful
only when they improve measured quality, latency, or completion reliability.

### Evaluator / Repair

Use an evaluator when there is a clear success criterion. Tab Tidy has objective
local checks:

- every eligible tab appears exactly once;
- group sizes do not exceed limits;
- review-like groups stay last;
- pairwise quality on synthetic fixtures does not regress;
- coverage does not collapse without an explicit product reason.

The next useful harness stage is not "skip refinement"; it is "evaluate the
coarse/refined plan and repair only bad slices."

### Tracing And Evidence

Agent runs need inspectable traces. Tab Tidy should preserve:

- raw benchmark JSON;
- request counts and elapsed time;
- normalized plans;
- preview counts;
- quality metrics;
- decision documents that explain whether a change was accepted or rejected.

This mirrors the tracing/evaluation emphasis in current agent tooling without
adding a heavy external framework.

## Decision For Tab Tidy

Keep Tab Tidy as a small local harness:

1. Coarse route.
2. Worker refinement for mixed/large/uncertain slices.
3. Deterministic local merge.
4. Local validation.
5. Quality evaluation on synthetic fixtures.
6. Targeted repair only when validation or quality gates fail.

Do not adopt a full multi-agent framework in the extension runtime. The browser
extension needs predictable latency, simple state, and transparent rollback.

## Rejected Direction

Skipping refinement for small uncertain leftovers was tested and rejected:

- `docs/benchmarks/archive/2026-06-26/adaptive-refine-experiment.md`

It improved latency in some small runs, but reduced pairwise quality. Since
semantic grouping quality is the product premise, the default planner should not
trade accuracy away for speed.

## Next Optimization Direction

Optimize while preserving quality:

- benchmark model/effort matrix before changing defaults;
- keep second-pass refinement for uncertain or mixed slices;
- use lower effort or cheaper models only when quality metrics do not regress;
- add evaluator/repair on bad slices instead of retrying the full inventory;
- keep every change tied to before/after benchmark evidence.
