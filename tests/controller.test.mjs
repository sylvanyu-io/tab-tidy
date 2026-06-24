import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTabs,
  applyLastPlan,
  cancelActiveJob,
  clearAnalysisState,
  generateProgressCopy,
  getActiveJob,
  getLastJob,
  startAnalyzeTabs,
  undoLastApply
} from "../src/core/controller.js";
import { applyValidatedPlan, undoFromRollback } from "../src/core/chrome-executor.js";
import { rememberPageSummary } from "../src/core/page-summary-cache.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import {
  DEFAULT_SETTINGS,
  EXISTING_GROUP_MODES,
  LANGUAGE_MODES,
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
  assert.equal(job.preview.totalTabsCount, 3);
  assert.equal(job.preview.eligibleTabsCount, 2);
  assert.equal(job.preview.windowCount, 1);
  assert.equal(job.preview.groupedTabsCount + job.preview.reviewTabsCount, 2);
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

test("current-window analysis ignores invalid invocation window ids", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true }]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 0 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.inventory.scope.currentWindowId, 1);
  assert.equal(job.inventory.plannerTabs[0].tabId, 10);
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

test("apply rebases small tab changes since preview", async () => {
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

  const window = chrome.__state.windows.get(1);
  window.tabs = [
    { ...window.tabs[0], index: 0 },
    {
      ...window.tabs[1],
      id: 12,
      index: 1,
      title: "Untitled workspace",
      url: "https://example.com/workspace",
      groupId: -1
    }
  ];

  const confirmation = await applyLastPlan(chrome);
  assert.equal(confirmation.requiresChangedTabsConfirmation, true);
  assert.equal(confirmation.rebasedPlan.changedTabsCount, 2);
  assert.deepEqual(confirmation.rebasedPlan.removedTabIds, [11]);
  assert.deepEqual(confirmation.rebasedPlan.skippedNewTabIds, [12]);
  assert.equal((await chrome.tabs.get(10)).groupId, -1);
  assert.equal((await chrome.tabs.get(12)).groupId, -1);

  const result = await applyLastPlan(chrome, { confirmChangedTabs: true });
  assert.equal(result.rebasedPlan.changedTabsCount, 2);
  assert.deepEqual(result.rebasedPlan.removedTabIds, [11]);
  assert.deepEqual(result.rebasedPlan.addedReviewTabIds, [12]);
  assert.notEqual((await chrome.tabs.get(10)).groupId, -1);
  assert.notEqual((await chrome.tabs.get(12)).groupId, -1);
});

test("apply asks to regenerate when too many tabs changed since preview", async () => {
  const originalTabs = Array.from({ length: 8 }, (_, index) => ({
    id: 100 + index,
    title: `Chrome API docs ${index}`,
    url: `https://developer.chrome.com/docs/${index}`,
    active: index === 0
  }));
  const chrome = createFakeChrome({
    windows: [{ id: 1, focused: true, tabs: originalTabs }]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const window = chrome.__state.windows.get(1);
  window.tabs = Array.from({ length: 8 }, (_, index) => ({
    ...window.tabs[0],
    id: 200 + index,
    index,
    title: `New workspace ${index}`,
    url: `https://example.com/new-${index}`,
    active: index === 0,
    groupId: -1
  }));

  await assert.rejects(() => applyLastPlan(chrome), /标签页变化较多，请重新生成方案。变化标签页 16 个。/);
});

test("review group title follows the selected result language when applying", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Obscure page A", url: "https://rare-a.example", active: true },
          { id: 11, title: "Obscure page B", url: "https://rare-b.example" }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, { ...FAKE_PLANNER_SETTINGS, languageMode: LANGUAGE_MODES.EN_US }, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  assert.equal(job.preview.reviewGroupTitle, "Needs Review");

  await applyLastPlan(chrome);
  const groups = await chrome.tabGroups.query({ windowId: 1 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "Needs Review");
});

test("applying a plan keeps review-like groups after topic groups", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Obscure page", url: "https://rare.example", active: true },
          { id: 11, title: "Current project issue", url: "https://github.com/acme/repo/issues/1" }
        ]
      }
    ]
  });
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    tabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    plannerTabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: ORGANIZE_MODES.CURRENT_WINDOW,
    targetWindow: { kind: "current_window", windowId: 1, title: "当前窗口" },
    groups: [
      { groupKey: "needs-review", title: "待确认", color: "grey", confidence: 0.9, tabRefs: [{ tabId: 10, windowId: 1 }] },
      { groupKey: "work", title: "当前项目", color: "blue", confidence: 0.9, tabRefs: [{ tabId: 11, windowId: 1 }] }
    ],
    reviewTabs: [],
    excludedTabs: []
  };

  await applyValidatedPlan(chrome, plan, inventory, DEFAULT_SETTINGS);
  const groups = await chrome.tabGroups.query({ windowId: 1 });
  const tabs = await chrome.tabs.query({ windowId: 1 });

  assert.deepEqual(
    groups.map((group) => group.title),
    ["当前项目", "待确认"]
  );
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [11, 10]
  );
});

