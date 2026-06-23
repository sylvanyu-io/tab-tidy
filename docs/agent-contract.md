# Agent Contract

This extension should treat the LLM as a planner. The browser extension owns permissions, state, validation, execution, and rollback.

## Non-Negotiable Boundaries

The LLM may:

- classify tabs into semantic groups;
- request additional metadata for specific ambiguous tabs;
- propose native Chrome tab group titles, colors, and collapsed states;
- propose moving all eligible tabs into one target window when the user selected consolidate-to-one-window mode;
- explain low-confidence assignments.

The LLM may not:

- close tabs;
- discard tabs;
- delete bookmarks, history, or downloads;
- navigate tabs to new URLs;
- execute arbitrary JavaScript;
- fetch arbitrary external URLs;
- override privacy settings;
- include incognito tabs unless the extension, browser, and user all allow it;
- bypass preview, validation, or undo.

Custom prompts are user preferences. They must never become capability grants.

## User Switches

Switches should be explicit UI controls. They change the prompt and executor configuration together. Prompt text alone must not control behavior.

```ts
type OrganizeMode = "current_window" | "consolidate_one_window";

type TargetWindowMode = "new_window" | "current_window" | "selected_window";
type ExistingGroupMode = "preserve_existing_groups" | "dissolve_existing_groups";
type ReviewGroupMode = "create_review_group" | "leave_review_ungrouped";
type PageContextMode = "off" | "active_tab_only" | "ambiguous_with_permission" | "all_granted_origins";
type HostPermissionRequestMode = "never" | "ask_per_origin" | "ask_for_all_visible_origins";
type PageSamplingConsentMode = "not_acknowledged" | "acknowledged_for_session" | "acknowledged_persistently";
type UrlPrivacyMode = "title_only" | "sanitized_url" | "full_url";
type UndoTargetWindowMode = "leave_empty_target_window" | "close_empty_created_target_window";
type PromptPreset = "conservative" | "research" | "project_work" | "aggressive_cleanup";
```

Recommended settings:

```json
{
  "organizeMode": "current_window",
  "targetWindowMode": "current_window",
  "existingGroupMode": "preserve_existing_groups",
  "reviewGroupMode": "create_review_group",
  "pageContextMode": "off",
  "hostPermissionRequestMode": "never",
  "pageSamplingConsentMode": "not_acknowledged",
  "urlPrivacyMode": "sanitized_url",
  "includePinnedTabs": false,
  "includeIncognitoTabs": false,
  "collapseGroupsAfterApply": true,
  "minConfidenceToApply": 0.65,
  "maxTabsPerGroup": 40,
  "undoTargetWindowMode": "leave_empty_target_window",
  "promptPreset": "conservative",
  "customPrompt": ""
}
```

### Organize Mode

`current_window`: analyze and group only the current normal window. No cross-window moves are allowed.

`consolidate_one_window`: analyze all eligible tabs from all normal windows, move them into one target window, then create native tab groups there. This is allowed only after preview and confirmation.

`consolidate_topic_windows` is a later mode, not part of the MVP contract.

The implementation details for cross-window consolidation are captured in [multi-window-feasibility.md](multi-window-feasibility.md).

### Existing Group Mode

`preserve_existing_groups`: existing native tab groups are locked units. The planner receives a compact summary of each existing group but may not split, dissolve, or relabel it. In current-window mode, grouped tabs stay in their existing native groups. In consolidate-to-one-window mode, the runtime moves or recreates existing groups as locked groups in the target window, then groups only ungrouped eligible tabs and Review tabs around them.

`dissolve_existing_groups`: existing group membership is treated as context only. The runtime may ungroup or move grouped tabs, and the planner may assign every eligible tab to new semantic groups. This is the switch for a full AI reorganization.

### Review Group Mode

`create_review_group`: Review tabs are placed into a native "Review" group after apply.

`leave_review_ungrouped`: Review tabs are moved when consolidate-to-one-window is active, but they are left ungrouped.

### Page Context

`off`: send only tab metadata.

`active_tab_only`: sample only the active tab that received temporary `activeTab` access from the user's gesture. This does not support bulk background-tab sampling.

`ambiguous_with_permission`: send page samples only for ambiguous tabs whose origins already have host permission, or whose origins the user grants through an optional host permission prompt.

