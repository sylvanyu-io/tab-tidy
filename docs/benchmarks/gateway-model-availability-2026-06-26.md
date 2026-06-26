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
