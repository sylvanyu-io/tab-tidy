import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTabs,
  applyLastPlan,
  cancelActiveJob,
  getActiveJob,
  getLastJob,
  startAnalyzeTabs,
  undoLastApply
} from "../src/core/controller.js";
import { undoFromRollback } from "../src/core/chrome-executor.js";
import {
  DEFAULT_SETTINGS,
  EXISTING_GROUP_MODES,
  ORGANIZE_MODES,
  PLANNER_PROVIDERS,
  PAGE_CONTEXT_MODES,
  PAGE_SAMPLING_CONSENT_MODES,
  TARGET_WINDOW_MODES,
  UNDO_TARGET_WINDOW_MODES
} from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

const FAKE_PLANNER_SETTINGS = Object.freeze({
  ...DEFAULT_SETTINGS,
  plannerProvider: PLANNER_PROVIDERS.FAKE
});

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

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.excludedTabsCount, 1);
  assert.deepEqual(
    job.inventory.plannerTabs.map((tab) => tab.tabId).sort(),
    [10, 11]
  );

  const result = await applyLastPlan(chrome);
  assert.equal(result.groupedTabsCount, 2);
  const groupedTab = await chrome.tabs.get(10);
  assert.notEqual(groupedTab.groupId, -1);
  assert.equal((await chrome.tabGroups.query({ windowId: 1 })).find((group) => group.id === groupedTab.groupId)?.collapsed, true);
  assert.equal((await chrome.tabs.get(20)).groupId, -1);

  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 3);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(11)).groupId, -1);
});

test("collapse toggle can leave newly created groups expanded", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, { ...FAKE_PLANNER_SETTINGS, collapseGroupsAfterApply: false }, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  await applyLastPlan(chrome);
  const groupedTab = await chrome.tabs.get(10);
  assert.notEqual(groupedTab.groupId, -1);
  assert.equal((await chrome.tabGroups.query({ windowId: 1 })).find((group) => group.id === groupedTab.groupId)?.collapsed, false);
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
    plannerProvider: PLANNER_PROVIDERS.FAKE,
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

test("consolidate_one_window can use the invocation window as target", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "GitHub issue", url: "https://github.com/acme/repo/issues/1", active: true }]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "Chrome extension docs", url: "https://developer.chrome.com/docs/extensions" }]
      }
    ]
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.FAKE,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.CURRENT_WINDOW,
    existingGroupMode: EXISTING_GROUP_MODES.DISSOLVE
  };

  const job = await analyzeTabs(chrome, settings, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.plan.targetWindow.windowId, 1);

  const result = await applyLastPlan(chrome);
  assert.equal(result.targetWindowId, 1);
  assert.deepEqual(result.createdWindowIds, []);
  const targetWindow = await chrome.windows.get(1, { populate: true });
  assert.deepEqual(
    targetWindow.tabs.map((tab) => tab.id).sort(),
    [10, 20]
  );
});

test("consolidate_one_window with no eligible tabs is a no-op", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Pinned mail", url: "https://mail.example.com", active: true, pinned: true }]
      },
      {
        id: 2,
        tabs: [{ id: 20, title: "Pinned docs", url: "https://docs.example.com", pinned: true }]
      }
    ]
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.FAKE,
    organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    targetWindowMode: TARGET_WINDOW_MODES.NEW_WINDOW
  };

  const job = await analyzeTabs(chrome, settings, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.excludedTabsCount, 2);

  const result = await applyLastPlan(chrome);
  assert.equal(result.movedTabsCount, 0);
  assert.equal(result.createdWindowIds.length, 0);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  assert.equal(windows.length, 2);
});

test("apply failure keeps a rollback snapshot so undo can restore", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "GitHub pull request", url: "https://github.com/acme/repo/pull/1", active: true },
          { id: 11, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const originalUpdate = chrome.tabGroups.update;
  chrome.tabGroups.update = async (...args) => {
    await originalUpdate(...args);
    throw new Error("simulated group update failure");
  };

  await assert.rejects(() => applyLastPlan(chrome), /simulated group update failure/);
  assert.notEqual((await chrome.tabs.get(10)).groupId, -1);

  chrome.tabGroups.update = originalUpdate;
  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 2);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(11)).groupId, -1);
});

test("undo can close an empty target window created by the operation", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true }]
      },
      {
        id: 2,
        tabs: []
      }
    ]
  });

  const rollback = {
    operationId: "op_test",
    undoTargetWindowMode: UNDO_TARGET_WINDOW_MODES.CLOSE_EMPTY_CREATED,
    sourceWindows: [
      {
        windowId: 1,
        type: "normal",
        state: "normal",
        activeTabId: 10,
        tabOrder: [10]
      }
    ],
    sourceGroups: [],
    tabs: [{ tabId: 10, windowId: 1, index: 0, pinned: false, active: true, highlighted: false, groupId: -1 }],
    createdWindowIds: [2],
    createdGroupIds: [],
    operationJournal: []
  };

  const result = await undoFromRollback(chrome, rollback);
  assert.deepEqual(result.closedCreatedWindowIds, [2]);
  await assert.rejects(() => chrome.windows.get(2), /No window with id 2/);
});

test("apply fails instead of silently grouping a partial tab set", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true },
          { id: 11, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const originalGet = chrome.tabs.get;
  chrome.tabs.get = async (tabId) => {
    if (tabId === 11) throw new Error("tab disappeared during apply");
    return originalGet(tabId);
  };

  await assert.rejects(() => applyLastPlan(chrome), /tab\(s\) disappeared: 11/);

  chrome.tabs.get = originalGet;
  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 2);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(11)).groupId, -1);
});

test("non-fake planners retry once with validation feedback", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Gateway JSON docs", url: "https://example.com/gateway-json", active: true }]
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
        reason: "Gateway API documentation."
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
      { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "test-key" },
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
      plannerProvider: PLANNER_PROVIDERS.FAKE,
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

test("active analysis exposes progress and can be canceled", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Gateway planner docs", url: "https://example.com/docs", active: true }]
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  let sawAbortSignal = false;
  globalThis.fetch = async (_url, options) => {
    sawAbortSignal = Boolean(options.signal);
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fetch aborted")));
    });
  };

  try {
    const pending = analyzeTabs(
      chrome,
      { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
      { windowId: 1 }
    );

    await waitForActiveJob(chrome, (job) => job?.phase === "planning" && job.progress >= 40);
    const activeJob = await getActiveJob(chrome);
    assert.equal(activeJob.status, "running");
    assert.equal(sawAbortSignal, true);

    const cancelResult = await cancelActiveJob(chrome);
    assert.equal(cancelResult.canceled, true);
    await assert.rejects(pending, /已取消整理/);

    const canceledJob = await getActiveJob(chrome);
    assert.equal(canceledJob.status, "canceled");
    assert.equal(canceledJob.message, "已取消整理。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("startAnalyzeTabs returns immediately while the background job writes final preview", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups", active: true }]
      }
    ]
  });

  const started = await startAnalyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.match(started.operationId, /^job_/);

  const completeJob = await waitForActiveJob(chrome, (job) => job?.operationId === started.operationId && job.status === "complete");
  assert.equal(completeJob.progress, 100);

  const lastJob = await getLastJob(chrome);
  assert.equal(lastJob.operationId, started.operationId);
  assert.equal(lastJob.validation.ok, true);
  assert.equal(lastJob.preview.groups.length > 0, true);
});

async function waitForActiveJob(chrome, predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const job = await getActiveJob(chrome);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for active analysis job.");
}