test("applying reviewTabs moves the runtime review group after topic groups", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Obscure page", url: "https://rare.example", active: true },
          { id: 11, title: "Current project issue", url: "https://github.com/acme/repo/issues/1" }
        ]
      }
    ]
  });
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    tabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    plannerTabs: [
      { tabId: 10, windowId: 1, sequenceIndex: 0, pinned: false, incognito: false },
      { tabId: 11, windowId: 1, sequenceIndex: 1, pinned: false, incognito: false }
    ],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: ORGANIZE_MODES.CURRENT_WINDOW,
    targetWindow: { kind: "current_window", windowId: 1, title: "当前窗口" },
    groups: [{ groupKey: "work", title: "当前项目", color: "blue", confidence: 0.9, tabRefs: [{ tabId: 11, windowId: 1 }] }],
    reviewTabs: [{ tabId: 10, windowId: 1, reason: "主题不明确" }],
    excludedTabs: []
  };

  await applyValidatedPlan(chrome, plan, inventory, DEFAULT_SETTINGS);
  const groups = await chrome.tabGroups.query({ windowId: 1 });
  const tabs = await chrome.tabs.query({ windowId: 1 });

  assert.deepEqual(
    groups.map((group) => group.title),
    ["当前项目", "待分类"]
  );
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [11, 10]
  );
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

test("new-window apply failure after seed move can still undo", async () => {
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
    existingGroupMode: EXISTING_GROUP_MODES.DISSOLVE,
    undoTargetWindowMode: UNDO_TARGET_WINDOW_MODES.CLOSE_EMPTY_CREATED
  };

  const job = await analyzeTabs(chrome, settings, { windowId: 1 });
  assert.equal(job.validation.ok, true);

  const originalMove = chrome.tabs.move;
  chrome.tabs.move = async (tabIds, moveProperties) => {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    if (ids.includes(20)) {
      throw new Error("simulated move failure");
    }
    return originalMove(tabIds, moveProperties);
  };

  await assert.rejects(() => applyLastPlan(chrome), /simulated move failure/);

  chrome.tabs.move = originalMove;
  const undo = await undoLastApply(chrome);
  assert.equal(undo.restoredTabs, 2);
  const restoredTab10 = await chrome.tabs.get(10);
  const restoredTab20 = await chrome.tabs.get(20);
  assert.notEqual(restoredTab10.windowId, restoredTab20.windowId);
  assert.equal(restoredTab20.windowId, 2);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  assert.equal(windows.length, 2);
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

test("undo restores highlighted tab state", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "Chrome tabs API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: true, highlighted: true },
          { id: 11, title: "Chrome tabGroups API docs", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups", highlighted: true }
        ]
      }
    ]
  });

  const job = await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal(job.validation.ok, true);
  await applyLastPlan(chrome);
  await chrome.tabs.update(11, { highlighted: false });

  await undoLastApply(chrome);
  assert.equal((await chrome.tabs.get(10)).highlighted, true);
  assert.equal((await chrome.tabs.get(11)).highlighted, true);
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

