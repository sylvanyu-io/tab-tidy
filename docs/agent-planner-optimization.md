# Agent Planner Optimization Notes

This note captures the direction for making Tab Tidy's AI planner faster and
more reliable at 200-400 tabs.

## What Other Agent Harnesses Suggest

Useful external patterns:

- Anthropic's agent engineering guidance emphasizes simple, composable
  workflows before autonomous agents. The relevant workflow patterns here are
  routing, parallelization, orchestrator-workers, and evaluator-optimizer:
  https://www.anthropic.com/engineering/building-effective-agents
- LangGraph's orchestrator-worker workflow splits work into subtasks, sends them
  to workers, then synthesizes their outputs:
  https://docs.langchain.com/oss/python/langgraph/workflows-agents
- AutoGen's mixture-of-agents pattern uses an orchestrator, multiple worker
  agents, and final aggregation:
  https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/mixture-of-agents.html
- OpenAI Agents SDK documentation highlights tracing/evaluation as the way to
  inspect and improve agent workflows:
  https://openai.github.io/openai-agents-python/tracing/

Tab Tidy should borrow the workflow patterns, not the framework weight. This is
not an open-ended coding agent. It is a bounded classification and recommendation
pipeline over a known tab inventory.

## Current Problem

The current implementation has two extremes:

- Single full-detail request: one large prompt, one final plan. Simple, but a
  300-tab run failed in live gateway testing.
- Hierarchical coarse/refine: one broad pass plus bucket refinement. More
  reliable in some cases, but refinements are serial and still use heavy
  settings, so 400 tabs can run too long.

The bottleneck is model/runtime scheduling, not local JSON handling.

## Proposed Harness

Use an adaptive orchestrator-worker plan:

1. Build a compact local tab table.
2. Run a cheap router/coarse pass with a smaller or lower-thinking model.
3. Split into buckets using tab ids only.
4. Launch worker refinements concurrently with a bounded concurrency limit.
5. Ask each worker for both group recommendations and cleanup recommendations
   for its bucket.
6. Merge deterministically by tab id, original order, and bucket id.
7. Run local validation.
8. If validation fails, repair only the invalid slice instead of retrying the
   whole inventory.
9. Optionally run a final small summarizer pass for group names and user-facing
   rationale, not for tab assignment.

## Model Strategy

Default should not be `gpt-5.5` high for every step.

Public leaderboard signal checked on 2026-06-26:

- Artificial Analysis ranks `gpt-5.5` high and medium close enough that medium is
  the better bulk default for this classification workload:
  https://artificialanalysis.ai/leaderboards/models
- The same leaderboard shows `gpt-5.4-mini` as much cheaper and faster, with
  lower but still usable intelligence for lightweight tab clustering.
- Claude models remain useful, but the user's Claude token budget is limited.
  Do not route every bucket refinement through Sonnet by default.

Recommended runtime defaults:

- Coarse/router: selected GPT-family planner model with low thinking.
- Refinement workers: selected GPT-family planner model with medium thinking by
  default, even when the visible user setting is high. If the user selects low,
  keep low.
- `gpt-5.4-mini`: expose as an optional preset for cost/speed-sensitive runs.
- `claude-sonnet-4-6`: keep available as a manual choice and reserve future
  automatic use for small repair/polish slices, not full inventories.
- `claude-opus-4-8`: manual fallback only.
- Final naming/synthesis: low or medium, and only if the merged plan needs it.

The task is mostly language clustering and structured output. It needs strong
semantic judgment, but not deep coding/math reasoning.

## Concurrency Strategy

Use bounded parallelism:

- Default worker concurrency: 3.
- Hard cap: 5.
- Per-worker timeout: 60-90 seconds.
- Strategy timeout: 180-240 seconds.

If one bucket fails:

- Keep successful buckets.
- Put failed bucket tabs into Review/Pending confirmation.
- Surface a product-facing explanation.
- Never block the whole plan because one worker failed.

## Data Contract

Workers should return compact JSON:

```json
{
  "bucketId": "ai-coding",
  "groups": [
    {
      "key": "agent-tools",
      "title": "AI agent tools",
      "color": "blue",
      "confidence": 0.82,
      "ids": [1, 2, 3],
      "reason": "Same task context."
    }
  ],
  "review": [
    { "id": 4, "reason": "Unclear from title and URL." }
  ],
  "cleanup": {
    "candidates": [
      {
        "id": 5,
        "priority": "medium",
        "reason": "Looks like an old comparison page.",
        "evidence": ["older sequence position", "weak connection to current buckets"]
      }
    ]
  }
}
```

The final browser mutation must still be driven only by local validated data.

## Next Implementation Steps

1. Refactor `gateway-planner.js` into explicit planner stages:
   `routeTabs`, `refineBucket`, `mergeBucketPlans`, `repairPlan`.
2. Add a bounded concurrency helper with abort propagation.
3. Extend the planner result to include cleanup recommendations in the same run.
4. Add benchmark modes for:
   - single full-detail;
   - serial hierarchical;
   - parallel hierarchical;
   - model/thinking matrix.
5. Make benchmark reports append or aggregate instead of overwriting the previous
   report.
