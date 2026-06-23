import assert from "node:assert/strict";
import test from "node:test";
import { getSettings, saveSettings } from "../src/core/controller.js";
import { DEFAULT_SETTINGS, PAGE_SAMPLING_CONSENT_MODES, THINKING_INTENSITIES, UNDO_TARGET_WINDOW_MODES } from "../src/shared/settings.js";
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

test("invalid undo target window mode falls back to conservative default", () => {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, undoTargetWindowMode: "close_anything" });
  assert.equal(settings.undoTargetWindowMode, UNDO_TARGET_WINDOW_MODES.LEAVE_EMPTY);
});

test("AI gateway settings normalize safely", () => {
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayBaseUrl: "http://127.0.0.1:8317/v1/" }).gatewayBaseUrl,
    "http://127.0.0.1:8317/v1"
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayBaseUrl: "javascript:alert(1)" }).gatewayBaseUrl,
    DEFAULT_SETTINGS.gatewayBaseUrl
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayThinkingIntensity: "nope" }).gatewayThinkingIntensity,
    THINKING_INTENSITIES.HIGH
  );
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, gatewayThinkingIntensity: THINKING_INTENSITIES.ULTRA }).gatewayThinkingIntensity,
    THINKING_INTENSITIES.ULTRA
  );
});

test("gateway key is not persisted unless explicitly remembered", async () => {
  const chrome = createFakeChrome();

  await saveSettings(chrome, { ...DEFAULT_SETTINGS, gatewayApiKey: "gateway-test-key", rememberProviderKeys: false });
  const transient = await getSettings(chrome);
  assert.equal(transient.gatewayApiKey, "");

  await saveSettings(chrome, { ...DEFAULT_SETTINGS, gatewayApiKey: "gateway-test-key", rememberProviderKeys: true });
  const persisted = await getSettings(chrome);
  assert.equal(persisted.gatewayApiKey, "gateway-test-key");
});
