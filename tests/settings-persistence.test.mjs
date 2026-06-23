import assert from "node:assert/strict";
import test from "node:test";
import { getSettings, saveSettings } from "../src/core/controller.js";
import { DEFAULT_SETTINGS, PAGE_SAMPLING_CONSENT_MODES, THINKING_INTENSITIES } from "../src/shared/settings.js";
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

test("provider keys are not persisted unless explicitly remembered", async () => {
  const chrome = createFakeChrome();

  await saveSettings(chrome, { ...DEFAULT_SETTINGS, gatewayApiKey: "gateway-test-key", deepseekApiKey: "deepseek-test-key", rememberProviderKeys: false });
  const transient = await getSettings(chrome);
  assert.equal(transient.gatewayApiKey, "");
  assert.equal(transient.deepseekApiKey, "");

  await saveSettings(chrome, { ...DEFAULT_SETTINGS, gatewayApiKey: "gateway-test-key", deepseekApiKey: "deepseek-test-key", rememberProviderKeys: true });
  const persisted = await getSettings(chrome);
  assert.equal(persisted.gatewayApiKey, "gateway-test-key");
  assert.equal(persisted.deepseekApiKey, "deepseek-test-key");
});
