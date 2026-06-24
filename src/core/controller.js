import {
  BUILTIN_GATEWAY_BASE_URL,
  DEFAULT_SETTINGS,
  ORGANIZE_MODES,
  PAGE_CONTEXT_MODES,
  PLANNER_PROVIDERS,
  TARGET_WINDOW_MODES,
  normalizeSettings
} from "../shared/settings.js";
import { applyValidatedPlan, createRollbackSnapshot, undoFromRollback } from "./chrome-executor.js";
import { cachedPageSampleForTab, rememberPageSummary } from "./page-summary-cache.js";
import { requestPageSample } from "./page-sampler.js";
import { createPlan } from "./planner.js";
import { normalizePlanOrder } from "./plan-normalizer.js";
import { buildPreview } from "./preview.js";
import { STORAGE_KEYS, getLocal, removeLocal, setLocal } from "./storage.js";
import { collectTabInventory } from "./tab-inventory.js";
import { validatePlan } from "./plan-validator.js";

const activeAnalyses = new Map();
const ACTIVE_JOB_TERMINAL_STATUSES = new Set(["complete", "canceled", "error"]);
const APPLY_REBASE_MAX_CHANGED_TABS = 25;
const APPLY_REBASE_MAX_CHANGED_RATIO = 0.2;
const PROGRESS_COPY_MODEL = "gpt-5.3-codex-spark";
const PROGRESS_COPY_COUNT = 90;
const PROGRESS_COPY_MAX_LENGTH = 18;
const PAGE_SAMPLE_CONCURRENCY = 6;
const PAGE_SAMPLE_TIMEOUT_MS = 1800;
const PAGE_SAMPLE_COUNT_COPY_THRESHOLD = 8;