test("page sampling timeouts fall back without blocking analysis", async () => {
  const chrome = createFakeChrome({
    grantedOrigins: ["https://a.example/*", "https://b.example/*", "https://c.example/*"],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "A", url: "https://a.example/page", active: true },
          { id: 11, title: "B", url: "https://b.example/page" },
          { id: 12, title: "C", url: "https://c.example/page" }
        ]
      }
    ]
  });

  chrome.scripting.executeScript = async ({ target }) => {
    if (target.tabId === 11) return new Promise(() => {});
    return [{ result: { title: `Sample ${target.tabId}`, headings: [], visibleText: "Readable text" } }];
  };
  globalThis.__semanticTabAgentPageSampleTimeoutMs = 10;

  try {
    const job = await analyzeTabs(
      chrome,
      {
        ...FAKE_PLANNER_SETTINGS,
        pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
        pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
      },
      { windowId: 1 }
    );

    assert.equal(job.inventory.pageSamples.length, 3);
    assert.deepEqual(
      job.inventory.pageSamples.map((sample) => sample.tabId),
      [10, 11, 12]
    );
    assert.equal(job.inventory.pageSamples.find((sample) => sample.tabId === 11).status, "blocked");
    assert.match(job.inventory.pageSamples.find((sample) => sample.tabId === 11).reason, /Timed out/);
    assert.equal(job.preview.pageSampling.ok, 2);
    assert.equal(job.preview.pageSampling.blocked, 1);
  } finally {
    delete globalThis.__semanticTabAgentPageSampleTimeoutMs;
  }
});

test("discarded tabs skip page sampling without waking the page", async () => {
  const chrome = createFakeChrome({
    grantedOrigins: ["https://a.example/*", "https://b.example/*", "https://c.example/*"],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, title: "A", url: "https://a.example/page", active: true },
          { id: 11, title: "B", url: "https://b.example/page", discarded: true },
          { id: 12, title: "C", url: "https://c.example/page", discarded: true }
        ]
      }
    ]
  });

  const sampledTabIds = [];
  chrome.scripting.executeScript = async ({ target }) => {
    sampledTabIds.push(target.tabId);
    return [{ result: { title: `Sample ${target.tabId}`, headings: [], visibleText: "Readable text" } }];
  };

  const job = await analyzeTabs(
    chrome,
    {
      ...FAKE_PLANNER_SETTINGS,
      pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    { windowId: 1 }
  );

  assert.deepEqual(sampledTabIds, [10]);
  assert.deepEqual(
    job.inventory.pageSamples.map((sample) => sample.status),
    ["ok", "discarded", "discarded"]
  );
  assert.equal(job.preview.pageSampling.requested, 3);
  assert.equal(job.preview.pageSampling.ok, 1);
  assert.equal(job.preview.pageSampling.blocked, 2);
});

test("continuous summary cache can enrich analysis without live page sampling", async () => {
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Cached", url: "https://example.com/project", active: true }]
      }
    ]
  });
  chrome.scripting.executeScript = async () => {
    throw new Error("Live page sampling should not run.");
  };
  await rememberPageSummary(
    chrome,
    { id: 10, title: "Cached", url: "https://example.com/project" },
    {
      status: "ok",
      sample: {
        title: "Cached page",
        metaDescription: "Cached metadata",
        language: "en",
        headings: ["Cached heading"],
        visibleText: "Cached visible text"
      }
    }
  );

  const job = await analyzeTabs(
    chrome,
    {
      ...FAKE_PLANNER_SETTINGS,
      continuousPageSummaries: true,
      pageContextMode: PAGE_CONTEXT_MODES.OFF,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_PERSISTENTLY
    },
    { windowId: 1 }
  );

  assert.equal(job.inventory.pageSamples.length, 1);
  assert.equal(job.inventory.pageSamples[0].reason, "Cached page summary.");
  assert.equal(job.preview.pageSampling.ok, 1);
});

test("canceling during page sampling marks the job canceled immediately", async () => {
  const chrome = createFakeChrome({
    grantedOrigins: ["https://example.com/*"],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Ambiguous", url: "https://example.com/page", active: true }]
      }
    ]
  });

  chrome.scripting.executeScript = async () => new Promise(() => {});
  globalThis.__semanticTabAgentPageSampleTimeoutMs = 30_000;

  try {
    const pending = analyzeTabs(
      chrome,
      {
        ...FAKE_PLANNER_SETTINGS,
        pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
        pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
      },
      { windowId: 1 }
    );

    await waitForActiveJob(chrome, (job) => job?.phase === "sampling");
    const cancelResult = await cancelActiveJob(chrome);
    assert.equal(cancelResult.canceled, true);
    assert.equal(cancelResult.job.status, "canceled");
    assert.equal(cancelResult.job.message, "已取消整理。");
    await assert.rejects(pending, /已取消整理/);
    assert.equal((await getActiveJob(chrome)).status, "canceled");
  } finally {
    delete globalThis.__semanticTabAgentPageSampleTimeoutMs;
  }
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

