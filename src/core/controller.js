import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";
import { applyValidatedPlan, undoFromRollback } from "./chrome-executor.js";
import { createPlan } from "./planner.js";
import { buildPreview } from "./preview.js";
import { STORAGE_KEYS, getLocal, removeLocal, setLocal } from "./storage.js";
import { collectTabInventory } from "./tab-inventory.js";
import { validatePlan } from "./plan-validator.js";

export async function handleRuntimeMessage(chromeApi, message) {
  switch (message?.type) {
    case "settings:get":
      return getSettings(chromeApi);
    case "settings:save":
      return saveSettings(chromeApi, message.settings);
    case "tabs:analyze":
      return analyzeTabs(chromeApi, message.settings, { windowId: message.windowId });
    case "tabs:applyLastPlan":
      return applyLastPlan(chromeApi);
    case "tabs:undoLastApply":
      return undoLastApply(chromeApi);
    default:
      throw new Error(`Unknown message type: ${message?.type || "<missing>"}`);
  }
}

export async function getSettings(chromeApi) {
  return normalizeSettings(await getLocal(chromeApi, STORAGE_KEYS.settings, DEFAULT_SETTINGS));
}

export async function saveSettings(chromeApi, nextSettings) {
  const settings = normalizeSettings(nextSettings);
  await setLocal(chromeApi, STORAGE_KEYS.settings, settingsForPersistence(settings));
  return settings;
}

export async function analyzeTabs(chromeApi, rawSettings, invocation = {}) {
  const settings = await saveSettings(chromeApi, rawSettings);
  const inventory = await collectTabInventory(chromeApi, settings, invocation);
  const plan = await createPlan(inventory, settings);
  const validation = validatePlan(plan, inventory, settings);
  const preview = buildPreview(plan, inventory, validation, settings);
  const jobSettings = redactSettingsForJob(settings);
  const job = {
    createdAt: new Date().toISOString(),
    settings: jobSettings,
    invocation,
    inventory,
    plan,
    validation,
    preview
  };

  await setLocal(chromeApi, STORAGE_KEYS.lastJob, job);
  return job;
}

export async function applyLastPlan(chromeApi) {
  const job = await getLocal(chromeApi, STORAGE_KEYS.lastJob);
  if (!job) throw new Error("No analyzed plan is available.");
  if (!job.validation?.ok) {
    throw new Error(`Cannot apply an invalid plan: ${(job.validation?.errors || []).join(" ")}`);
  }

  const latestInventory = await collectTabInventory(chromeApi, job.settings, job.invocation);
  const latestValidation = validatePlan(job.plan, latestInventory, job.settings);
  if (!latestValidation.ok) {
    throw new Error(`Tabs changed since preview: ${latestValidation.errors.join(" ")}`);
  }

  const { rollback, result } = await applyValidatedPlan(chromeApi, job.plan, latestInventory, job.settings);
  await setLocal(chromeApi, STORAGE_KEYS.lastRollback, rollback);
  return result;
}

export async function undoLastApply(chromeApi) {
  const rollback = await getLocal(chromeApi, STORAGE_KEYS.lastRollback);
  if (!rollback) throw new Error("No rollback snapshot is available.");
  const result = await undoFromRollback(chromeApi, rollback);
  await removeLocal(chromeApi, STORAGE_KEYS.lastRollback);
  return result;
}

function redactSettingsForJob(settings) {
  return { ...settings, openaiApiKey: "" };
}

function settingsForPersistence(settings) {
  if (settings.pageSamplingConsentMode !== "acknowledged_for_session") return settings;
  return { ...settings, pageSamplingConsentMode: "not_acknowledged" };
}