export async function handleRuntimeMessage(chromeApi, message) {
  switch (message?.type) {
    case "settings:get":
      return getSettings(chromeApi);
    case "settings:save":
      return saveSettings(chromeApi, message.settings);
    case "tabs:startAnalyze":
      return startAnalyzeTabs(chromeApi, message.settings, { windowId: message.windowId });
    case "tabs:analyze":
      return analyzeTabs(chromeApi, message.settings, { windowId: message.windowId });
    case "tabs:getActiveJob":
      return getActiveJob(chromeApi);
    case "tabs:getLastJob":
      return getLastJob(chromeApi);
    case "tabs:clearAnalysisState":
      return clearAnalysisState(chromeApi);
    case "tabs:cancelActiveJob":
      return cancelActiveJob(chromeApi);
    case "progressCopy:generate":
      return generateProgressCopy(chromeApi, message);
    case "tabs:applyLastPlan":
      return applyLastPlan(chromeApi, { confirmChangedTabs: Boolean(message.confirmChangedTabs) });
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
  const { operationId, abortController } = await createActiveAnalysis(chromeApi, rawSettings, invocation);
  return runActiveAnalysis(chromeApi, rawSettings, invocation, operationId, abortController);
}

export async function startAnalyzeTabs(chromeApi, rawSettings, invocation = {}) {
  const { operationId, abortController } = await createActiveAnalysis(chromeApi, rawSettings, invocation);
  runActiveAnalysis(chromeApi, rawSettings, invocation, operationId, abortController).catch(() => {});
  return { operationId };
}

async function createActiveAnalysis(chromeApi, rawSettings, invocation = {}) {
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

  return { operationId, abortController };
}

async function runActiveAnalysis(chromeApi, rawSettings, invocation, operationId, abortController) {
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

    const planOptions = {
      signal: abortController.signal,
      onProgress: reportProgress
    };
    if (settings.plannerProvider === PLANNER_PROVIDERS.GATEWAY) {
      planOptions.installId = await getOrCreateInstallId(chromeApi);
    }

    await reportProgress({ phase: "planning", progress: 40, message: "正在生成 AI 方案" });
    const { plan, validation } = await createValidatedPlan(inventory, settings, {
      ...planOptions
    });
    throwIfCanceled(abortController.signal);

    await reportProgress({ phase: "preview", progress: 96, message: "正在生成预览" });
    throwIfCanceled(abortController.signal);
    const preview = buildPreview(plan, inventory, validation, settings);
    throwIfCanceled(abortController.signal);
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

export async function getLastJob(chromeApi) {
  return getLocal(chromeApi, STORAGE_KEYS.lastJob);
}

export async function clearAnalysisState(chromeApi) {
  const job = await getLocal(chromeApi, STORAGE_KEYS.activeJob);
  if (job && !ACTIVE_JOB_TERMINAL_STATUSES.has(job.status)) {
    throw new Error("正在整理中，不能清空当前方案。");
  }
  await removeLocal(chromeApi, STORAGE_KEYS.activeJob);
  await removeLocal(chromeApi, STORAGE_KEYS.lastJob);
  return { cleared: true };
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
    status: "canceled",
    phase: "canceled",
    message: "已取消整理。",
    error: "",
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  controller?.abort();
  return { canceled: Boolean(controller), job: nextJob };
}

export async function generateProgressCopy(chromeApi, request = {}) {
  if (typeof fetch !== "function") {
    throw new Error("Fetch is not available for progress copy generation.");
  }

  const activeJob = await getActiveJob(chromeApi);
  const installId = await getOrCreateInstallId(chromeApi);
  const languageMode = normalizeProgressLanguage(request.languageMode || activeJob?.settings?.languageMode);
  const body = {
    model: PROGRESS_COPY_MODEL,
    messages: [
      {
        role: "system",
        content: [
          "Return strict JSON only: {\"messages\":[\"...\"]}.",
          "Write short loading captions for an AI browser-tab organization extension.",
          "Do not claim real internal thoughts, exact work already completed, or user-private content.",
          "Avoid repeating wording. No numbering, markdown, emoji, quotes, or terminal punctuation.",
          `Return exactly ${PROGRESS_COPY_COUNT} messages. Each message must be at most ${PROGRESS_COPY_MAX_LENGTH} Chinese characters or 6 English words.`
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          languageMode,
          phase: String(request.phase || activeJob?.phase || "planning"),
          tabCount: Number(request.tabCount || activeJob?.tabCount || 0),
          windowCount: Number(request.windowCount || activeJob?.windowCount || 0),
          style: "calm, varied, product-like, suitable for multi-minute progress UI"
        })
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200
  };

  const response = await fetch(`${BUILTIN_GATEWAY_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tab-tidy-install-id": installId
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Progress copy generation failed with status ${response.status}.`);
  }

  return {
    model: PROGRESS_COPY_MODEL,
    messages: normalizeProgressCopyMessages(extractProgressCopyText(data))
  };
}

export async function applyLastPlan(chromeApi, options = {}) {
  const job = await getLocal(chromeApi, STORAGE_KEYS.lastJob);
  if (!job) throw new Error("No analyzed plan is available.");
  if (!job.validation?.ok) {
    throw new Error(`Cannot apply an invalid plan: ${(job.validation?.errors || []).join(" ")}`);
  }

  const latestInventory = await collectTabInventory(chromeApi, job.settings, job.invocation);
  let planForApply = job.plan;
  let inventoryForApply = latestInventory;
  let rebaseSummary = null;
  let latestValidation = validatePlan(planForApply, latestInventory, job.settings);
  if (!latestValidation.ok) {
    const rebased = rebasePlanForLatestInventory(job.plan, job.inventory, latestInventory, job.settings, {
      includeUnpreviewedTabsInReview: Boolean(options.confirmChangedTabs)
    });
    if (!rebased.validation.ok) {
      throw new Error(`标签页变化较多，请重新生成方案。${rebased.validation.errors.join(" ")}`);
    }
    if (shouldRejectRebasedPlan(rebased.summary, job.inventory, latestInventory)) {
      throw new Error(`标签页变化较多，请重新生成方案。变化标签页 ${rebased.summary.changedTabsCount} 个。`);
    }
    if (rebased.summary.changedTabsCount && !options.confirmChangedTabs) {
      return {
        requiresChangedTabsConfirmation: true,
        rebasedPlan: rebased.summary
      };
    }
    planForApply = rebased.plan;
    inventoryForApply = rebased.inventory;
    rebaseSummary = rebased.summary;
  }

  const rollbackSnapshot = await createRollbackSnapshot(chromeApi, inventoryForApply, job.settings);
  await setLocal(chromeApi, STORAGE_KEYS.lastRollback, rollbackSnapshot);

  const { rollback, result } = await applyValidatedPlan(
    chromeApi,
    planForApply,
    inventoryForApply,
    job.settings,
    rollbackSnapshot,
    (nextRollback) => setLocal(chromeApi, STORAGE_KEYS.lastRollback, nextRollback)
  );
  await setLocal(chromeApi, STORAGE_KEYS.lastRollback, rollback);
  return rebaseSummary ? { ...result, rebasedPlan: rebaseSummary } : result;
}

function rebasePlanForLatestInventory(plan, originalInventory, latestInventory, rawSettings = {}, options = {}) {
  const settings = normalizeSettings(rawSettings);
  const originalEligibleIds = new Set((originalInventory?.tabs || []).map((tab) => tab.tabId));
  const originalPlannerIds = new Set((originalInventory?.plannerTabs || []).map((tab) => tab.tabId));
  const includeUnpreviewedTabsInReview = Boolean(options.includeUnpreviewedTabsInReview);
  const inventoryForApply = filterInventoryForApply(latestInventory, originalEligibleIds, originalPlannerIds, {
    includeUnpreviewedTabsInReview
  });
  const latestTabsById = new Map((inventoryForApply.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const unpreviewedPlannerTabs = (latestInventory.plannerTabs || []).filter((tab) => !originalPlannerIds.has(tab.tabId));
  const seen = new Set();
  const summary = {
    removedTabIds: [],
    addedReviewTabIds: includeUnpreviewedTabsInReview ? unpreviewedPlannerTabs.map((tab) => tab.tabId) : [],
    skippedNewTabIds: includeUnpreviewedTabsInReview ? [] : unpreviewedPlannerTabs.map((tab) => tab.tabId),
    duplicateTabIds: [],
    droppedGroupKeys: [],
    changedTabsCount: 0
  };

  const rebaseRef = (ref, owner) => {
    if (!ref || typeof ref.tabId !== "number") return null;
    const tab = latestTabsById.get(ref.tabId);
    if (!tab) {
      summary.removedTabIds.push(ref.tabId);
      return null;
    }
    if (seen.has(ref.tabId)) {
      summary.duplicateTabIds.push(ref.tabId);
      return null;
    }
    seen.add(ref.tabId);
    return {
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: ref.reason || (owner === "review" ? "Kept for review after tabs changed since preview." : undefined)
    };
  };

  const groups = [];
  for (const group of Array.isArray(plan.groups) ? plan.groups : []) {
    const tabRefs = (Array.isArray(group?.tabRefs) ? group.tabRefs : [])
      .map((ref) => rebaseRef(ref, group.groupKey || group.title || "group"))
      .filter(Boolean);
    if (tabRefs.length) {
      groups.push({ ...group, tabRefs });
    } else {
      summary.droppedGroupKeys.push(group?.groupKey || group?.title || "<unknown>");
    }
  }

  const reviewTabs = (Array.isArray(plan.reviewTabs) ? plan.reviewTabs : [])
    .map((ref) => rebaseRef(ref, "review"))
    .filter(Boolean);

  if (includeUnpreviewedTabsInReview) {
    for (const tab of unpreviewedPlannerTabs) {
      if (seen.has(tab.tabId)) continue;
      seen.add(tab.tabId);
      reviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: "Tab appeared after preview; user confirmed placing it in review."
      });
    }
  }

  const rebasedPlan = {
    ...plan,
    mode: settings.organizeMode,
    targetWindow: rebaseTargetWindow(plan.targetWindow, inventoryForApply, settings),
    groups,
    reviewTabs,
    excludedTabs: (inventoryForApply.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: tab.exclusionReason || "Excluded by current settings."
    }))
  };

  summary.removedTabIds = uniqueNumbers(summary.removedTabIds);
  summary.addedReviewTabIds = uniqueNumbers(summary.addedReviewTabIds);
  summary.skippedNewTabIds = uniqueNumbers(summary.skippedNewTabIds);
  summary.duplicateTabIds = uniqueNumbers(summary.duplicateTabIds);
  summary.changedTabsCount =
    summary.removedTabIds.length + summary.addedReviewTabIds.length + summary.skippedNewTabIds.length + summary.duplicateTabIds.length;

  return {
    plan: rebasedPlan,
    inventory: inventoryForApply,
    validation: validatePlan(rebasedPlan, inventoryForApply, settings),
    summary
  };
}

