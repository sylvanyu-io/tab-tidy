# Permissions Research

This extension should keep metadata-only grouping as the baseline and treat page sampling as an optional capability. The permission model matters because open tabs are highly sensitive.

## Chrome Permission Facts

### Tab Metadata

The `"tabs"` permission lets the extension read sensitive `tabs.Tab` fields such as `url`, `pendingUrl`, `title`, and `favIconUrl` when querying tabs. This is enough for the MVP's metadata-only planner.

Host permissions can also expose those fields for matching tabs, but `"tabs"` is simpler for an all-tab organizer because it applies across the user's visible tab set.

### Script Injection For Page Sampling

To sample headings, meta descriptions, and visible text, the extension needs `chrome.scripting.executeScript()`.

Chrome requires:

- the `"scripting"` permission; and
- host permission for the target page, either persistent host permissions or temporary `activeTab` access.

`activeTab` is not enough for multi-tab background sampling. It grants temporary access only to the currently active tab after a user gesture, and that access ends when the tab navigates or closes. It is useful for "sample this active tab now", not for sampling 100+ background tabs across windows.

For multi-tab page sampling, the practical option is optional host permissions:

- declare broad optional host permissions, such as `https://*/*`, in `optional_host_permissions`;
- request specific origins with `chrome.permissions.request()` from a user gesture;
- sample only tabs whose origins are granted;
- fall back to metadata-only for tabs without host permission.

### LLM Provider Network Calls

The extension service worker or floating window can call remote LLM providers only if the extension has host permission for those provider endpoints. Provider endpoints should be narrow or requested as optional origins, for example:

- `https://api.anthropic.com/`
- `https://generativelanguage.googleapis.com/`
- `http://127.0.0.1/` for local chat-completions-compatible gateways during development.

Avoid declaring `https://*/*` as a required host permission for provider calls. Use provider-specific required or optional host permissions.

## Recommended Permission Strategy

MVP required permissions:

```json
{
  "permissions": ["tabs", "tabGroups", "storage", "activeTab"],
  "host_permissions": [],
  "optional_permissions": ["scripting"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "action": {"default_title": "Semantic Tab Agent"}
}
```

Notes:

- Provider host permissions depend on the configured provider. If the provider is user-selectable, prefer optional provider host permissions and request them during setup.
- Keep `scripting` optional until page sampling is enabled.
- Keep `optional_host_permissions` broad only as an optional declaration. Request concrete origins at runtime.
- Do not ask for all site access during install.
- The toolbar action launches a persistent `type: "popup"` extension window instead of `action.default_popup`, because Chrome action popups automatically close on focus loss and cannot be kept open while the user handles permission prompts.

## Page Sampling Modes

```ts
type PageContextMode = "off" | "active_tab_only" | "ambiguous_with_permission" | "all_granted_origins";
type HostPermissionRequestMode = "never" | "ask_per_origin" | "ask_for_all_visible_origins";
```

`off`: metadata-only. No scripting permission needed.

`active_tab_only`: can use `activeTab` + `scripting` for the invoked active tab. This is useful for internal compatibility tests, but not for the consumer-facing tab organization flow.

`ambiguous_with_permission`: narrower mode for ambiguous tabs only. The runtime samples only tabs whose origins already have host permission or whose origins the user grants.

`all_granted_origins`: consumer default after the user turns on page summaries. The runtime should request visible-site origins first, then sample as many eligible granted tabs as possible.

`ask_per_origin`: prompt for one origin at a time with a clear reason.

`ask_for_all_visible_origins`: high-friction mode. Show a grouped origin list first, then request only the selected origins. It is acceptable as the page-summary opt-in default because it follows an explicit risk warning and keeps install-time permissions narrow.

## User Risk Warning

Page sampling must be opt-in and blocked until the user acknowledges a risk warning.

Recommended warning:

```text
Page content sampling can improve AI grouping, but it may expose sensitive page text.
The extension may collect page title, URL, meta description, headings, and a short visible-text excerpt from permitted tabs.
This content may be sent to your selected AI provider. Passwords, form values, cookies, local storage, and full HTML are not collected.
Tabs without permission will stay metadata-only.
```

The UI should offer session-only acknowledgement and persistent acknowledgement. Persistent acknowledgement must be easy to revoke in settings.

## Runtime Rules

- Page sampling must respect active scope: current-window mode cannot sample non-current-window tabs.
- Page sampling must reject `excludedTabs`.
- Page sampling must reject unsupported schemes such as `chrome://`, `chrome-extension://`, `file://` unless explicitly supported later.
- Page sampling must reject all requests until the user acknowledges the risk warning.
- If permission is missing, return a structured `permission_required` result instead of failing the job.
- The model can ask for page samples, but the runtime decides whether sampling is allowed.
- Metadata-only planning must continue to work even when all page sampling is denied.

## Harness Coverage

Add tests for:

- `active_tab_only` sampling rejects background tabs;
- current-window mode rejects samples from other windows;
- `ambiguous_with_permission` samples only granted origins;
- missing host permission returns `permission_required`;
- denied optional host permission falls back to metadata-only;
- custom prompt cannot change page sampling permissions.

## Sources

- Chrome Tabs API permission behavior: https://developer.chrome.com/docs/extensions/reference/api/tabs
- Chrome `activeTab` permission: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- Chrome Scripting API permission requirements: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome optional permissions API: https://developer.chrome.com/docs/extensions/reference/api/permissions
- Chrome cross-origin network requests: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
