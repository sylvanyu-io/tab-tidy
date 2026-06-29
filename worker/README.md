# TabRecap Gateway Worker

Cloudflare Worker wrapper for the default free TabRecap AI gateway.

The extension sends chat-completions-compatible planner requests to this Worker.
The Worker validates the request, applies coarse anti-abuse limits, injects the
real upstream API key on the server side, and forwards only to the configured
upstream base URL.

## What It Protects

- No upstream API key is shipped in the extension.
- Clients cannot override the upstream target.
- Only the TabRecap text-model allowlist is accepted by default. It mirrors the
  current CLIProxyAPI origin chat models, including `gpt-5.5`, `gpt-5.4`,
  `gpt-5.4-mini`, `codex-auto-review`, Claude Opus/Sonnet/Haiku variants, and
  `gpt-5.3-codex-spark`. The spark model is allowed for bounded progress UI
  copy and compact auxiliary TabRecap planning shapes; generic chat remains
  rejected. Image models are intentionally excluded because this Worker only
  exposes `/v1/chat/completions`.
- Request body size and `max_tokens` are capped before upstream forwarding.
- KV counters limit global, IP, install-id, and page-summary usage.

This is not account-grade billing control. It is a practical free-tier abuse
brake for an open-source browser extension before login exists.

## Required Cloudflare Resources

Create a Workers KV namespace and bind it as `RATE_LIMIT_KV`. This repository
includes `worker/wrangler.toml` for the current public route. For another
deployment, copy `worker/wrangler.toml.example` to your own config and fill in
the KV namespace ID.

Use a Worker route for the public extension domain:

```toml
routes = [
  { pattern = "cliproxy.sylvanyu.io/*", zone_name = "sylvanyu.io" }
]
```

Keep the raw LLM gateway on a separate origin host such as
`https://cliproxy-origin.sylvanyu.io/v1`. Do not set `UPSTREAM_BASE_URL` to
`https://cliproxy.sylvanyu.io/v1`, because that would make the Worker call
itself recursively.

Set upstream values as Worker secrets:

```bash
npx wrangler secret put UPSTREAM_BASE_URL
npx wrangler secret put UPSTREAM_API_KEY
```

For a local-machine origin, keep the retry budget small. These are normal
Worker vars, already present in `worker/wrangler.toml`:

```toml
UPSTREAM_RETRY_ATTEMPTS = "2"
UPSTREAM_RETRY_DELAY_MS = "1200"
UPSTREAM_READY_TIMEOUT_MS = "8000"
```

The Worker retries only Cloudflare/Tunnel infrastructure failures such as
`530` with `error code: 1033`, `502`, `503`, `504`, and Cloudflare `52x`
origin errors. It does not retry model validation failures, `401`, `403`, or
`429`, so it should not silently double-spend normal model requests.

If the origin LLM gateway is behind Cloudflare Access, also set:

```bash
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
```

Then deploy:

```bash
npx wrangler deploy --config worker/wrangler.toml
```

Health check:

```bash
curl https://cliproxy.sylvanyu.io/healthz
```

The Worker health response is `{"ok":true}`. This only proves the Worker is
deployed. It does not prove the local origin machine, API-only proxy, or
Cloudflare Tunnel is reachable.

Readiness check:

```bash
curl https://cliproxy.sylvanyu.io/readyz
```

`/readyz` calls the configured upstream health endpoint. By default it checks
`/healthz` at the `UPSTREAM_BASE_URL` origin, so
`UPSTREAM_BASE_URL=https://cliproxy-origin.sylvanyu.io/v1` checks
`https://cliproxy-origin.sylvanyu.io/healthz`. Override with
`UPSTREAM_HEALTH_URL` only if the origin uses a different health path.

Each chat request now carries an `x-tab-recap-request-id` response header. The
extension sends the side-panel operation id as this header for default gateway
traffic, so a user-visible error can be matched with Worker logs and local
origin logs.

When the local Tunnel is down, the Worker converts raw Cloudflare failures into
JSON such as:

```json
{
  "error": {
    "code": "origin_tunnel_unavailable",
    "message": "The local TabRecap AI origin is offline or its Cloudflare Tunnel has no healthy connection.",
    "requestId": "recap_..."
  }
}
```

That is intentionally different from relaying an HTML/`error code: 1033` body
to the extension.

## Local-Machine Origin Checklist

The production-facing hostname can still use a local Mac as the origin, but the
chain must stay up:

```text
extension -> cliproxy.sylvanyu.io Worker -> cliproxy-origin.sylvanyu.io tunnel -> 127.0.0.1:18317 -> 127.0.0.1:8317
```

Operational checks, in order:

```bash
curl -sS http://127.0.0.1:8317/healthz
curl -sS http://127.0.0.1:18317/healthz
curl -sS https://cliproxy-origin.sylvanyu.io/healthz
curl -sS https://cliproxy.sylvanyu.io/readyz
```

If `/healthz` on `cliproxy.sylvanyu.io` is 200 but `/readyz` is 503, the Worker
is alive and the local origin path is not. Restart the local CLIProxyAPI stack
and Cloudflare Tunnel before changing extension code or model settings.

## Local Tests

```bash
npm run test:worker
```

The tests use an in-memory KV and mocked upstream fetch. They never call the
real LLM gateway.