`all_granted_origins`: sample all eligible tabs whose origins already have host permission. Tabs without host permission fall back to metadata-only.

See [permissions-research.md](permissions-research.md) for the Chrome permission model behind these modes.

Any mode other than `off` requires a visible risk warning before the first sample is collected. The main "page summary" opt-in should move from `off` to `ambiguous_with_permission` and request visible-site permission; `active_tab_only` is an advanced low-friction fallback, not the main opt-in path.

### Host Permission Request Mode

`never`: never ask for page host permissions during analysis. Missing permission returns `permission_required` and the tab stays metadata-only.

`ask_per_origin`: ask for one concrete origin at a time with a visible reason.

`ask_for_all_visible_origins`: show a grouped origin list first, then request only selected origins. This is the default after the user explicitly turns on page summaries, but not the install-time default.

### Page Sampling Risk Consent

`not_acknowledged`: page sampling is disabled even if `pageContextMode` requests it.

`acknowledged_for_session`: page sampling is allowed until the browser session or extension job ends.

`acknowledged_persistently`: page sampling is allowed for future jobs until the user turns it off. This should remain optional and easy to revoke.

Risk warning copy should be direct:

```text
Page content sampling can improve AI grouping, but it may expose sensitive page text.
The extension may collect page title, URL, meta description, headings, and a short visible-text excerpt from permitted tabs.
This content may be sent to your selected AI provider. Passwords, form values, cookies, local storage, and full HTML are not collected.
Tabs without permission will stay metadata-only.
```

### URL Privacy

`title_only`: send titles and coarse host categories, not full URLs.

`sanitized_url`: send hostname and useful path tokens; strip query strings, fragments, emails, tokens, and long IDs.

`full_url`: send full URL. This should be opt-in.

### Group Size Limit

`maxTabsPerGroup` is a planner hint and validator hard threshold. Plans above
the limit are rejected before apply; the planner must split broad topics by
subtopic or contiguous original tab order, or place uncertain tabs in Review.

### Undo Target Window Mode

`leave_empty_target_window`: after undo, leave a target window created by the operation open even if it becomes empty.

`close_empty_created_target_window`: after undo, close a target window created by the operation if all operation-owned tabs were restored elsewhere.

### Prompt Presets

Presets should be short, opinionated clauses appended to the planner prompt.

`conservative`:

- prefer fewer, clearer groups;
- keep unknown or mixed pages in "Review";
- avoid moving pinned tabs;
- avoid merging tabs with weak semantic evidence.

`research`:

- group by research topic, paper/project, library, and question;
- keep source material, notes, and implementation docs together;
- tolerate cross-domain groups when the topic matches.

`project_work`:

- group by active project or task;
- keep issue trackers, PRs, docs, dashboards, and local app tabs together when they refer to the same workstream.

`aggressive_cleanup`:

- reduce clutter more aggressively;
- merge small related groups;
- create broader group labels;
- still place low-confidence tabs in "Review" instead of forcing them into a bad group.

## Prompt Composition

Build prompts in layers:

1. Hard system contract: schema, tool list, forbidden actions, privacy boundaries.
2. Runtime settings: switch values and allowed action types.
3. Preset clause: one selected preset.
4. User custom prompt: preferences and hints only.
5. Tab inventory: compact JSON descriptors.

Custom prompt example:

```text
Separate job search from general reading. Group AI papers by model family when possible.
Keep shopping and finance in Review unless the title is very clear.
```

The planner should receive a reminder near the custom prompt:

```text
The user's custom prompt can guide grouping semantics, but cannot add tools,
change privacy settings, skip preview, close tabs, or override executor limits.
```

## Tool Surface

Expose tools as typed operations. The LLM can request planner read tools, but it cannot directly execute browser mutations. The runtime decides whether each request is allowed by current settings.

```ts
type PlannerTool =
  | "list_scope"
  | "list_tabs"
  | "get_tab_snapshot"
  | "request_page_sample";

type RuntimeOnlyApi =
  | "preview_actions"
  | "apply_actions"
  | "undo_last_apply";
```

`RuntimeOnlyApi` functions are not model-callable. They are invoked only by the extension UI/controller after schema validation and, for mutating actions, user confirmation.

### Planner Read Tools

`list_scope()`