function filterInventoryForApply(inventory, originalEligibleIds, originalPlannerIds, options = {}) {
  const includeUnpreviewedTabsInReview = Boolean(options.includeUnpreviewedTabsInReview);
  const latestPlannerIds = new Set((inventory.plannerTabs || []).map((tab) => tab.tabId));
  const shouldIncludeTab = (tab) =>
    originalEligibleIds.has(tab.tabId) || (includeUnpreviewedTabsInReview && latestPlannerIds.has(tab.tabId));
  const stablePlannerTabs = includeUnpreviewedTabsInReview
    ? inventory.plannerTabs || []
    : (inventory.plannerTabs || []).filter((tab) => originalPlannerIds.has(tab.tabId));
  return {
    ...inventory,
    tabs: (inventory.tabs || []).filter(shouldIncludeTab),
    plannerTabs: stablePlannerTabs,
    lockedGroups: (inventory.lockedGroups || [])
      .map((group) => ({
        ...group,
        tabIds: (group.tabIds || []).filter((tabId) => shouldIncludeTab({ tabId }))
      }))
      .filter((group) => group.tabIds.length),
    excludedTabs: inventory.excludedTabs || []
  };
}

function rebaseTargetWindow(targetWindow, inventory, settings) {
  if (settings.organizeMode === ORGANIZE_MODES.CURRENT_WINDOW) {
    return {
      ...(targetWindow || {}),
      kind: TARGET_WINDOW_MODES.CURRENT_WINDOW,
      windowId: inventory.scope?.currentWindowId ?? targetWindow?.windowId ?? null,
      title: targetWindow?.title || "Current Window"
    };
  }

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.CURRENT_WINDOW) {
    return {
      ...(targetWindow || {}),
      kind: TARGET_WINDOW_MODES.CURRENT_WINDOW,
      windowId: inventory.scope?.invocationWindowId ?? targetWindow?.windowId ?? null,
      title: targetWindow?.title || "Current Window"
    };
  }

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.SELECTED_WINDOW) {
    return {
      ...(targetWindow || {}),
      kind: TARGET_WINDOW_MODES.SELECTED_WINDOW,
      windowId: settings.selectedTargetWindowId,
      title: targetWindow?.title || "Selected Window"
    };
  }

  return { ...(targetWindow || {}), kind: TARGET_WINDOW_MODES.NEW_WINDOW };
}

