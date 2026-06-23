# Release Readiness

This project is no longer treated as a demo. The release target is a Chrome MV3
extension that can be published after the gates below are satisfied.

## Current Production Posture

Implemented:

- Manifest V3 extension shell with side panel UI.
- Current-window organization by default.
- Explicit consolidate-to-one-window mode for all eligible normal-window tabs.
- Metadata-only inventory and URL sanitization.
- Existing native group preserve/dissolve switch.
- Page sampling off by default with explicit consent and permission gates.
- Fake, OpenAI, and DeepSeek planner providers.
- Local schema validation before every browser mutation.
- Preview before apply and best-effort undo snapshot.
- Fake Chrome harness and Playwright UI smoke test.

Not production-complete yet:

- No Chrome Web Store assets or listing text.
- No signed release package workflow.
- No real-browser extension E2E run against a temporary Chrome profile.
- No provider key management beyond local BYOK storage.
- No chunking/reduce flow for thousands of tabs or very small provider context
  windows.
- No telemetry/diagnostics toggle.

## Release Gates

Blocking gates:

- `npm run check` passes.
- DeepSeek live smoke passes with a disposable key.
- OpenAI live smoke passes with a disposable key.
- Manual Chrome run validates current-window apply and undo on a throwaway
  profile.
- Manual Chrome run validates consolidate-to-one-window and undo on a throwaway
  profile with at least three normal windows.
- Page sampling cannot run without visible risk acknowledgement.
- Page sampling active-tab mode cannot sample background tabs.
- Bulk page sampling returns `permission_required` without host permission.
- No provider key appears in git history, screenshots, test output, or fixtures.
- Extension package contains no `node_modules`, test outputs, or local secrets.

Recommended before public listing:

- Add provider setup screen that explains BYOK storage.
- Add export/import settings without exporting API keys by default.
- Add first-run privacy disclosure.
- Add error recovery UI for provider rate limit, invalid key, and invalid plan.
- Add per-operation progress and cancellation.
- Add release build script that zips only manifest, src, docs/licenses needed by
  the runtime, and static assets.

## Provider Policy

The extension uses bring-your-own-key provider credentials. Runtime rules:

- Never ship a shared provider key.
- Never commit provider keys.
- Redact keys from job snapshots and logs.
- Use provider-specific host permissions only.
- Keep provider output as planning intent only; validator/executor remain local.

OpenAI:

- Uses Responses API with strict JSON schema output.

DeepSeek:

- Uses `/chat/completions` with `response_format: {"type": "json_object"}`.
- Because JSON Output does not enforce the full local schema, every DeepSeek plan
  must pass local validation before preview/apply.
- The controller retries once with validation feedback for non-fake providers.

## Browser Safety Rules

- Do not close, discard, reload, or navigate tabs.
- Do not execute model-supplied JavaScript.
- Do not perform browser mutations without a rollback snapshot.
- Do not move tabs across windows unless consolidate-to-one-window is selected.
- Keep pinned and incognito tabs excluded by default.
- Treat `chrome://`, `chrome-extension://`, and `file://` as unsupported for
  page sampling.

## Manual QA Matrix

Current-window mode:

- 5 tabs, no existing groups.
- 100+ tabs, mixed domains.
- Pinned tabs excluded.
- Existing groups preserved.
- Existing groups dissolved.
- Apply then undo.

Consolidate-to-one-window mode:

- 3 normal windows with 20+ tabs each.
- One source window becomes empty after move.
- Existing groups preserved.
- Existing groups dissolved.
- Apply then undo.
- User closes a tab after apply, then undo reports missing tab.

Provider behavior:

- Fake planner works offline.
- OpenAI valid key.
- OpenAI invalid key.
- DeepSeek valid key.
- DeepSeek invalid key.
- Provider returns invalid JSON or invalid plan.

Page sampling:

- Off by default.
- Active tab only.
- Background tab rejected in active-tab mode.
- Missing host permission returns `permission_required`.
- Granted origin samples only that origin.

## Evidence Links

- Chrome APIs: `docs/permissions-research.md` and
  `docs/multi-window-feasibility.md`.
- OpenAI structured output behavior:
  https://developers.openai.com/api/docs/guides/structured-outputs
- DeepSeek JSON Output:
  https://api-docs.deepseek.com/guides/json_mode
- DeepSeek Chat Completions API:
  https://api-docs.deepseek.com/api/create-chat-completion
- DeepSeek models and base URL:
  https://api-docs.deepseek.com/quick_start/pricing