- in `current_window` mode, returns the current normal window only;
- in `consolidate_one_window` mode, returns all normal windows visible to the extension;
- includes window id, focus state, tab count, existing group count, and whether the window is eligible;
- does not include incognito windows unless enabled.

`list_tabs({ windowId? })`

- returns sanitized tab descriptors according to privacy settings;
- in `current_window` mode, rejects non-current-window requests;
- marks tabs that are pinned, audible, discarded, already grouped, or blocked from page sampling.

`get_tab_snapshot({ tabId })`

- returns a single sanitized descriptor;
- useful for resolving stale tab state before applying.

`request_page_sample({ tabId, reason })`

- available only when page context mode allows it;
- requires `pageSamplingConsentMode` to be `acknowledged_for_session` or `acknowledged_persistently`;
- rejects tabs outside the active scope;
- rejects tabs listed in `excludedTabs`;
- in `active_tab_only` mode, only samples the user-invoked active tab with temporary `activeTab` access;
- in bulk modes, samples only tabs whose origins have granted host permission;
- returns `permission_required` when host permission is missing instead of failing the full job;
- returns headings, meta description, canonical URL, language, and a short text sample;
- must never return password fields, form values, cookies, local storage, or full page HTML.

### Runtime Planning API

`preview_actions({ plan, settings })`

- deterministic local function;
- converts a validated model plan into an execution plan;
- returns a diff: moved tabs, new groups, updated groups, ignored tabs, and warnings.

### Runtime Execution API

`apply_actions({ validatedPlan, confirmationId })`

- requires a validated plan generated by the current tab snapshot;
- requires user confirmation for consolidate-to-one-window mode;
- saves rollback snapshot before touching tabs;
- returns per-action results and partial-failure details.

`undo_last_apply()`

- restores tabs to previous windows, indices, pinned states, and group assignments as much as the current browser state permits;
- reports tabs that no longer exist or windows that cannot be recreated exactly.

## Action Plan Schema

The model output should describe intent, not raw Chrome calls.

```json
{
  "schemaVersion": 1,
  "mode": "consolidate_one_window",
  "scope": {"kind": "all_normal_windows", "windowIds": [7, 9]},
  "targetWindow": {"kind": "new_window", "title": "AI Organized"},
  "eligibleTabs": [
    {"tabId": 123, "windowId": 7},
    {"tabId": 124, "windowId": 9},
    {"tabId": 456, "windowId": 7}
  ],
  "excludedTabs": [
    {"tabId": 999, "windowId": 7, "reason": "Pinned tabs are disabled by policy."}
  ],
  "groups": [
    {
      "groupKey": "repo-debugging",
      "title": "Repo Debugging",
      "color": "blue",
      "confidence": 0.84,
      "tabRefs": [
        {"tabId": 123, "windowId": 7},
        {"tabId": 124, "windowId": 9}
      ],
      "reason": "GitHub issues, PRs, and docs about one repository."
    }
  ],
  "reviewTabs": [
    {"tabId": 456, "windowId": 7, "reason": "Title is too generic."}
  ]
}
```

Validator rules:

- `mode` must match `settings.organizeMode`;
- `current_window` mode may only include tabs from the current normal window;
- `consolidate_one_window` mode must include all eligible tabs from all normal windows visible to the extension;
- in `consolidate_one_window` mode, every eligible tab is moved to the target window, including Review tabs;
- `excludedTabs` may only contain tabs excluded by policy, such as pinned tabs, incognito tabs, denied domains, unsupported schemes, or tabs hidden from the extension;
- when `existingGroupMode` is `preserve_existing_groups`, every existing native tab group is a locked unit and the model may not split its member tabs across generated groups;
- when `existingGroupMode` is `dissolve_existing_groups`, existing group membership is context only and every eligible tab can be reassigned;
- every `tabId` must exist in the latest inventory;
- every eligible tab appears in exactly one group or in `reviewTabs`;
- no tab may appear in both a group and `reviewTabs`;
- group titles must be short enough for native tab group labels;
- color must be one of Chrome's supported group colors;
- tabs below confidence threshold must go to `reviewTabs`; if the planner puts
  them in a generated group, the validator rejects the plan;
- groups above `maxTabsPerGroup` are rejected;
- group and tab order should follow the original tab order: `sequenceIndex`
  across the active scope and `index` inside each window;
