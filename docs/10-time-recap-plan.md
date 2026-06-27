# Time Recap Development Plan / 时间段回顾开发计划

Status: implementation in progress. The current codebase now has a core recap input builder, gateway recap planner, local fallback, runtime message, side-panel entry, and focused unit coverage. Remaining work is UI smoke coverage, real-browser verification, and benchmark evidence before release.

This document records the product plan for "summarize what I did during a time period" and the acceptance checks needed before treating it as release-ready. TabRecap already records useful local signals; the feature turns those signals into a user-facing recap instead of a developer activity dump.

## Product Goal

TabRecap should help a user answer:

- "What have I mainly been working on recently?"
- "Which research or project threads are still open?"
- "Which old tabs look like leftovers from a previous phase?"
- "Where can I quickly jump back in?"

This is not a browser history replacement. It is a local, best-effort work recap built from open-tab metadata, tab activity, and optional page summaries.

## Non-Goals

- Do not auto-close tabs.
- Do not read full browser history.
- Do not promise complete tracking while Chrome suspends the MV3 service worker.
- Do not expose raw implementation terms such as `activeCount`, `ageDays`, `idleDays`, or internal cache keys in UI copy.
- Do not make this a separate generic note-taking product.

## Current Baseline

Existing implementation pieces:

- `src/core/page-activity-cache.js`
  - Stores sanitized URL key, title, hostname, first seen, last seen, seen count, last tab/window, and compact sample metadata.
  - `getActivityOverview()` already returns a local `recap`, open-tab signals, lifecycle stats, and old-tab candidates.
  - Activity cache TTL is 45 days and max entries are 1400.
- `src/core/page-summary-cache.js`
  - Stores opt-in short page summaries for permitted, non-incognito, non-discarded pages.
  - Cache TTL is 14 days and max entries are 800.
  - Stores compact page fields, not cookies, form values, local storage, full HTML, or full visible text.
- `src/core/tab-lifecycle-log.js`
  - Records open, activate, update, close, inferred open/close, and reconcile events.
  - Tracks first observed, last observed, last activated, active count, pinned/discarded/audible state.
  - Session TTL is 90 days and max sessions/events are 1800.
- `src/core/controller.js`
  - Exposes `activity:getOverview`.
  - Uses activity overview as cleanup fallback and as planner input.
- `src/core/gateway-planner.js`
  - Sends local activity rows and a compact recap to the combined grouping and cleanup planner.
- `src/sidepanel/sidepanel.js`
  - Has cleanup preview UI and a mock `activity:getOverview`, but no real time-recap screen.
- `README.md`
  - Already mentions time recap as a feature. This is ahead of implementation and must be corrected before the next release if the feature is not shipped.

Current gap:

- We have local signals, but no user-facing "Recent Recap" product flow.

## User Experience

### Entry Point

Add a top-level entry in the side panel header area:

- Primary mode remains "Organize".
- Add a secondary top entry: "近期回顾" / "Recent Recap".
- The entry should be visible without opening advanced options.

Suggested Chinese copy:

- Entry: `近期回顾`
- Subtitle: `看看最近主要在忙什么`
- CTA: `生成回顾`

Suggested English copy:

- Entry: `Recent Recap`
- Subtitle: `See what you have been working on`
- CTA: `Generate recap`

### Time Range

Provide simple presets:

- `今天`
- `最近 7 天`
- `最近 30 天`
- `自定义`

Default: `最近 7 天`.

Do not show scary coverage copy like "only read 2/200 pages" in the main result. Instead show neutral evidence copy:

- `已结合本地活动、标题、网址和可用页面摘要。`
- If the user opens details: show exact coverage numbers.

### Result Layout

The recap result should be a review surface, not a wall of text.

1. `这段时间主要在做什么`
   - 3 to 6 theme cards.
   - Each theme has a short human title, one-sentence summary, confidence, and representative tabs.

2. `任务线索`
   - Timeline-like clusters.
   - Show "started around", "recently active", "still open", and "representative pages".

3. `可能可以收尾`
   - Reuse cleanup candidates, but frame them as "worth reviewing", not "trash".
   - Actions: locate tab, select, close selected.
   - Closing remains explicit user action only.

4. `下次继续`
   - Optional next-step hints.
   - These should be light, not a project manager voice.