function shouldRejectRebasedPlan(summary, originalInventory, latestInventory) {
  const changed = summary.changedTabsCount || 0;
  if (!changed) return false;
  const eligible = Math.max(1, (originalInventory?.plannerTabs || latestInventory.plannerTabs || []).length);
  const allowedChanges = Math.max(5, Math.min(APPLY_REBASE_MAX_CHANGED_TABS, Math.ceil(eligible * APPLY_REBASE_MAX_CHANGED_RATIO)));
  return changed > allowedChanges;
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => typeof value === "number"))];
}

function extractProgressCopyText(data) {
  const content = data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeProgressCopyMessages(text) {
  const parsed = parseJsonObjectFromText(text);
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const normalized = [];
  const seen = new Set();

  for (const message of messages) {
    const clean = cleanProgressCopyMessage(message);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
    if (normalized.length >= PROGRESS_COPY_COUNT) break;
  }

  if (normalized.length < 12) {
    throw new Error("Progress copy generation returned too few usable messages.");
  }
  return normalized;
}

function parseJsonObjectFromText(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("Progress copy generation returned invalid JSON.");
  }
}

function cleanProgressCopyMessage(value) {
  return String(value || "")
    .replace(/^[\s\d.)、-]+/, "")
    .replace(/[。！？.!?…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function normalizeProgressLanguage(value) {
  return value === "en-US" ? "en-US" : "zh-CN";
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
  const cachedTabIds = await attachCachedPageSamples(chromeApi, inventory, settings, options);
  if (settings.pageContextMode === PAGE_CONTEXT_MODES.OFF) {
    await options.onProgress?.({
      phase: "sampling",
      progress: 24,
      message: cachedTabIds.size ? `使用已缓存页面摘要 ${cachedTabIds.size} 个` : "页面摘要已关闭"
    });
    return inventory;
  }

  const candidates = selectSamplingCandidates(inventory, settings).filter((tab) => !cachedTabIds.has(tab.tabId));
  if (!candidates.length) {
    await options.onProgress?.({
      phase: "sampling",
      progress: 30,
      message: cachedTabIds.size ? `使用已缓存页面摘要 ${cachedTabIds.size} 个` : "没有需要读取摘要的页面"
    });
    return inventory;
  }

  let sampledOk = 0;
  let sampledBlocked = 0;
  let completed = 0;
  let nextIndex = 0;
  const runnableCandidates = [];
  const candidateOrder = new Map(candidates.map((tab, index) => [tab.tabId, index]));

  for (const tab of candidates) {
    throwIfCanceled(options.signal);
    if (shouldSkipPageSample(tab)) {
      sampledBlocked += 1;
      completed += 1;
      inventory.pageSamples.push(skippedPageSampleForTab(tab));
    } else {
      runnableCandidates.push(tab);
    }
  }

  const workerCount = Math.min(PAGE_SAMPLE_CONCURRENCY, runnableCandidates.length);

  await options.onProgress?.({
    phase: "sampling",
    progress: 20 + Math.round((completed / candidates.length) * 16),
    message: pageSamplingProgressMessage(sampledOk)
  });

  const sampleOne = async (tab) => {
    await options.onProgress?.({
      phase: "sampling",
      progress: 20 + Math.round((completed / candidates.length) * 16),
      message: pageSamplingProgressMessage(sampledOk)
    });
    const liveTab = await getLiveTab(chromeApi, tab.tabId);
    const sampleResult = liveTab
      ? await requestPageSampleWithTimeout(chromeApi, liveTab, settings, options.signal, `Improve semantic grouping for tab ${tab.tabId}.`)
      : { status: "missing", reason: "Tab disappeared before sampling." };
    if (sampleResult.status === "ok") {
      sampledOk += 1;
      if (settings.continuousPageSummaries && liveTab) {
        await rememberPageSummary(chromeApi, liveTab, sampleResult).catch(() => null);
      }
    } else {
      sampledBlocked += 1;
    }
    inventory.pageSamples.push({
      tabId: tab.tabId,
      windowId: tab.windowId,
      status: sampleResult.status,
      origin: sampleResult.origin || "",
      reason: sampleResult.reason || "",
      sample: sampleResult.sample || null
    });
    completed += 1;
    await options.onProgress?.({
      phase: "sampling",
      progress: 20 + Math.round((completed / candidates.length) * 16),
      message: pageSamplingProgressMessage(sampledOk)
    });
  };

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < runnableCandidates.length) {
        throwIfCanceled(options.signal);
        const tab = runnableCandidates[nextIndex];
        nextIndex += 1;
        await sampleOne(tab);
      }
    })
  );

  inventory.pageSamples.sort((left, right) => {
    return (candidateOrder.get(left.tabId) ?? 0) - (candidateOrder.get(right.tabId) ?? 0);
  });
  await options.onProgress?.({
    phase: "sampling",
    progress: 36,
    message: pageSamplingDoneMessage(sampledOk)
  });
  return inventory;
}

