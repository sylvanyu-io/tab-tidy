# Tab Tidy Gateway Worker

Cloudflare Worker wrapper for the default free Tab Tidy AI gateway.

The extension sends chat-completions-compatible planner requests to this Worker.
The Worker validates the request, applies coarse anti-abuse limits, injects the
real upstream API key on the server side, and forwards only to the configured
upstream base URL.

## What It Protects

- No upstream API key is shipped in the extension.
- Clients cannot override the upstream target.
- Only the extension model allowlist is accepted by default:
  `gpt-5.5`, `claude-opus-4-8`, `claude-sonnet-4-6`, and
  `gpt-5.3-codex-spark`. The spark model is used only for bounded progress UI
  copy, not for tab planning.
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

The Worker health response is `{"ok":true}`. The raw origin health response can
be different; that is useful when checking whether traffic is hitting the Worker
or bypassing it.

## Local Tests

```bash
npm run test:worker
```

The tests use an in-memory KV and mocked upstream fetch. They never call the
real LLM gateway.
