# Multi-Window Feasibility

Conclusion: consolidate-to-one-window is feasible in Chrome extensions, with normal-window-only constraints and careful rollback. It should be implemented as a controlled runtime operation, not as a direct LLM tool.

## API Support

Chrome exposes the needed primitives:

- `chrome.windows.getAll({ populate: true, windowTypes: ["normal"] })` can enumerate normal windows and their tabs. With the `"tabs"` permission, populated tabs include sensitive properties such as `url`, `pendingUrl`, `title`, and `favIconUrl`.
- `chrome.windows.create({ tabId })` can create a new window containing an existing tab. This avoids creating an extra New Tab page when the user chooses "new AI-organized window".
- `chrome.tabs.move(tabIds, { windowId, index: -1 })` can move one or more tabs to another window. Chrome documents that tabs can only be moved to and from normal windows.
- `chrome.tabs.group({ tabIds, createProperties: { windowId } })` can create tab groups, and `chrome.tabGroups.update(groupId, { title, color, collapsed })` can set labels and display state.
- `chrome.tabGroups.move(groupId, { windowId, index })` can move an existing group and all its tabs to another normal window, but the MVP should not rely on moving existing groups. It is safer to move tabs, then rebuild semantic groups in the target window.

## Recommended Consolidation Algorithm

Use one validated plan for the whole active scope.

1. Snapshot all visible normal windows, tabs, active tabs, tab order, existing groups, window bounds, and window state.
2. Build the eligible tab set from all normal windows. Exclude pinned/incognito/denied/unsupported tabs according to settings.
3. If there are zero eligible tabs, return a no-op preview and do not create a target window.
4. Apply existing-group handling:
   - `preserve_existing_groups`: treat existing native groups as locked units; move or recreate them as locked groups in the target window.
   - `dissolve_existing_groups`: treat existing groups as context only; every eligible tab can be reassigned.
5. Ask the planner for a complete plan: every eligible tab must be in exactly one semantic group or in Review.
6. Preview the plan, including target window, moved tab count, excluded tabs, Review tabs, locked existing groups, and group labels.
7. On confirmation, create or choose the target window.
8. If creating a new target window, call `windows.create({ tabId: firstEligibleTabId, focused: true })` so the first moved tab becomes the window seed.
9. Move remaining eligible tabs to the target window with `tabs.move(tabIds, { windowId: targetWindowId, index: -1 })`.
10. Re-query tab state after moves. Do not rely on stale tab indices.
11. Create semantic tab groups in the target window. Put Review tabs in a Review group unless the user disables that.
12. Update group title, color, and collapsed state.
13. Persist operation journal and final result.

## Why Move Tabs Before Grouping

Native Chrome tab groups belong to one window. Creating one semantic group that contains tabs from multiple windows is not possible directly.

The safe sequence is:

```text
global plan -> move all eligible tabs to target normal window -> create native groups inside target window
```

Avoid asking the model to reason about raw Chrome calls. The model returns grouping intent; the runtime performs deterministic Chrome API operations.

## Important Constraints

### Normal Windows Only

`tabs.move` and `tabGroups.move` only support normal windows. Popup, app, devtools, and other non-normal windows should be excluded.

### Current Window Ambiguity

Chrome's "current window" can differ from the focused/topmost window, especially in service workers and extension popups. Current-window mode should resolve the active normal browser window from the popup, preferably via the last-focused active tab, and pass an explicit `windowId` through the job. Do not depend on `WINDOW_ID_CURRENT` inside background code.

### Existing Groups Are Not Durable

`tabGroups.onMoved` does not fire for group moves between windows; Chrome treats a cross-window group move as removed from one window and created in another. Group IDs are unique within a browser session but should not be treated as stable rollback handles after cross-window operations.

For the MVP, rebuild semantic groups from tab IDs after all tabs have moved into the target window.

### Window Auto-Close

Moving the last tab out of a source window can close that source window. Rollback therefore must store source window bounds, state, active tab, tab order, and group memberships before the first mutating call.

### Tab State Can Change Mid-Operation

Users can close, drag, pin, or navigate tabs while the operation is running. The executor must:

- refresh tab inventory immediately before apply;
- serialize or micro-batch tab mutations;
- retry transient "tabs cannot be edited right now" errors;
- stop and report partial failure when a tab disappears;
- use the rollback snapshot for best-effort restore.

### Pinned Tabs

Pinned tabs have special ordering behavior. Keep `includePinnedTabs` off by default. If enabled, either move pinned tabs as a separate phase or unpin/re-pin with explicit preview. The MVP should avoid changing pinned state unless the user opts in.

### Incognito

Incognito tabs are visible only when the user enables extension access in incognito and the extension opts into handling them. Keep them excluded by default.

### Page Sampling

Multi-window consolidation does not require page content access. Metadata-only grouping can use titles and sanitized URLs. Page sampling should remain separately gated behind optional `scripting` and the appropriate page-origin access.

For bulk multi-window page sampling, `activeTab` is insufficient because it covers only the user-invoked active tab. Sampling background tabs requires granted host permission for each sampled origin. Missing host permission should degrade to metadata-only for that tab.

## Rollback Requirements

Rollback is feasible but not perfect. The snapshot must include:

- source windows: id, type, incognito, focused, state, bounds, active tab id, tab order;
- tabs: id, window id, index, pinned, active/highlighted state, group id;
- source groups: id, window id, title, color, collapsed state, tab order;
- created target window id;
- created semantic group ids;
- operation journal for each create/move/group/update step.

Rollback can restore tabs that still exist. It cannot restore a tab the user closed unless session restore is implemented separately.

## Feasibility Verdict

Technically feasible:

- enumerate all normal windows;
- move all eligible tabs into one normal target window;
- rebuild native semantic tab groups there;
- provide best-effort undo.

Main risks are not API availability. They are operation safety, race conditions, rollback fidelity, and user surprise. The right MVP shape is:

- metadata-only first;
- preview before every cross-window move;
- single validated plan covering all eligible tabs;
- current-window mode by default;
- consolidate-to-one-window behind an explicit switch;
- best-effort undo with clear limitations.