function pageSamplingProgressMessage(sampledOk) {
  return sampledOk >= PAGE_SAMPLE_COUNT_COPY_THRESHOLD ? `正在补充页面线索，已补充 ${sampledOk} 个` : "正在补充页面线索";
}

function pageSamplingDoneMessage(sampledOk) {
  if (sampledOk >= PAGE_SAMPLE_COUNT_COPY_THRESHOLD) return `已补充 ${sampledOk} 个页面摘要`;
  if (sampledOk > 0) return "已补充部分页面线索";
  return "继续参考标题、网址和原始顺序";
}

async function attachCachedPageSamples(chromeApi, inventory, settings, options = {}) {
  if (!settings.continuousPageSummaries) return new Set();

  const cachedTabIds = new Set();
  for (const tab of inventory.plannerTabs || []) {
    throwIfCanceled(options.signal);
    if (!tab.sampleable) continue;
    const cached = await cachedPageSampleForTab(chromeApi, tab).catch(() => null);
    if (!cached) continue;
    inventory.pageSamples.push(cached);
    cachedTabIds.add(tab.tabId);
  }
  return cachedTabIds;
}

function shouldSkipPageSample(tab) {
  return Boolean(tab.discarded);
}

function skippedPageSampleForTab(tab) {
  return {
    tabId: tab.tabId,
    windowId: tab.windowId,
    status: "discarded",
    origin: "",
    reason: "Tab is sleeping; page summary was skipped to avoid waking it.",
    sample: null
  };
}

