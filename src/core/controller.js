import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

const STORAGE_KEYS = Object.freeze({
  settings: "semanticTabAgent.settings"
});

export async function handleRuntimeMessage(chromeApi, message) {
  switch (message?.type) {
    case "settings:get":
      return getSettings(chromeApi);
    case "settings:save":
      return saveSettings(chromeApi, message.settings);
    case "tabs:analyze":
      throw new Error("Tab analysis is not wired yet.");
    case "tabs:applyLastPlan":
      throw new Error("Apply is not wired yet.");
    case "tabs:undoLastApply":
      throw new Error("Undo is not wired yet.");
    default:
      throw new Error(`Unknown message type: ${message?.type || "<missing>"}`);
  }
}

export async function getSettings(chromeApi) {
  const stored = await chromeApi.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(stored[STORAGE_KEYS.settings] || DEFAULT_SETTINGS);
}

export async function saveSettings(chromeApi, nextSettings) {
  const settings = normalizeSettings(nextSettings);
  await chromeApi.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  return settings;
}
