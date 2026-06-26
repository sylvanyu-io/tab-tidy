# Gateway Model Availability Diagnosis

Date: 2026-06-26

## Problem

Tab Tidy benchmark requests for `gpt-5.4` and `gpt-5.4-mini` failed through the
default product-facing gateway:

- `https://cliproxy.sylvanyu.io/v1/chat/completions`
- error: `model_not_allowed`
- message: `This model is not available on the free gateway.`

## Diagnosis

The gateway stack has four relevant entry points:

1. CLIProxyAPI main service: `http://127.0.0.1:8317`
2. API-only local proxy: `http://127.0.0.1:18317`
3. origin tunnel: `https://cliproxy-origin.sylvanyu.io`
4. product-facing Worker: `https://cliproxy.sylvanyu.io`

Health checks:

- local main: 200
- local API-only proxy: 200
- origin tunnel: 200
- product-facing Worker: 200
- `manage-cliroxyapi-service.sh smoke`: 200

Direct model checks with the configured upstream API key:

| Entry point | `gpt-5.5` | `gpt-5.4` | `gpt-5.4-mini` | `claude-sonnet-4-6` |
| --- | --- | --- | --- | --- |
| `127.0.0.1:8317` | 200 | 200 | 200 | 200 |
| `127.0.0.1:18317` | 200 | 200 | 200 | 200 |
| `cliproxy-origin.sylvanyu.io` | 200 | 200 | 200 | 200 |
| `cliproxy.sylvanyu.io`, before Worker redeploy | 200 | 400 `model_not_allowed` | 400 `model_not_allowed` | 200 |

This proved that CLIProxyAPI and the tunnel already supported the models. The
rejecting layer was the product-facing Worker.

`wrangler versions view` for the old deployed Worker showed an older
`ALLOWED_MODELS` binding that did not include the newer GPT-5.4 entries. The
local `worker/wrangler.toml` already had the intended allowlist, but it had not
been deployed.

## Fix

Ran:

```bash
cd worker && wrangler deploy
```

New Worker version:

- `80a736ed-328e-4694-a941-8ac697a5ec5c`

Post-deploy product-facing checks:

| Entry point | `gpt-5.5` | `gpt-5.4` | `gpt-5.4-mini` | `claude-sonnet-4-6` |
| --- | --- | --- | --- | --- |
| `cliproxy.sylvanyu.io`, after Worker redeploy | 200 | 200 | 200 | 200 |

## Conclusion

The earlier `model_not_allowed` benchmark failures were caused by stale Worker
deployment configuration, not by local CLIProxyAPI model support and not by the
models themselves.

Any future model-availability failure should first compare:

1. local `8317`;
2. local `18317`;
3. origin tunnel;
4. product-facing Worker.

If only the product-facing Worker rejects a model, check the deployed
`ALLOWED_MODELS` binding and redeploy the Worker before changing Tab Tidy's model
list or planner logic.

## Follow-up: Custom Model Names on the Built-in Gateway

Date: 2026-06-26

The built-in gateway is not a third-party generic LLM proxy. It is the user's
local CLIProxyAPI exposed through the origin tunnel and guarded by the Tab Tidy
Worker. A later model probe checked the broader model list exposed by
CLIProxyAPI and found that the rejecting layer was again the product-facing
Worker allowlist, not the local gateway or Cloudflare Tunnel.

Live minimal chat-completions probe:

| Model | Local proxy `127.0.0.1:18317` | Origin tunnel `cliproxy-origin.sylvanyu.io` | Product Worker `cliproxy.sylvanyu.io`, before fix | Decision |
| --- | --- | --- | --- | --- |
| `gpt-5.5` | 200 | 200 | 200 | Keep as default preset. |
| `gpt-5.4` | 200 | 200 | 200 | Keep as preset. |
| `gpt-5.4-mini` | 200 | 200 | 200 | Keep as preset. |
| `claude-opus-4-8` | 200 | 200 | 200 | Keep as preset. |
| `claude-sonnet-4-6` | 200 | 200 | 200 | Keep as preset. |
| `claude-opus-4-7` | 200 | 200 | 400 `model_not_allowed` | Add to Worker text-model allowlist for custom model names. |
| `claude-opus-4-6` | 200 | 200 | 400 `model_not_allowed` | Add to Worker text-model allowlist for custom model names. |
| `claude-sonnet-4-5-20250929` | 200 | 200 | 400 `model_not_allowed` | Add to Worker text-model allowlist for custom model names. |
| `claude-haiku-4-5-20251001` | 200 | 200 | 400 `model_not_allowed` | Add to Worker text-model allowlist for custom model names. |
| `codex-auto-review` | 200 | 200 | 400 `model_not_allowed` | Add to Worker text-model allowlist for custom model names. |
| `gpt-5.3-codex-spark` | 200 | 200 | 400 `spark_shape_required` with planner shape | Keep only for progress-copy requests. |
| `gpt-image-2` | 503, image endpoint only | 503, image endpoint only | 400 `model_not_allowed` | Do not allow for Tab Tidy planning; Worker only exposes chat completions. |
| `gpt-5.34` | 502 unknown provider | Cloudflare 502 page from origin path | 400 `model_not_allowed` | Do not add; this is not a known origin model. |

Changes made from this probe:

- The Worker allowlist now mirrors the verified CLIProxyAPI text chat models,
  while still excluding image-only models.
- The extension no longer requires a custom AI gateway URL when the user chooses
  "custom model name"; the built-in gateway can receive the model name and the
  Worker remains the enforcement boundary.
- `gpt-5.3-codex-spark` remains special-cased for short progress-copy requests,
  not planning.

Post-fix deploy:

```bash
npx wrangler deploy --config worker/wrangler.toml
```

Worker version:

- `8ebf63b0-dce5-4e2f-8540-a37f3db745f6`

Post-deploy product-facing checks:

| Request | Result |
| --- | --- |
| planner shape, `claude-opus-4-7` | 200 |
| planner shape, `claude-opus-4-6` | 200 |
| planner shape, `claude-sonnet-4-5-20250929` | 200 |
| planner shape, `claude-haiku-4-5-20251001` | 200 |
| planner shape, `codex-auto-review` | 200 |
| planner shape, `gpt-5.3-codex-spark` | 400 `spark_shape_required` |
| planner shape, `gpt-image-2` | 400 `model_not_allowed` |
| planner shape, `gpt-5.34` | 400 `model_not_allowed` |
| progress-copy shape, `gpt-5.3-codex-spark` | 200 |

Important nuance: the 200 status above proves routing and Worker allowlist
support, not planner quality. Some Claude CLI-facing models may answer with
generic assistant text when given only a tiny synthetic prompt. Tab Tidy's actual
planner still relies on strict product prompts plus local JSON validation and
retry handling.

## Follow-up: Local Tunnel Model Probe and Claude JSON Fence Handling

Date: 2026-06-26

The public gateway is a local CLIProxyAPI service exposed by Cloudflare Tunnel.
The product endpoint still has one extra layer:

```text
extension -> cliproxy.sylvanyu.io Worker -> cliproxy-origin.sylvanyu.io tunnel -> 127.0.0.1:18317 -> 127.0.0.1:8317
```

Current service health:

| Layer | Check | Result |
| --- | --- | --- |
| local main | `127.0.0.1:8317/healthz` | 200 |
| local API-only proxy | `127.0.0.1:18317/healthz` | 200 |
| origin tunnel | `cliproxy-origin.sylvanyu.io/healthz` | 200 |
| product Worker | `cliproxy.sylvanyu.io/healthz` | 200 |

Current `/v1/models` result with upstream auth:

| Entry point | Status | Matched tested models |
| --- | --- | --- |
| local main `8317` | 200 | 19 |
| local proxy `18317` | 200 | 19 |
| origin tunnel | 200 | 19 |
| product Worker `/v1/models` | 404 | not exposed by design |

Matched text and image models on the local/origin gateway included:

- `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`,
  `codex-auto-review`;