5. `证据详情`
   - Collapsed by default.
   - Shows exact coverage counts, top hosts, sampled entries, excluded pages, and stale-tab stats.

## Data Contract

Add a recap-specific input shape. Keep it compact and readable.

```ts
type TimeRecapInput = {
  schema: "tab_tidy_time_recap_input_v1";
  languageMode: "auto" | "zh-CN" | "en-US";
  range: {
    from: string;
    to: string;
    label: "today" | "7d" | "30d" | "custom";
  };
  coverage: {
    activityEntries: number;
    sampledEntries: number;
    openTabsTracked: number;
    lifecycleSessions: number;
    inferredEvents: number;
  };
  pages: TimeRecapPage[];
};

type TimeRecapPage = {
  tabId?: number;
  windowId?: number;
  title: string;
  hostname: string;
  sanitizedUrl?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastActivatedAt?: string;
  seenCount?: number;
  activeCount?: number;
  currentGroupTitle?: string;
  discarded?: boolean;
  pinned?: boolean;
  summary?: {
    title?: string;
    metaDescription?: string;
    contentKind?: string;
    headings?: string[];
    visibleTextExcerpt?: string;
  };
};
```

Add a strict output schema:

```ts
type TimeRecapOutput = {
  schema: "tab_tidy_time_recap_v1";
  language: "zh-CN" | "en-US";
  headline: string;
  summary: string;
  themes: Array<{
    title: string;
    description: string;
    confidence: "high" | "medium" | "low";
    tabIds: number[];
    evidence: string[];
  }>;
  timeline: Array<{
    label: string;
    description: string;
    tabIds: number[];
  }>;
  followUps: Array<{
    title: string;
    reason: string;
    tabIds: number[];
  }>;
  reviewCandidates: Array<{
    tabId: number;
    priority: "high" | "medium" | "low";
    reason: string;
    evidence: string[];
  }>;
  coverageNote: string;
};
```

Validation rules:

- Every returned `tabId` must exist in the recap input or be dropped.
- Empty or duplicate themes are merged or removed locally.
- Review candidates are suggestions only.
- Output language must follow the selected UI language.
- Do not allow the model to request permissions or browser mutations.

## AI Strategy

Start simple:

- Use the same gateway infrastructure as the planner.
- Use `gpt-5.4` high as the first default to match current product defaults.
- Add benchmark rows comparing `gpt-5.4 high`, `gpt-5.4 medium`, and `gpt-5.3-codex-spark low` before changing the default.

Why not reuse the grouping prompt:

- Grouping output optimizes browser mutations.
- Time recap output optimizes user understanding and evidence.
- Mixing them would make the prompt harder to validate and the UI harder to reason about.

Large local cache handling:

- Send a compact row per relevant page.
- Include page summaries only when available.
- For more than 300 rows, rank locally first by recency, active count, open status, and sampled summary availability.
- Keep excluded rows counted in coverage so the user can understand limits if they open details.

## Implementation Phases

### Phase 0: Product Truth Cleanup

Goal: avoid shipping a claim before the feature exists.

Tasks:

- Either implement this feature before the next release or remove/downgrade time recap claims from `README.md`.
- Add this plan to `docs/README.md`.

Acceptance:

- Public README does not imply a finished feature unless UI and tests exist.

### Phase 1: Data Aggregator

Goal: convert current cache and lifecycle data into a clean recap input.

Tasks:

- Add `buildTimeRecapInput(chromeApi, settings, range)` in a new core module or near `page-activity-cache.js`.
- Combine:
  - activity cache entries;
  - lifecycle sessions;
  - current open tabs and groups;
  - page summary cache entries.
- Add local ranking:
  - currently open tabs first;
  - recently active pages;
  - pages with summaries;
  - old but still open pages;
  - repeated visits.
- Keep sanitized URLs only by default.
- Exclude incognito unless the user explicitly enables it.

Tests:

- Unit test range filtering.
- Unit test lifecycle merge.
- Unit test URL query/hash stripping.
- Unit test no mutation.
- Unit test TTL and max-entry behavior.

### Phase 2: Recap Planner

Goal: generate structured recap JSON from local input.

Tasks:

- Add a gateway recap planner function, separate from grouping planner.
- Add JSON repair for code-fenced model responses.
- Add schema validation and local fallback.
- Add localized prompt instructions.
- Add strict privacy instruction: do not reveal internal field names in user-facing evidence.

