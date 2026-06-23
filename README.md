# Semantic Tab Agent

AI-assisted Chrome extension for semantic tab grouping across many browser windows.

Current status: runnable MV3 prototype with metadata-only planning, preview,
apply, and best-effort undo. The default planner is deterministic and local.
An optional OpenAI planner is wired through the same schema validator and
executor path.

## Local Use

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select this project directory: `/Users/yuyufeng/Projects/semantic-tab-agent`.
5. Click the extension action to open the side panel.

Default behavior is current-window only. The "All windows to one window" scope is
an explicit switch and moves all eligible normal-window tabs into one target
window only after preview and confirmation.

The OpenAI planner is optional. Select `OpenAI` in the side panel, enter a model
and API key, then analyze. The key is stored in Chrome extension local storage
for this local prototype. The generated plan still goes through local validation
before any browser mutation.

Page content sampling is off by default. Session-only acknowledgement is not
persisted; persistent acknowledgement is reserved for a later settings flow.

## Tests

```bash
npm test
```

The Node harness uses a fake Chrome adapter and covers inventory, validation,
current-window grouping, consolidate-to-one-window, undo, URL sanitization,
OpenAI request shaping, and page-sampling permission gates.

After installing dev dependencies, run the side panel smoke test:

```bash
npm install
npm run test:ui
```

The UI smoke test opens `src/sidepanel/index.html` in mock mode. It does not
need a loaded extension.

Design notes:

- [Agent contract](docs/agent-contract.md)
- [Evaluation harness](docs/harness.md)
- [Multi-window feasibility](docs/multi-window-feasibility.md)
- [Permissions research](docs/permissions-research.md)
