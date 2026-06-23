import { DEFAULT_SETTINGS, PAGE_CONTEXT_MODES, PLANNER_PROVIDERS, normalizeSettings } from "../shared/settings.js";
import { applyValidatedPlan, createRollbackSnapshot, undoFromRollback } from "./chrome-executor.js";
import { requestPageSample } from "./page-sampler.js";
import { createPlan } from "./planner.js";
import { normalizePlanOrder } from "./plan-normalizer.js";
import { buildPreview } from "./preview.js";
import { STORAGE_KEYS, getLocal, removeLocal, setLocal } from "./storage.js";
import { collectTabInventory } from "./tab-inventory.js";
import { validatePlan } from "./plan-validator.js";

const activeAnalyses = new Map();
const ACTIVE_JOB_TERMINAL_STATUSES = new Set(["complete", "canceled", "error"]);

export async function handleRuntimeMessage(chromeApi, message) {
  switch (message?.type) {
    case "settings:get":
      return getSettings(chromeApi);
    case "settings:save":
      return saveSettings(chromeApi, message.settings);
    case "tabs:analyze":
      return analyzeTabs(chromeApi, message.settings, { windowId: message.windowId });
    case "tabs:getActiveJob":
      return getActiveJob(chromeApi);
    case "tabs:cancelActiveJob":
      return cancelActiveJob(chromeApi);
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
  await assertNoRunningAnalysis(chromeApi);

  const operationId = createOperationId();
  const abortController = new AbortController();
  activeAnalyses.set(operationId, abortController);
  await writeActiveJob(chromeApi, {
    operationId,
    status: "running",
    phase: "starting",
    progress: 1,
    message: "正在准备整理",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: redactSettingsForJob(normalizeSettings(rawSettings)),
    invocation
  });

  const reportProgress = (patch) => updateActiveJob(chromeApi, operationId, patch);

  try {
    await reportProgress({ phase: "settings", progress: 4, message: "正在保存偏好" });
    const settings = await saveSettings(chromeApi, rawSettings);
    throwIfCanceled(abortController.signal);

    await reportProgress({ phase: "inventory", progress: 10, message: "正在读取标签页" });
    const inventory = await collectTabInventory(chromeApi, settings, invocation);
    await reportProgress({
      phase: "inventory",
      progress: 16,
      message: `已读取 ${inventory.plannerTabs?.length || 0} 个可整理标签页`,
      tabCount: inventory.plannerTabs?.length || 0,
      windowCount: inventory.windows?.length || 0
    });
    throwIfCanceled(abortController.signal);

    await attachPageSamples(chromeApi, inventory, settings, {
      signal: abortController.signal,
      onProgress: reportProgress
    });
    throwIfCanceled(abortController.signal);

    await reportProgress({ phase: "planning", progress: 40, message: "正在生成 AI 方案" });
    const { plan, validation } = await createValidatedPlan(inventory, settings, {
      signal: abortController.signal,
      onProgress: reportProgress
    });
    throwIfCanceled(abortController.signal);

    await reportProgress({ phase: "preview", progress: 96, message: "正在生成预览" });
    const preview = buildPreview(plan, inventory, validation, settings);
    const jobSettings = redactSettingsForJob(settings);
    const job = {
      operationId,
      createdAt: new Date().toISOString(),
      settings: jobSettings,
      invocation,
      inventory,
      plan,
      validation,
      preview
    };

    await setLocal(chromeApi, STORAGE_KEYS.lastJob, job);
    await reportProgress({
      status: "complete",
      phase: "complete",
      progress: 100,
      message: validation?.ok ? "方案好了，可以先检查" : "方案需要检查",
      finishedAt: new Date().toISOString()
    });
    return job;
  } catch (error) {
    const canceled = abortController.signal.aborted;
    const message = canceled ? "已取消整理。" : error.message;
    await reportProgress({
      status: canceled ? "canceled" : "error",
      phase: canceled ? "canceled" : "error",
      message,
      error: canceled ? "" : error.message,
      finishedAt: new Date().toISOString()
    });
    throw new Error(message);
  } finally {
    activeAnalyses.delete(operationId);
  }
}

export async function getActiveJob(chromeApi) {
  const job = await getLocal(chromeApi, STORAGE_KEYS.activeJob);
  if (!job) return null;
  if ((job.status === "running" || job.status === "canceling") && !activeAnalyses.has(job.operationId)) {
    return writeActiveJob(chromeApi, {
      ...job,
      status: job.status === "canceling" ? "canceled" : "error",
      phase: job.status === "canceling" ? "canceled" : "error",
      message: job.status === "canceling" ? "已取消整理。" : "后台任务已停止，请重新生成。",
      error: job.status === "canceling" ? "" : "The background worker no longer has this active analysis.",
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  return job;
}

export async function cancelActiveJob(chromeApi) {
  const job = await getLocal(chromeApi, STORAGE_KEYS.activeJob);
  if (!job || ACTIVE_JOB_TERMINAL_STATUSES.has(job.status)) {
    return { canceled: false, job: job || null };
  }

  const controller = activeAnalyses.get(job.operationId);
  const nextJob = await writeActiveJob(chromeApi, {
    ...job,
    status: controller ? "canceling" : "canceled",
    phase: controller ? "canceling" : "canceled",
    message: controller ? "正在取消整理" : "已取消整理。",
    finishedAt: controller ? job.finishedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  controller?.abort();
  return { canceled: Boolean(controller), job: nextJob };
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
  return { ...settings, gatewayApiKey: "" };
}

function settingsForPersistence(settings) {
  const persisted = { ...settings };
  if (persisted.pageSamplingConsentMode === "acknowledged_for_session") {
    persisted.pageSamplingConsentMode = "not_acknowledged";
  }
  if (!persisted.rememberProviderKeys) {
    persisted.gatewayApiKey = "";
  }
  return persisted;
}

async function createValidatedPlan(inventory, settings, options = {}) {
  throwIfCanceled(options.signal);
  const plan = normalizePlanOrder(await createPlan(inventory, settings, options), inventory);
  await options.onProgress?.({ phase: "validation", progress: 88, message: "正在校验 AI 方案" });
  let validation = validatePlan(plan, inventory, settings);
  if (validation.ok || settings.plannerProvider === PLANNER_PROVIDERS.FAKE) {
    return { plan, validation };
  }

  await options.onProgress?.({
    phase: "retrying",
    progress: 90,
    message: "方案未通过校验，正在要求 AI 修正"
  });
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
  const retryPlan = normalizePlanOrder(await createPlan(inventory, retrySettings, options), inventory);
  await options.onProgress?.({ phase: "validation", progress: 94, message: "正在校验修正方案" });
  validation = validatePlan(retryPlan, inventory, settings);
  return { plan: retryPlan, validation };
}

async function attachPageSamples(chromeApi, inventory, settings, options = {}) {
  inventory.pageSamples = [];
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.OFF) {
    await options.onProgress?.({ phase: "sampling", progress: 24, message: "页面摘要已关闭" });
    return inventory;
  }

  const candidates = selectSamplingCandidates(inventory, settings);
  if (!candidates.length) {
    await options.onProgress?.({ phase: "sampling", progress: 30, message: "没有需要读取摘要的页面" });
    return inventory;
  }

  for (const [index, tab] of candidates.entries()) {
    throwIfCanceled(options.signal);
    await options.onProgress?.({
      phase: "sampling",
      progress: 20 + Math.round((index / candidates.length) * 16),
      message: `正在读取页面摘要 ${index + 1}/${candidates.length}`
    });
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
  await options.onProgress?.({ phase: "sampling", progress: 36, message: "页面摘要读取完成" });
  return inventory;
}

async function assertNoRunningAnalysis(chromeApi) {
  const job = await getActiveJob(chromeApi);
  if (job && !ACTIVE_JOB_TERMINAL_STATUSES.has(job.status)) {
    throw new Error("已有整理任务正在运行，请先取消或等待它完成。");
  }
}

function createOperationId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function updateActiveJob(chromeApi, operationId, patch) {
  const current = await getLocal(chromeApi, STORAGE_KEYS.activeJob, {});
  if (current?.operationId && current.operationId !== operationId) return current;

  const nextPatch = { ...patch };
  if (current?.status === "canceling" && !ACTIVE_JOB_TERMINAL_STATUSES.has(nextPatch.status)) {
    nextPatch.status = "canceling";
    nextPatch.phase = "canceling";
    nextPatch.message = "正在取消整理";
  }
  if (
    typeof current?.progress === "number" &&
    typeof nextPatch.progress === "number" &&
    nextPatch.progress < current.progress &&
    !ACTIVE_JOB_TERMINAL_STATUSES.has(nextPatch.status)
  ) {
    nextPatch.progress = current.progress;
  }

  return writeActiveJob(chromeApi, {
    ...current,
    operationId,
    status: current?.status || "running",
    ...nextPatch,
    updatedAt: new Date().toISOString()
  });
}

async function writeActiveJob(chromeApi, job) {
  return setLocal(chromeApi, STORAGE_KEYS.activeJob, sanitizeActiveJob(job));
}

function sanitizeActiveJob(job) {
  const { inventory, plan, preview, validation, ...safeJob } = job || {};
  if (safeJob.settings) safeJob.settings = redactSettingsForJob(safeJob.settings);
  if (typeof safeJob.progress !== "number") {
    delete safeJob.progress;
  } else {
    safeJob.progress = Math.max(0, Math.min(100, Math.round(safeJob.progress)));
  }
  if (safeJob.error) safeJob.error = String(safeJob.error).slice(0, 500);
  if (safeJob.message) safeJob.message = String(safeJob.message).slice(0, 160);
  return safeJob;
}

function throwIfCanceled(signal) {
  if (signal?.aborted) {
    throw new Error("已取消整理。");
  }
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
