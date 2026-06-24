import assert from "node:assert/strict";
import test from "node:test";
import { createFakePlan } from "../src/core/fake-planner.js";
import { DEFAULT_SETTINGS, LANGUAGE_MODES } from "../src/shared/settings.js";

test("fake planner sends unknown tabs to review instead of a generic catch-all group", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [
      { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Obscure page A", hostname: "rare-a.example" },
      { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Obscure page B", hostname: "rare-b.example" }
    ],
    excludedTabs: []
  };

  const plan = createFakePlan(inventory, DEFAULT_SETTINGS);

  assert.equal(plan.groups.length, 0);
  assert.deepEqual(
    plan.reviewTabs.map((tab) => tab.tabId),
    [10, 11]
  );
});

test("fake planner splits large matched groups by original tab order", () => {
  const plannerTabs = Array.from({ length: 45 }, (_, index) => ({
    tabId: index + 10,
    windowId: 1,
    index,
    sequenceIndex: index,
    title: `Chrome API docs ${index}`,
    hostname: "developer.chrome.com"
  }));
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs,
    excludedTabs: []
  };

  const plan = createFakePlan(inventory, { ...DEFAULT_SETTINGS, maxTabsPerGroup: 20 });

  assert.equal(plan.groups.length, 3);
  assert.deepEqual(
    plan.groups.map((group) => group.tabRefs.length),
    [20, 20, 5]
  );
  assert.deepEqual(
    plan.groups[1].tabRefs.map((ref) => ref.tabId),
    Array.from({ length: 20 }, (_, index) => index + 30)
  );
});

test("fake planner localizes fallback group titles and reasons", () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    plannerTabs: [{ tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Chrome API docs", hostname: "developer.chrome.com" }],
    excludedTabs: []
  };

  const zhPlan = createFakePlan(inventory, { ...DEFAULT_SETTINGS, languageMode: LANGUAGE_MODES.ZH_CN });
  const enPlan = createFakePlan(inventory, { ...DEFAULT_SETTINGS, languageMode: LANGUAGE_MODES.EN_US });

  assert.equal(zhPlan.groups[0].title, "技术文档");
  assert.equal(enPlan.groups[0].title, "Technical Docs");
  assert.match(zhPlan.groups[0].reason, /匹配到/);
  assert.match(enPlan.groups[0].reason, /Matched semantic signals/);
});
