import { DEFAULT_SETTINGS, PAGE_CONTEXT_MODES, PLANNER_PROVIDERS, normalizeSettings } from "../shared/settings.js";
import { applyValidatedPlan, createRollbackSnapshot, undoFromRollback } from "./chrome-executor.js";
import { requestPageSample } from "./page-sampler.js";
import { createPlan } from "./planner.js";
import { normalizePlanOrder } from "./plan-normalizer.js";
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
  await attachPageSamples(chromeApi, inventory, settings);
  const { plan, validation } = await createValidatedPlan(inventory, settings);
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

  const rollbackSnapshot = await createRollbackSnapshot(chromeApi, latestInventory, job.settings);
  await setLocal(chromeApi, STORAGE_KEYS.lastRollback, rollbackSnapshot);

  const { rollback, result } = await applyValidatedPlan(
    chromeApi,
    job.plan,
    latestInventory,
    job.settings,
    rollbackSnapshot,
    (nextRollback) => setLocal(chromeApi, STORAGE_KEYS.lastRollback, nextRollback)
  );
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
  return { ...settings, gatewayApiKey: "", deepseekApiKey: "" };
}

function settingsForPersistence(settings) {
  const persisted = { ...settings };
  if (persisted.pageSamplingConsentMode === "acknowledged_for_session") {
    persisted.pageSamplingConsentMode = "not_acknowledged";
  }
  if (!persisted.rememberProviderKeys) {
    persisted.gatewayApiKey = "";
    persisted.deepseekApiKey = "";
  }
  return persisted;
}

async function createValidatedPlan(inventory, settings) {
  const plan = normalizePlanOrder(await createPlan(inventory, settings), inventory);
  let validation = validatePlan(plan, inventory, settings);
  if (validation.ok || settings.plannerProvider === PLANNER_PROVIDERS.FAKE) {
    return { plan, validation };
  }

  const retrySettings = {
    ...settings,
    customPrompt: [
      settings.customPrompt,
      "Previous planner output failed local validation. Return a corrected JSON plan only.",
      `Validation errors: ${validation.errors.join(" ")}`
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000)
  };
  const retryPlan = normalizePlanOrder(await createPlan(inventory, retrySettings), inventory);
  validation = validatePlan(retryPlan, inventory, settings);
  return { plan: retryPlan, validation };
}

async function attachPageSamples(chromeApi, inventory, settings) {
  inventory.pageSamples = [];
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.OFF) return inventory;

  const candidates = selectSamplingCandidates(inventory, settings);
  for (const tab of candidates) {
    const liveTab = await getLiveTab(chromeApi, tab.tabId);
    const sampleResult = liveTab
      ? await requestPageSample(chromeApi, liveTab, settings, `Improve semantic grouping for tab ${tab.tabId}.`)
      : { status: "missing", reason: "Tab disappeared before sampling." };
    inventory.pageSamples.push({
      tabId: tab.tabId,
      windowId: tab.windowId,
      status: sampleResult.status,
      origin: sampleResult.origin || "",
      reason: sampleResult.reason || "",
      sample: sampleResult.sample || null
    });
  }
  return inventory;
}

function selectSamplingCandidates(inventory, settings) {
  const tabs = (inventory.plannerTabs || []).filter((tab) => tab.sampleable);
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.ACTIVE_TAB_ONLY) {
    return tabs.filter((tab) => tab.active);
  }
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS) {
    return tabs;
  }
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.AMBIGUOUS_WITH_PERMISSION) {
    return tabs.filter(isAmbiguousTab);
  }
  return [];
}

function isAmbiguousTab(tab) {
  const title = String(tab.title || "").trim().toLowerCase();
  return !title || title.length < 18 || ["home", "new tab", "untitled", "login", "sign in"].some((term) => title.includes(term));
}

async function getLiveTab(chromeApi, tabId) {
  try {
    return await chromeApi.tabs.get(tabId);
  } catch {
    return null;
  }
}
