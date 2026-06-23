import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTabs, applyLastPlan, undoLastApply } from "../src/core/controller.js";
import {
  DEFAULT_SETTINGS,
  EXISTING_GROUP_MODES,
  ORGANIZE_MODES,
  PLANNER_PROVIDERS,
  PAGE_CONTEXT_MODES,
  PAGE_SAMPLING_CONSENT_MODES,
  TARGET_WINDOW_MODES
} from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("analyze/apply/undo groups only the current window by default", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "OpenAI API docs", url: "https://platform.openai.com/docs" },
          { id: 12, title: "Pinned mail", url: "https://mail.example.com", pinned: true }
        ]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "GitLab issue", url: "https://gitlab.com/acme/repo/-/issues/1" }]
      }
    ]
  });

  const job = await analyzeTabs(chrome, DEFAULT_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.excludedTabsCount, 1);
  assert.deepEqual(
    job.inventory.plannerTabs.map((tab) => tab.tabId).sort(),
    [10, 11]
  );

  const result = await applyLastPlan(chrome);
  assert.equal(result.groupedTabsCount, 2);
  assert.notEqual((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(20)).groupId, -1);

  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 3);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(11)).groupId, -1);
});

test("consolidate_one_window moves all eligible normal-window tabs into one target", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "GitHub issue", url: "https://github.com/acme/repo/issues/1", active: true }]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "OpenAI model docs", url: "https://platform.openai.com/docs/models" }]
      }
    ]
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.NEW_WINDOW,
    existingGroupMode: EXISTING_GROUP_MODES.DISSOLVE
  };

  const job = await analyzeTabs(chrome, settings, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.requiresConfirmation, true);

  const result = await applyLastPlan(chrome);
  assert.equal(result.movedTabsCount, 2);
  assert.equal(result.createdWindowIds.length, 1);
  const targetWindow = await chrome.windows.get(result.targetWindowId, { populate: true });
  assert.deepEqual(
    targetWindow.tabs.map((tab) => tab.id).sort(),
    [10, 20]
  );

  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 2);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  assert.equal(windows.reduce((sum, window) => sum + window.tabs.length, 0), 2);
});

test("non-fake planners retry once with validation feedback", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "DeepSeek JSON docs", url: "https://api-docs.deepseek.com/guides/json_mode", active: true }]
      }
    ]
  });
  const validPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [{ tabId: 10, windowId: 1 }],
    excludedTabs: [],
    groups: [
      {
        groupKey: "api-docs",
        title: "API Docs",
        color: "blue",
        confidence: 0.9,
        tabRefs: [{ tabId: 10, windowId: 1 }],
        reason: "DeepSeek API documentation."
      }
    ],
    reviewTabs: []
  };
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    if (calls === 2) {
      assert.match(body.messages[0].content, /Previous planner output failed local validation/);
    }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify(calls === 1 ? { ...validPlan, groups: [], reviewTabs: [] } : validPlan)
              }
            }
          ]
        };
      }
    };
  };

  try {
    const job = await analyzeTabs(
      chrome,
      { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.DEEPSEEK, deepseekApiKey: "test-key" },
      { windowId: 1 }
    );
    assert.equal(calls, 2);
    assert.equal(job.validation.ok, true);
    assert.equal(job.plan.groups.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("active tab page samples are attached to analysis preview", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Ambiguous", url: "https://example.com/page", active: true }]
      }
    ]
  });

  const job = await analyzeTabs(
    chrome,
    {
      ...DEFAULT_SETTINGS,
      pageContextMode: PAGE_CONTEXT_MODES.ACTIVE_TAB_ONLY,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    { windowId: 1 }
  );

  assert.equal(job.inventory.pageSamples.length, 1);
  assert.equal(job.inventory.pageSamples[0].status, "ok");
  assert.equal(job.preview.pageSampling.ok, 1);
  assert.equal(job.preview.pageSampling.requested, 1);
});