- Claude Opus/Sonnet/Haiku variants currently listed by CLIProxyAPI;
- `gpt-image-1.5`, `gpt-image-2`.

Product Worker chat smoke with a Tab Tidy planner-shaped request:

| Request | Status | Notes |
| --- | --- | --- |
| planner, `gpt-5.5` | 200 | returned OpenAI-compatible JSON envelope |
| planner, `gpt-5.4` | 200 | returned OpenAI-compatible JSON envelope |
| planner, `gpt-5.4-mini` | 200 | returned OpenAI-compatible JSON envelope |
| planner, `claude-sonnet-4-6` | 200 | content was JSON wrapped in a markdown code fence |
| planner, `claude-opus-4-8` | 200 | content was JSON wrapped in a markdown code fence |
| planner, `codex-auto-review` | 200 | routed through Worker |
| planner, `gpt-5.3-codex-spark` | 400 `spark_shape_required` | intentionally progress-copy only |
| planner, `gpt-image-2` | 400 `model_not_allowed` | intentionally excluded from Tab Tidy planner gateway |
| progress copy, `gpt-5.3-codex-spark` | 200 | expected progress-copy route |

Conclusion:

- The local CLIProxyAPI service and Cloudflare Tunnel can see the requested
  models.
- The product Worker is intentionally not a general OpenAI proxy. It exposes only
  Tab Tidy chat/planner-shaped requests, plus the bounded progress-copy route.
- Image models are visible on the origin gateway but are not usable through the
  product Worker because Tab Tidy does not need image generation.
- Claude planner calls route successfully, but these models often wrap JSON in
  markdown fences. The extension parser now also tolerates a compatible gateway
  returning a raw fenced JSON body instead of an OpenAI-compatible JSON envelope.

## Follow-up: Local Tunnel Recheck After Model Report

Date: 2026-06-26

The user clarified that the gateway is deployed locally and exposed through a
Cloudflare Tunnel, so the latest diagnosis repeated the full path instead of
checking only the extension:

```text
extension -> cliproxy.sylvanyu.io Worker -> cliproxy-origin.sylvanyu.io tunnel -> 127.0.0.1:18317 -> 127.0.0.1:8317
```

Current health:

| Layer | Result |
| --- | --- |
| local main `127.0.0.1:8317/healthz` | 200 |
| local API-only proxy `127.0.0.1:18317/healthz` | 200 |
| origin tunnel `cliproxy-origin.sylvanyu.io/healthz` | 200 |
| product Worker `cliproxy.sylvanyu.io/healthz` | 200 |
| product Worker Tab Tidy smoke, `gpt-5.5` | 200 |

Current `/v1/models` with upstream auth:

| Entry point | Status | Matched tested models |
| --- | --- | --- |
| local proxy `127.0.0.1:18317` | 200 | 20 |
| origin tunnel `cliproxy-origin.sylvanyu.io` | 200 | 20 |
| product Worker `/v1/models` | 404 | not exposed by design |

Matched local/origin models included the Tab Tidy text presets, progress-copy
model, review model, and image models:

- `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`;
- `claude-opus-4-8`, `claude-sonnet-4-6`;
- `gpt-5.3-codex-spark`, `codex-auto-review`;
- `gpt-image-1.5`, `gpt-image-2`.

Product Worker probe with the five extension text presets:

| Model | Public Worker status | Local proxy status | Product parse result |
| --- | --- | --- | --- |
| `gpt-5.5` | 200 | 200 | parsed plan |
| `gpt-5.4` | 200 | 200 | parsed plan |
| `gpt-5.4-mini` | 200 | 200 | parsed plan |
| `claude-opus-4-8` | 200 | 200 | parsed plan |
| `claude-sonnet-4-6` | 200 | 200 | parsed plan |

Boundary checks:

