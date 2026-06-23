# Semantic Tab Agent

AI-assisted Chrome extension for semantic tab grouping across many browser windows.

Current status: runnable MV3 prototype with metadata-only planning, preview,
apply, and best-effort undo. The default planner uses a chat-completions-compatible AI
gateway, then runs the generated plan through the same local validator and
executor path as every other planner.

## Local Use

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select this project directory: `/Users/yuyufeng/Projects/semantic-tab-agent`.
5. Click the extension action to open the side panel.

Default behavior is current-window only. The "All windows to one window" scope is
an explicit switch and moves all eligible normal-window tabs into one target
window only after preview and confirmation.

The AI gateway defaults to `http://127.0.0.1:8317/v1`. The side panel exposes
only `gpt-5.5`, `claude-opus-4-8`, and `claude-sonnet-4-6` for tab planning.
Thinking intensity defaults to high and can be set to low, medium, high, or
ultra-high from advanced settings.
Large AI gateway jobs automatically use a coarse-then-refine strategy: a fast
low-effort pass creates broad semantic buckets, then only oversized or uncertain
buckets are sent through the higher-effort planner before the local validator
accepts the final plan.
Image models can exist on the same gateway, but they are not useful planner
models for this workflow. The key is stored only when "remember key" is enabled.

DeepSeek is also supported. It uses DeepSeek's chat-completions-compatible
`/chat/completions` API with JSON Output, then the same local validator and
executor as every other planner.

Page content sampling is off by default. Session-only acknowledgement is not
persisted; persistent acknowledgement is reserved for a later settings flow.

## Tests

```bash
npm test
```

The Node harness uses a fake Chrome adapter and covers inventory, validation,
current-window grouping, consolidate-to-one-window, undo, URL sanitization,
AI gateway request shaping, and page-sampling permission gates.

After installing dev dependencies, run the side panel smoke test:

```bash
npm install
npm run test:ui
```

The UI smoke test opens `src/sidepanel/index.html` in mock mode. It does not
need a loaded extension.

Optional DeepSeek live smoke:

```bash
DEEPSEEK_API_KEY=... npm run smoke:deepseek
```

Optional AI gateway live smoke:

```bash
GATEWAY_BASE_URL=http://127.0.0.1:8317/v1 GATEWAY_API_KEY=... GATEWAY_THINKING_INTENSITY=high npm run smoke:gateway
```

Real extension stress test:

```bash
npm run build:extension
npm run stress:extension
```

This launches an isolated Chromium profile, opens hundreds of generated HTTP
pages across multiple normal browser windows, then verifies current-window mode,
all-windows-to-one-window mode, apply, undo, page-sampling permission gates, and
page body sampling. Optional gateway stress:

```bash
GATEWAY_BASE_URL=http://127.0.0.1:8317/v1 GATEWAY_API_KEY=... STRESS_GATEWAY_TABS=60 npm run stress:extension
```

Do not commit provider keys. Rotate any key that has appeared in chat, shell
history, logs, screenshots, or test output.

Release check:

```bash
npm run release:check
```

This runs automated tests, scans for provider-key patterns, and builds
`dist/semantic-tab-agent-0.1.0.zip` plus an unpacked `dist/extension`.

Design notes:

- [Agent contract](docs/agent-contract.md)
- [Evaluation harness](docs/harness.md)
- [Multi-window feasibility](docs/multi-window-feasibility.md)
- [Permissions research](docs/permissions-research.md)
- [Release readiness](docs/release-readiness.md)
