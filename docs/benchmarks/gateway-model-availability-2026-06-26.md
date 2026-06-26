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
