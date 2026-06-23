import assert from "node:assert/strict";
import test from "node:test";
import { validatePlan } from "../src/core/plan-validator.js";
import { DEFAULT_SETTINGS, EXISTING_GROUP_MODES } from "../src/shared/settings.js";

test("current-window mode rejects tabs from another window", () => {
  const inventory = {
    scope: { currentWindowId: 1 },
    plannerTabs: [{ tabId: 10, windowId: 1, pinned: false, incognito: false }],
    lockedGroups: [],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    groups: [{ groupKey: "x", title: "X", color: "blue", confidence: 0.8, tabRefs: [{ tabId: 10, windowId: 2 }] }],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, DEFAULT_SETTINGS);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /outside the current window|window mismatch/);
});

test("preserve existing groups rejects reassignment of locked tabs", () => {
  const settings = { ...DEFAULT_SETTINGS, existingGroupMode: EXISTING_GROUP_MODES.PRESERVE };
  const inventory = {
    scope: { currentWindowId: 1 },
    plannerTabs: [],
    lockedGroups: [{ groupId: 88, windowId: 1, tabIds: [10] }],
    excludedTabs: []
  };
  const plan = {
    schemaVersion: 1,
    mode: "current_window",
    groups: [{ groupKey: "x", title: "X", color: "blue", confidence: 0.8, tabRefs: [{ tabId: 10, windowId: 1 }] }],
    reviewTabs: [],
    excludedTabs: []
  };

  const result = validatePlan(plan, inventory, settings);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /locked existing group|Preserved existing group/);
});
