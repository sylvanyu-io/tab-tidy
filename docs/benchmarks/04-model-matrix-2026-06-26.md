# Planner Model Matrix

Date: 2026-06-26

This document records live gateway checks for alternative planner models and
thinking intensities. It is intentionally conservative: a model is not a product
candidate unless it is both available on the default gateway and preserves
synthetic grouping quality.

## Data Sources

Baseline `gpt-5.5` high:

- `docs/benchmarks/data/planner-scale-2026-06-26T05-59-23-988Z.json`
- `docs/benchmarks/data/planner-scale-2026-06-26T05-03-27-199Z.json`

Alternative runs:

- `docs/benchmarks/data/planner-scale-2026-06-26T06-31-09-684Z.json`
- `docs/benchmarks/archive/2026-06-26/gateway-planner-model-matrix-gpt-5.4-mini-medium.md`
- `docs/benchmarks/data/planner-scale-2026-06-26T06-32-02-652Z.json`
- `docs/benchmarks/archive/2026-06-26/gateway-planner-model-matrix-gpt-5.4-medium.md`
- `docs/benchmarks/data/planner-scale-2026-06-26T06-32-53-023Z.json`
- `docs/benchmarks/archive/2026-06-26/gateway-planner-model-matrix-gpt-5.5-medium.md`
- `docs/benchmarks/data/planner-scale-2026-06-26T06-45-15-751Z.json`
- `docs/benchmarks/archive/2026-06-26/gateway-planner-model-matrix-gpt-5.4-mini-medium-post-worker-deploy.md`
- `docs/benchmarks/data/planner-scale-2026-06-26T06-47-42-153Z.json`
- `docs/benchmarks/archive/2026-06-26/gateway-planner-model-matrix-gpt-5.4-medium-post-worker-deploy.md`

Quality rollup:

- `docs/benchmarks/archive/2026-06-26/planner-quality-analysis.md`

## Results

Before redeploying the Worker, `gpt-5.4` and `gpt-5.4-mini` failed at the
product-facing gateway with `model_not_allowed`. Direct checks against local
CLIProxyAPI (`127.0.0.1:8317`), the API-only proxy (`127.0.0.1:18317`), and the
origin tunnel all accepted the same models. Redeploying the Worker with the
current `worker/wrangler.toml` fixed the product-facing gateway.

| Model / effort | Tabs | Status | Time | Requests | Coverage | Pair F1 | Notes |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| `gpt-5.5` high | 50 | ok | 17.9s | 2 | 100.0% | 98.0% | Existing high-quality baseline. |
| `gpt-5.5` medium | 50 | ok | 27.4s | 2 | 98.0% | 95.9% | Slower and lower F1 than the 50-tab high baseline. |
| `gpt-5.5` high | 120 | ok | 40.4s | 2 | 100.0% | 96.2% | Best comparable 120-tab high baseline. |
| `gpt-5.5` medium | 120 | ok | 41.7s | 2 | 100.0% | 96.2% | Similar quality and speed, no clear win. |
| `gpt-5.4` medium, before Worker redeploy | 50 | failed | 0.4s | 1 | 0.0% | 0.0% | Worker returned `model_not_allowed`. |
| `gpt-5.4` medium, before Worker redeploy | 120 | failed | 0.1s | 1 | 0.0% | 0.0% | Worker returned `model_not_allowed`. |
| `gpt-5.4-mini` medium, before Worker redeploy | 50 | failed | 0.9s | 1 | 0.0% | 0.0% | Worker returned `model_not_allowed`. |
| `gpt-5.4-mini` medium, before Worker redeploy | 120 | failed | 0.1s | 1 | 0.0% | 0.0% | Worker returned `model_not_allowed`. |
| `gpt-5.4` medium, after Worker redeploy | 50 | ok | 27.1s | 2 | 100.0% | 95.9% | Slower than 50-tab `gpt-5.5` high baseline. |
| `gpt-5.4` medium, after Worker redeploy | 120 | ok | 36.7s | 2 | 100.0% | 96.2% | Slightly faster than best 120-tab `gpt-5.5` high baseline with equal F1. |
| `gpt-5.4-mini` medium, after Worker redeploy | 50 | ok | 58.3s | 2 | 100.0% | 100.0% | High quality in this run but much slower. |
| `gpt-5.4-mini` medium, after Worker redeploy | 120 | ok | 69.7s | 2 | 100.0% | 95.9% | Slower than `gpt-5.5` high and `gpt-5.4` medium. |

## Decision

Use `gpt-5.4` with high thinking as the product default.

- The earlier `model_not_allowed` failures were a Worker deployment/config
  problem, not a CLIProxyAPI model support problem.
- `gpt-5.4` medium is a plausible candidate for 100+ tab workloads: the 120-tab
  run matched the best `gpt-5.5` high Pair F1 and was slightly faster.
- The default uses high thinking, not medium, to keep the consumer-facing quality
  bar closer to the previous `gpt-5.5` high default while reducing model cost.
- `gpt-5.5` remains available as a higher-end manual option, especially for
  small but ambiguous sessions where the previous 50-tab baseline was stronger.
- `gpt-5.4-mini` medium is available after the Worker redeploy, but this run was
  slower than the larger models.
- `gpt-5.5 medium` did not prove a stable latency win and was worse than the
  50-tab high baseline on both speed and pair F1.

## Product Implication

The default gateway was redeployed as Worker version
`80a736ed-328e-4694-a941-8ac697a5ec5c` with the current `ALLOWED_MODELS`
configuration. Post-deploy smoke checks against `https://cliproxy.sylvanyu.io`
returned HTTP 200 for:

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `claude-sonnet-4-6`

Future routing may still use lower effort for specific worker slices, but only
after benchmark evidence shows no pairwise-quality regression.