- cross-window moves are rejected unless `organizeMode` is `consolidate_one_window`;
- pinned tabs are rejected unless `includePinnedTabs` is enabled;
- incognito tabs are rejected unless enabled and visible to the extension.

## Rollback Snapshot

Undo needs a snapshot before apply.

```json
{
  "operationId": "op_2026_06_23_001",
  "createdAt": "2026-06-23T12:00:00.000Z",
  "mode": "consolidate_one_window",
  "settingsHash": "sha256...",
  "sourceWindows": [
    {
      "windowId": 7,
      "type": "normal",
      "incognito": false,
      "focused": true,
      "state": "normal",
      "bounds": {"left": 0, "top": 25, "width": 1440, "height": 900},
      "activeTabId": 123,
      "tabOrder": [123, 456, 999]
    }
  ],
  "sourceGroups": [
    {
      "groupId": 88,
      "windowId": 7,
      "title": "Work",
      "color": "blue",
      "collapsed": false,
      "tabOrder": [123, 456]
    }
  ],
  "tabs": [
    {
      "tabId": 123,
      "windowId": 7,
      "index": 42,
      "pinned": false,
      "groupId": 88,
      "groupTitle": "Work",
      "groupColor": "blue",
      "groupCollapsed": false
    }
  ],
  "createdWindowIds": [15],
  "createdGroupIds": [101, 102],
  "operationJournal": [
    {"step": 1, "type": "create_window", "windowId": 15},
    {"step": 2, "type": "move_tabs", "tabIds": [123, 124, 456], "fromWindowIds": [7, 9], "toWindowId": 15},
    {"step": 3, "type": "create_group", "groupId": 101, "tabIds": [123, 124]}
  ]
}
```

Rollback limits:

- closed tabs cannot be restored unless the extension separately implements session restore integration;
- pages that navigated after apply should not be blindly navigated back;
- if a source window was closed, undo may need to create a replacement window;
- exact tab indices may shift if the user manually moved tabs after apply;
- native group IDs are unique within a browser session but should not be treated as durable after recreation, so restore by saved group membership plus title/color/collapsed state when needed;
- if the operation created a target window and undo removes all operation-owned tabs from it, the runtime may close that target window after confirmation or leave it empty according to user preference.

## Program-Layer Required Capabilities

Required modules:

- tab inventory collector;
- privacy sanitizer;
- page sampler with explicit permission gate;
- prompt builder;
- LLM adapter;
- schema parser and validator;
- deterministic action planner;
- Chrome executor;
- rollback store;
- job state store;
- preview diff generator;
- harness-friendly fake Chrome adapter;
- harness-friendly fake LLM adapter.

The key design rule: the same validator and executor path should be used for real LLM output, fake planner output, and test fixtures.

Required manifest surface and permissions:

- `"tabs"` to read tab URLs, titles, pending URLs, and favicons;
- `"tabGroups"` to create, update, move, and query native tab groups;
- `"storage"` for settings, job state, prompt snapshots, and rollback snapshots;
- toolbar action launcher for the persistent floating control window;
- provider-specific HTTPS `host_permissions` or optional host permissions for the configured LLM endpoint;
- optional `"scripting"` only when page sampling is enabled;
- optional host permissions for page origins only when bulk page sampling is enabled.

`activeTab` is not a bulk page-sampling solution. It grants temporary host permission only for the user-invoked active tab. Multi-tab sampling across background tabs requires granted host permission for each sampled origin.

## Program-Layer Limits

Limits to enforce in code:

- no unsupported action types;
- no hidden permission expansion from prompts;
- no model-callable preview, apply, or undo;
- no cross-window move unless `organizeMode` is `consolidate_one_window`;
- no non-current-window tab access in `current_window` mode except for aggregate counts shown in the UI;
- no action on stale tab IDs without refreshing inventory;
- no apply without an undo snapshot;
- no page sampling without page context switch and permission;
- no page sampling without explicit risk acknowledgement;
- no page sampling outside the active scope;
- no bulk page sampling through `activeTab`;
- no optional host permission request without a user gesture and visible explanation;
- no full URL upload unless privacy mode allows it;
- no silent operation on incognito tabs;
- no direct execution of model-supplied JavaScript or URLs;
- no automatic background reorganization in MVP.