Fallback:

- If AI fails, show local recap:
  - top hosts;
  - top terms;
  - recent pages;
  - stale open tabs.
- Make the fallback look intentional, not like a crash state.

Tests:

- Valid AI response.
- Markdown fenced JSON response.
- Invalid JSON fallback.
- Wrong tab IDs dropped.
- Language follows UI setting.

### Phase 3: Side Panel UI

Goal: make recap feel like a first-class product feature.

Tasks:

- Add a top-level mode switch:
  - `整理`
  - `回顾`
- Add time-range selector.
- Add CTA: `生成回顾`.
- Render theme cards, timeline cards, follow-up hints, and review candidates.
- Add collapsed evidence details.
- Add locate-tab action for representative tabs.
- Reuse cleanup close-selected behavior only inside review candidates, with explicit confirmation if many tabs are selected.

Design requirements:

- No debug chips.
- No raw AI-ish tags.
- Strong visual hierarchy: title, summary, evidence.
- Keep side panel height stable and middle content scrollable.
- Support Chinese and English.

Tests:

- Playwright render for empty state.
- Playwright render for successful recap.
- Playwright render for AI failure fallback.
- Playwright language switch.
- Playwright close-selected flow from recap review candidates.

### Phase 4: Integration With Organize/Cleanup

Goal: connect recap to existing product actions without blurring responsibilities.

Tasks:

- From a recap theme, allow "organize these tabs" by launching a scoped grouping job for those tab IDs.
- From review candidates, allow selected manual close.
- After closing candidates, refresh recap locally without another AI request.
- Do not automatically mutate groups from the recap screen.

Acceptance:

- Recap can help the user decide, but it does not silently organize or close anything.

### Phase 5: Privacy and Settings

Goal: make data use understandable without sounding like a dev note.

Tasks:

- Add a small explanation near the recap CTA:
  - `回顾会使用本机保存的标签页活动、标题、网址和可用页面摘要。生成时会把精简后的线索发送给 AI。`
- Add details:
  - what is stored locally;
  - what may be sent to AI;
  - what is never read;
  - how to clear local memory.
- Add a clear local memory control before release if we keep long-term recap records.

Acceptance:

- User can understand what happens before clicking.
- Turning off continuous summaries stops future content capture.
- Recap still works in metadata-only mode, with lower confidence.

### Phase 6: Benchmarks and Evidence

Goal: leave an auditable before/after trail.

Create benchmark records under `docs/benchmarks/` for:

- Metadata-only recap on 30, 120, 300 synthetic tabs.
- Recap with page summaries.
- Mixed old/new tab sessions.
- Forum-like pages where title alone is weak.
- English UI and Chinese UI.

Metrics:

- elapsed time;
- request count;
- input/output tokens;
- number of themes;
- percentage of pages represented in at least one theme;
- invalid tab ID rate;
- human review score for usefulness;
- whether cleanup candidates overlap with old/low-activity tabs.

Acceptance:

- Every model or prompt decision has before/after evidence.
- If a smaller model is selected, quality and latency tradeoff are documented.

## Release Gate

Before release:

- `npm run release:check` passes.
- Stress test includes recap data but does not mutate tabs.
- Real Chrome side panel test covers:
  - metadata-only recap;
  - recap with continuous summaries enabled;
  - denied page permission;
  - sleeping tabs;
  - language switch;
  - gateway failure fallback.
- README describes only shipped behavior.
- Docs index links this plan or the final feature doc.

## Open Decisions

- Should recap history be stored, or should each recap be disposable?
- Should the entry be called `近期回顾`, `工作回顾`, or `浏览回顾`?
- Should default range be 7 days or "since last organize"?
- Should the recap planner use the primary model by default, or benchmark a cheaper recap-only route first?
- Should the store build include long-term page summaries, or keep content recap as a developer/private build capability?

## Recommended First Slice

Build the smallest honest version:

1. Add `buildTimeRecapInput()` and tests.
2. Add `activity:generateTimeRecap` with local fallback.
3. Add side panel `回顾` entry with 7-day range only.
4. Render AI recap cards and evidence details.
5. Run real Chrome test with current open tabs.
6. Update README only after the UI works.

This first slice is enough to validate whether the feature feels useful before expanding custom ranges and recap history.