test("gateway analyses create and reuse an anonymous install id", async () => {
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
  const originalFetch = globalThis.fetch;
  const requestHeaders = [];
  globalThis.fetch = async (_url, options) => {
    requestHeaders.push(options.headers);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  mode: "current_window",
                  scope: { kind: "current_window", windowIds: [1] },
                  targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
                  eligibleTabs: [
                    { tabId: 10, windowId: 1 },
                    { tabId: 11, windowId: 1 }
                  ],
                  excludedTabs: [],
                  groups: [
                    {
                      groupKey: "chrome-docs",
                      title: "Chrome Docs",
                      color: "blue",
                      confidence: 0.9,
                      tabRefs: [
                        { tabId: 10, windowId: 1 },
                        { tabId: 11, windowId: 1 }
                      ],
                      reason: "Chrome extension documentation."
                    }
                  ],
                  reviewTabs: []
                })
              }
            }
          ]
        };
      }
    };
  };

  try {
    const settings = { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY };
    await analyzeTabs(chrome, settings, { windowId: 1 });
    const firstInstallId = chrome.__state.storage[STORAGE_KEYS.installId];
    await analyzeTabs(chrome, settings, { windowId: 1 });

    assert.match(firstInstallId, /^install_/);
    assert.equal(chrome.__state.storage[STORAGE_KEYS.installId], firstInstallId);
    assert.equal(requestHeaders.length, 2);
    assert.equal(requestHeaders[0].authorization, undefined);
    assert.equal(requestHeaders[0]["x-tab-tidy-install-id"], firstInstallId);
    assert.equal(requestHeaders[1]["x-tab-tidy-install-id"], firstInstallId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("progress copy generation uses spark without tab metadata", async () => {
  const chrome = createFakeChrome();
  const originalFetch = globalThis.fetch;
  const messages = Array.from({ length: 12 }, (_, index) => `整理线索${index}`);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-5.3-codex-spark");
    assert.equal(body.max_tokens, 1200);
    assert.match(body.messages[0].content, /Return strict JSON only/);
    assert.doesNotMatch(options.body, /Chrome tabs API docs|https?:\/\//);
    assert.equal(options.headers["x-tab-tidy-install-id"].startsWith("install_"), true);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ messages }) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await generateProgressCopy(chrome, {
      phase: "planning",
      tabCount: 252,
      windowCount: 4,
      languageMode: "zh-CN"
    });
    assert.equal(result.model, "gpt-5.3-codex-spark");
    assert.deepEqual(result.messages, messages);
    assert.equal(calls[0].url, "https://cliproxy.sylvanyu.io/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("canceling during preview cannot be overwritten by completion", async () => {
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

  const originalSet = chrome.storage.local.set;
  let issuedCancel = false;
  chrome.storage.local.set = async (items) => {
    await originalSet(items);
    const activeJob = items[STORAGE_KEYS.activeJob];
    if (activeJob?.phase === "preview" && !issuedCancel) {
      issuedCancel = true;
      await cancelActiveJob(chrome);
    }
  };

  await startAnalyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  const finalJob = await waitForActiveJob(chrome, (job) => job?.status === "canceled" || job?.status === "complete");

  assert.equal(issuedCancel, true);
  assert.equal(finalJob.status, "canceled");
  assert.equal(finalJob.message, "已取消整理。");
  assert.equal(await getLastJob(chrome), null);
});

test("clearAnalysisState removes terminal previews but preserves running jobs", async () => {
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

  await analyzeTabs(chrome, FAKE_PLANNER_SETTINGS, { windowId: 1 });
  assert.equal((await getActiveJob(chrome))?.status, "complete");
  assert.notEqual(await getLastJob(chrome), null);

  assert.deepEqual(await clearAnalysisState(chrome), { cleared: true });
  assert.equal(await getActiveJob(chrome), null);
  assert.equal(await getLastJob(chrome), null);

  chrome.__state.storage[STORAGE_KEYS.activeJob] = {
    operationId: "running-test",
    status: "running",
    phase: "planning",
    progress: 40,
    message: "正在整理"
  };
  await assert.rejects(() => clearAnalysisState(chrome), /正在整理中/);
  assert.equal(chrome.__state.storage[STORAGE_KEYS.activeJob].status, "running");
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
