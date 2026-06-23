# Release Readiness

This project is no longer treated as a demo. The release target is a Chrome MV3
extension that can be published after the gates below are satisfied.

## Current Production Posture

Implemented:

- Manifest V3 extension shell with an action popup UI.
- Current-window organization by default.
- Explicit consolidate-to-one-window mode for all eligible normal-window tabs.
- Metadata-only inventory and URL sanitization.
- Existing native group preserve/dissolve switch.
- Page sampling off by default with explicit consent and permission gates.
- Fake, AI gateway, and DeepSeek planner providers.
- Local schema validation before every browser mutation.
- Low-confidence groups below the apply threshold are rejected; the planner must
  put uncertain tabs in Review.
- Groups above `maxTabsPerGroup` are rejected instead of applied as oversized
  catch-all groups.
- Tab inventory includes original `sequenceIndex` plus per-window `index`, and
  planner prompts treat nearby tabs as semantic context.
- Target-window selection is validated against user settings; planner output
  cannot redirect apply to an arbitrary window.
- Preview before apply and rollback snapshot persisted before the first browser
  mutation.
- Rollback snapshots are refreshed during apply, so partial failures remain
  undoable.
- Fake Chrome harness, Playwright UI smoke test, and real-extension stress
  runner against an isolated Chromium profile.
- Planner network calls have a timeout instead of hanging indefinitely.
- Active analysis jobs expose coarse progress states in the popup and can be
  canceled; cancellation aborts provider fetches when the request is still live.
- Large AI gateway jobs use a coarse-then-refine planner: a low-effort coarse
  bucket pass, followed by high-effort refinement for oversized or uncertain
  buckets, then normal local validation.

Not production-complete yet:

- No Chrome Web Store assets or listing text.
- No signed release package workflow.
- No provider key management beyond local BYOK storage.
- No provider-specific adaptive scheduler beyond the AI gateway coarse/refine
  path.
- No telemetry/diagnostics toggle.

## Release Gates

Blocking gates:

- `npm run check` passes.
- `npm run release:check` passes and produces a clean extension package.
- DeepSeek live smoke passes with a disposable key.
- AI gateway live smoke passes with a disposable key.
- `npm run stress:extension` validates current-window apply/undo and
  consolidate-to-one-window apply/undo on a throwaway Chromium profile.
- Page sampling cannot run without visible risk acknowledgement.
- Page sampling active-tab mode cannot sample background tabs.
- Bulk page sampling returns `permission_required` without host permission.
- Bulk page sampling can request `scripting` plus visible-site host permissions
  from the popup user gesture and sample page body text.
- Low-confidence groups below the apply threshold fail validation.
- Current-window and selected-window targets must match user settings, not model
  preference.
- Empty consolidate jobs do not create target windows.
- Partial apply failure keeps a rollback snapshot and undo can restore surviving
  tabs.
- If a tab disappears mid-apply, the executor fails rather than silently grouping
  a partial tab set.
- No provider key appears in git history, screenshots, test output, or fixtures.
- Extension package contains no `node_modules`, test outputs, or local secrets.

Recommended before public listing:

- Add provider setup screen that explains BYOK storage.
- Add export/import settings without exporting API keys by default.
- Add first-run privacy disclosure.
- Add error recovery UI for provider rate limit, invalid key, and invalid plan.
- Expand adaptive planning beyond the AI gateway path if other providers become
  first-class large-session targets.
- Add release build script that zips only manifest, src, docs/licenses needed by
  the runtime, and static assets.

## Provider Policy

The extension uses bring-your-own-key provider credentials. Runtime rules:

- Never ship a shared provider key.
- Never commit provider keys.
- Redact keys from job snapshots and logs.
- Use provider-specific host permissions only.
- Keep provider output as planning intent only; validator/executor remain local.

AI gateway:

- Uses a chat-completions-compatible gateway with JSON object output.
- Exposes only planner-suitable text models in the UI.
- Adapts common `tabIds` grouping output, then still requires local validation.

DeepSeek:

- Uses `/chat/completions` with `response_format: {"type": "json_object"}`.
- Because JSON Output does not enforce the full local schema, every DeepSeek plan
  must pass local validation before preview/apply.
- The controller retries once with validation feedback for non-fake providers.

## Browser Safety Rules

- Do not close, discard, reload, or navigate tabs.
- Do not execute model-supplied JavaScript.
- Do not perform browser mutations without a rollback snapshot.
- Do not let planner-supplied `targetWindow` override the user-selected target.
- Do not apply groups below the configured confidence threshold.
- Do not silently apply a group if any tab in that group disappeared mid-apply.
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
- AI gateway valid key.
- AI gateway invalid key.
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
- DeepSeek JSON Output:
  https://api-docs.deepseek.com/guides/json_mode
- DeepSeek Chat Completions API:
  https://api-docs.deepseek.com/api/create-chat-completion
- DeepSeek models and base URL:
  https://api-docs.deepseek.com/quick_start/pricing