async function requestPageSampleWithTimeout(chromeApi, tab, settings, signal, reason) {
  const timeoutMs = Number(globalThis.__semanticTabAgentPageSampleTimeoutMs) || PAGE_SAMPLE_TIMEOUT_MS;
  try {
    return await raceWithTimeoutAndAbort(
      requestPageSample(chromeApi, tab, settings, reason),
      timeoutMs,
      signal
    );
  } catch (error) {
    throwIfCanceled(signal);
    const rawUrl = tab.url || tab.pendingUrl || "";
    return {
      status: "blocked",
      origin: safeOriginPattern(rawUrl),
      reason: /timed out/i.test(String(error?.message || ""))
        ? "Timed out while reading page summary."
        : "Page summary could not be read in time."
    };
  }
}

function raceWithTimeoutAndAbort(promise, timeoutMs, signal) {
  if (signal?.aborted) return Promise.reject(new Error("已取消整理。"));

  let timeoutId;
  let abortHandler;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Page sampling timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(new Error("已取消整理。"));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });

  return Promise.race([promise, timeoutPromise, abortPromise]).finally(() => {
    clearTimeout(timeoutId);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  });
}

function safeOriginPattern(rawUrl) {
  try {
    return new URL(rawUrl).origin + "/*";
  } catch {
    return "";
  }
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

async function getOrCreateInstallId(chromeApi) {
  const existing = await getLocal(chromeApi, STORAGE_KEYS.installId, "");
  if (isValidInstallId(existing)) return existing;

  const installId = createInstallId();
  await setLocal(chromeApi, STORAGE_KEYS.installId, installId);
  return installId;
}

function createInstallId() {
  if (globalThis.crypto?.randomUUID) {
    return `install_${globalThis.crypto.randomUUID()}`;
  }
  return `install_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function isValidInstallId(value) {
  return /^install_[a-zA-Z0-9_-]{8,80}$/.test(String(value || ""));
}

async function updateActiveJob(chromeApi, operationId, patch) {
  const current = await getLocal(chromeApi, STORAGE_KEYS.activeJob, {});
  if (current?.operationId && current.operationId !== operationId) return current;
  if (ACTIVE_JOB_TERMINAL_STATUSES.has(current?.status)) return current;

  const nextPatch = { ...patch };
  if (current?.status === "canceling") {
    if (nextPatch.status === "complete") {
      nextPatch.status = "canceled";
      nextPatch.phase = "canceled";
      nextPatch.message = "已取消整理。";
      nextPatch.error = "";
      nextPatch.finishedAt = nextPatch.finishedAt || new Date().toISOString();
    } else if (!ACTIVE_JOB_TERMINAL_STATUSES.has(nextPatch.status)) {
      nextPatch.status = "canceling";
      nextPatch.phase = "canceling";
      nextPatch.message = "正在取消整理";
    }
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
