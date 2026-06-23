import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTabs, applyLastPlan, undoLastApply } from "../src/core/controller.js";
import {
  DEFAULT_SETTINGS,
  EXISTING_GROUP_MODES,
  ORGANIZE_MODES,
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