| Model | Product Worker result | Reason |
| --- | --- | --- |
| `codex-auto-review` | 200 | allowed as a text chat model; upstream currently routed the probe to `gpt-5.4` |
| `gpt-5.3-codex-spark` with planner shape | 400 `spark_shape_required` | reserved for progress-copy prompts |
| `gpt-image-1.5` | 400 `model_not_allowed` | image endpoint/model is not exposed through the Tab Tidy planner Worker |
| `gpt-image-2` | 400 `model_not_allowed` | image endpoint/model is not exposed through the Tab Tidy planner Worker |
| `gpt-5.34` | 400 `model_not_allowed` | not a verified local/origin model |

Cloudflare Tunnel logs still showed intermittent QUIC stream resets and
automatic reconnects. That explains earlier transient `530` / `1033` style
failures: those are origin-tunnel reachability failures, not model-allowlist
failures. At the time of this recheck the tunnel had reconnected and all health
checks passed.

Conclusion:

- The current local CLIProxyAPI service can see the requested text models.
- The current product Worker can route the five extension preset text models.
- If Chrome still reports `model_not_allowed` for those presets, suspect a stale
  deployed Worker version first.
- If Chrome still reports raw `Unexpected token` from fenced Claude output,
  suspect a stale loaded extension/service worker first; the current source and
  current `dist` package include fenced-JSON tolerance.
- Image models are available upstream but intentionally unavailable through the
  Tab Tidy planner gateway.

## Follow-up: Local Tunnel Recheck After Runtime Failures

Date: 2026-06-26

The gateway was rechecked after the user reported that the local Cloudflare
Tunnel gateway could not use several models. This recheck separated four
possible failure layers:

1. local CLIProxyAPI service;
2. origin Cloudflare Tunnel;
3. product Worker validation and rate limits;
4. upstream account/model runtime availability.

Health checks all passed:

| Layer | Result |
| --- | --- |
| local main `127.0.0.1:8317/healthz` | 200 |
| local API-only proxy `127.0.0.1:18317/healthz` | 200 |
| origin tunnel `cliproxy-origin.sylvanyu.io/healthz` | 200 |
| product Worker `cliproxy.sylvanyu.io/healthz` | 200 |

The local and origin `/v1/models` endpoints, with upstream auth, both listed the
expected text models:

- `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`;
- `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`;
- `gpt-5.3-codex-spark`.

First product-facing probes were blocked by the Worker's hourly IP limit:

| Key | Count |
| --- | --- |
| `ip:103.26.8.125:2026-06-26T09` | 60 / 60 |
| `global:2026-06-26` | 253 / 3000 |

That IP key was cleared for diagnosis. After clearing it, product-facing model
probes showed the real runtime state:

| Model | Product Worker result | Meaning |
| --- | --- | --- |
| `gpt-5.5` | 429 `model_cooldown` | Codex-provider credentials are cooling down. |
| `gpt-5.4` | 429 `model_cooldown` | Codex-provider credentials are cooling down. |
| `gpt-5.4-mini` | 429 `model_cooldown` | Codex-provider credentials are cooling down. |
| `claude-opus-4-8` | 200 | Usable through the product gateway. |
| `claude-sonnet-4-6` | 200 | Usable through the product gateway. |
| `claude-opus-4-7` | 200 | Usable through the product gateway. |
| `gpt-5.3-codex-spark` | 200 | Usable for the bounded progress-copy route. |

The CLIProxyAPI error logs for the GPT-family failures showed the underlying
upstream error:

```text
usage_limit_reached
plan_type: pro
resets_in_seconds: about 7,600 to 7,900 seconds
```

CLIProxyAPI then surfaced this as:

```text
model_cooldown
All credentials for model gpt-5.5 / gpt-5.4 / gpt-5.4-mini are cooling down via provider codex
```

Conclusion:

- The local service is running.
- The Cloudflare Tunnel is currently reachable.
- The Worker allowlist is not the current blocker for the tested text models.
- GPT-family planner models are currently unavailable because the Codex Pro
  credential pool hit its upstream usage limit and entered cooldown.
- Claude-family planner models are currently usable.
- If this happens during product use, the immediate workaround is to choose a
  Claude model or wait for the Codex-provider reset. Adding another Codex
  credential, adding a non-Codex upstream model provider, or implementing an
  explicit product-level fallback are the durable fixes.
