import assert from "node:assert/strict";
import test from "node:test";
import { createFakePlan } from "../src/core/fake-planner.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";

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
