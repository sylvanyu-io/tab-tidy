# Evaluation Harness

The harness should make the extension testable without a real browser profile and without paying for LLM calls.

## Goals

- verify prompt construction from switches and custom prompt;
- verify schema parsing and validation;
- verify action planning for current-window and consolidate-one-window modes;
- verify rollback snapshots before execution;
- verify executor behavior against a fake Chrome API;
- compare LLM grouping quality against golden fixtures;
- reproduce bugs from saved tab inventories.

## Test Layers

### 1. Fixture Tests

Input: synthetic browser state.

```json
{
  "windows": [
    {
      "windowId": 1,
      "focused": true,
      "tabs": [
        {"tabId": 11, "index": 0, "title": "React useEffect docs", "url": "https://react.dev/reference/react/useEffect"},
        {"tabId": 12, "index": 1, "title": "Issue #88 hydration bug", "url": "https://github.com/acme/app/issues/88"}
      ]
    }
  ]
}
```

Expected output:

- normalized tab descriptors;
- sanitized prompt payload;
- planner JSON;
- preview diff;
- final fake Chrome state;
- rollback result.

### 2. Prompt Snapshot Tests

For each switch combination, snapshot the prompt payload. This prevents accidental privacy regressions.

Required assertions:

- `title_only` mode does not include full URLs;
- `sanitized_url` mode strips query strings and long IDs;
- `full_url` mode includes full URLs only when explicitly selected;
- custom prompt appears in the user-hints section, not in the hard contract;
- forbidden actions remain present after custom prompt is added;
- consolidate mode adds move permissions, current-window mode does not.
- existing-group mode changes prompt payload and executor constraints;
- page context mode and host permission request mode appear as separate runtime settings.

### 3. Schema And Validator Tests

Feed intentionally bad planner outputs:

- unknown tab ID;
- duplicate tab assignment;
- invalid window ID;
- unsupported action type;
- overlong group title;
- invalid group color;
- low-confidence forced assignment;
- cross-window move while current-window mode is active;
- non-current-window tab included while current-window mode is active;
- missing eligible tabs while consolidate-to-one-window mode is active;
- model omits excluded tabs instead of explaining policy exclusions;
- existing group split while `preserve_existing_groups` is active;
- existing group preserved while `dissolve_existing_groups` expects full regrouping;
- group over `maxTabsPerGroup` without a broad-group reason;
- pinned tab included when pinned tabs are disabled;
- incognito tab included when incognito is disabled;
- model attempts to close or navigate a tab.

Expected result: reject with structured errors and no executor calls.

### 4. Executor Tests

Use a fake Chrome adapter that implements:

- `windows.getAll`;
- `windows.create`;
- `tabs.query`;
- `tabs.move`;
- `tabs.group`;
- `tabGroups.update`;
- `tabGroups.move`;
- `storage.local` calls used by the extension.

The fake adapter should model enough behavior to catch mistakes:

- tab indices change after moves;
- group IDs are unique within the fake browser session, with each group carrying a `windowId`;
- moving a group across windows preserves or recreates membership according to the Chrome API behavior the executor relies on;
- pinned tabs cannot be mixed casually with normal tab ordering;
- windows can be closed or missing;
- partial failures can occur midway through apply.

### 5. Rollback Tests

Required scenarios:

- current-window grouping, then undo;
- consolidate-to-one-window, then undo;
- consolidate-to-one-window with zero eligible tabs returns no-op preview and no executor calls;
- target window was created by the operation, then undo removes or empties it according to policy;
- user manually closes one moved tab before undo;
- user closes the source window before undo;
- existing groups are restored by title/color/collapsed state;
- existing groups are locked when `preserve_existing_groups` is active;
- existing groups are dissolved and rebuilt when `dissolve_existing_groups` is active;
- source window bounds, state, focused status, and active tab are restored as far as Chrome allows;
- partial apply failure triggers best-effort rollback.

Rollback assertion: the restored fake state should match the pre-apply snapshot for all tabs that still exist.

### 6. Permission Tests

Required scenarios:

- metadata-only mode needs no page host permission;
- page sampling is blocked until the risk warning is acknowledged;
- session-only acknowledgement expires after the job/session boundary;
- persistent acknowledgement can be revoked in settings;
- `active_tab_only` samples only the user-invoked active tab;
- current-window mode rejects page samples from other windows;
- `ambiguous_with_permission` samples only granted origins;
- missing host permission returns `permission_required`;
- denied optional host permission falls back to metadata-only;
- custom prompt cannot change page sampling permission mode;
- provider network calls require the configured provider endpoint permission.

### 7. LLM Quality Tests

Use saved planner outputs first, then optional live model tests.

Fixture categories:

- many GitHub tabs across different repositories;
- papers, docs, and implementation tabs for the same research topic;
- shopping, finance, health, and personal pages that should avoid over-sharing;
- Chinese and English titles mixed together;
- repeated generic titles from long-tail domains;
- tabs from the same domain that belong to different semantic groups;
- tabs from different domains that belong to the same semantic group.

Metrics:

- percentage of tabs assigned to the expected group;
- number of bad forced assignments;
- number of tabs placed in Review;
- group title quality;
- prompt token count;
- apply safety violations caught by validator.

## CLI Shape

Keep the harness runnable from the repo root.

```bash
npm run test:harness
npm run test:harness -- --fixture fixtures/large-research-session.json
npm run test:prompt-snapshots
npm run test:executor
```

Later, add live model checks behind an explicit environment variable:

```bash
LIVE_LLM=1 npm run test:llm
```

Live tests must never run by default.

## Fixture Directory

Recommended layout:

```text
fixtures/
  browser-states/
    small-project-work.json
    multi-window-research.json
    large-500-tabs.json
  planner-outputs/
    valid-consolidate-one-window.json
    invalid-duplicate-tabs.json
    invalid-cross-window-current-window-mode.json
  goldens/
    multi-window-research.groups.json
```

## Useful Invariants

These should hold in every automated test:

- in current-window mode, every eligible tab in the current window is either assigned to one group or placed in Review;
- in consolidate-to-one-window mode, every eligible tab from every normal window is moved to the target window and either assigned to one group or placed in Review;
- every ineligible tab is listed in `excludedTabs` with a policy reason;
- no tab appears in two groups;
- execution never runs on unvalidated model output;
- an undo snapshot exists before the first mutating operation;
- privacy settings affect both prompt payload and page sampler behavior;
- custom prompt can affect classification but cannot affect allowed actions;
- fake planner, live LLM planner, and imported JSON fixtures use the same schema.
