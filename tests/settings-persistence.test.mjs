import assert from "node:assert/strict";
import test from "node:test";
import { getSettings, saveSettings } from "../src/core/controller.js";
import { DEFAULT_SETTINGS, PAGE_SAMPLING_CONSENT_MODES } from "../src/shared/settings.js";
import { normalizeSettings } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("session-only page sampling consent is not persisted", async () => {
  const chrome = createFakeChrome();

  const returned = await saveSettings(chrome, {
    ...DEFAULT_SETTINGS,
    pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
  });
  assert.equal(returned.pageSamplingConsentMode, PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION);

  const loaded = await getSettings(chrome);
  assert.equal(loaded.pageSamplingConsentMode, PAGE_SAMPLING_CONSENT_MODES.NOT_ACKNOWLEDGED);
});

test("invalid selected target window ids normalize to null", () => {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, selectedTargetWindowId: "not-a-window" });
  assert.equal(settings.selectedTargetWindowId, null);
});
