import { BUILTIN_GATEWAY_BASE_URL, GATEWAY_CUSTOM_MODEL_VALUE } from "../shared/settings.js";
import { localizedText, reviewGroupReason, reviewGroupTitle } from "../shared/language.js";

const fields = {
  organizeMode: document.querySelector("#organizeMode"),
  targetWindowMode: document.querySelector("#targetWindowMode"),
  existingGroupMode: document.querySelector("#existingGroupMode"),
  reviewGroupMode: document.querySelector("#reviewGroupMode"),
  undoTargetWindowMode: document.querySelector("#undoTargetWindowMode"),
  urlPrivacyMode: document.querySelector("#urlPrivacyMode"),
  pageContextMode: document.querySelector("#pageContextMode"),
  hostPermissionRequestMode: document.querySelector("#hostPermissionRequestMode"),
  languageMode: document.querySelector("#languageMode"),
  promptPreset: document.querySelector("#promptPreset"),
  plannerProvider: document.querySelector("#plannerProvider"),
  gatewayBaseUrl: document.querySelector("#gatewayBaseUrl"),
  gatewayModel: document.querySelector("#gatewayModel"),
  gatewayCustomModel: document.querySelector("#gatewayCustomModel"),
  gatewayThinkingIntensity: document.querySelector("#gatewayThinkingIntensity"),
  gatewayApiKey: document.querySelector("#gatewayApiKey"),
  customPrompt: document.querySelector("#customPrompt"),
  includePinnedTabs: document.querySelector("#includePinnedTabs"),
  includeIncognitoTabs: document.querySelector("#includeIncognitoTabs"),
  collapseGroupsAfterApply: document.querySelector("#collapseGroupsAfterApply"),
  continuousPageSummaries: document.querySelector("#continuousPageSummaries"),
  minConfidenceToApply: document.querySelector("#minConfidenceToApply"),
  maxTabsPerGroup: document.querySelector("#maxTabsPerGroup"),
  ackSampling: document.querySelector("#ackSampling")
};

const settingSwitches = [
  {
    field: "targetWindowMode",
    input: document.querySelector("#targetWindowCurrentToggle"),
    offValue: "new_window",
    onValue: "current_window"
  },
  {
    field: "existingGroupMode",
    input: document.querySelector("#dissolveExistingGroupsToggle"),
    offValue: "preserve_existing_groups",
    onValue: "dissolve_existing_groups"
  },
  {
    field: "reviewGroupMode",
    input: document.querySelector("#createReviewGroupToggle"),
    offValue: "leave_review_ungrouped",
    onValue: "create_review_group"
  },
  {
    field: "undoTargetWindowMode",
    input: document.querySelector("#closeEmptyTargetWindowToggle"),
    offValue: "leave_empty_target_window",
    onValue: "close_empty_created_target_window"
  }
];

const AI_WAIT_PHASES = new Set(["planning", "coarse_planning", "refining", "retrying"]);
const AI_WAIT_RAMP_MS = 45000;
const AI_WAIT_COPY_INTERVAL_SECONDS = 4;
const ACTIVE_JOB_POLL_MS = 600;
const GENERATED_COPY_CACHE_LIMIT = 4;
const AI_WAIT_COPY = Object.freeze({
  planning: ["理解标题线索", "寻找相邻任务", "避开域名硬分组", "检查不确定页", "整理分组边界"],
  coarse_planning: ["快速扫一遍", "寻找跨窗口主题", "切出候选大组", "标记模糊标签"],
  refining: ["拆开过大的组", "复核模糊边界", "合并同一任务", "保留原始顺序"],
  retrying: ["修正校验问题", "补齐遗漏标签", "移除重复分配", "重新检查结构"]
});

const nodes = {
  appShell: document.querySelector(".app-shell"),
  statusText: document.querySelector("#statusText"),
  samplingRisk: document.querySelector("#samplingRisk"),
  continuousSummaryRisk: document.querySelector("#continuousSummaryRisk"),
  hostPermissionField: document.querySelector("#hostPermissionField"),
  targetWindowField: document.querySelector("#targetWindowField"),
  progressBar: document.querySelector("#progressBar"),
  progressFill: document.querySelector("#progressFill"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  closeWindowBtn: document.querySelector("#closeWindowBtn"),
  actions: document.querySelector(".actions"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  cancelBtn: document.querySelector("#cancelBtn"),
  applyBtn: document.querySelector("#applyBtn"),
  undoBtn: document.querySelector("#undoBtn"),
  previewSection: document.querySelector("#previewSection"),
  previewCount: document.querySelector("#previewCount"),
  previewRoot: document.querySelector("#previewRoot"),
  detailsRoot: document.querySelector("#detailsRoot"),
  detailsText: document.querySelector("#detailsText"),
  gatewayCustomModelField: document.querySelector("#gatewayCustomModelField")
};

let lastPreview = null;
let lastCanApply = false;
let canUndo = false;
let pageSamplingOriginCache = { origins: [], refreshedAt: 0 };
let pageSamplingOriginRefreshTimer = null;
let progressPollTimer = null;
let mockActiveJob = null;
let mockLastJob = null;
const generatedCopyByOperation = new Map();
const generatedCopyRequests = new Set();

init().catch((error) => setStatus(error.message, true));

async function init() {
  bindEvents();
  bindSettingSwitches();
  bindChoiceGroups();

  const settings = await sendMessage({ type: "settings:get" });
  writeSettings(settings);
  updateConditionalUi();
  schedulePageSamplingOriginRefresh();
  await hydrateActiveJob();
  syncActionState();
}

function bindEvents() {
  for (const element of Object.values(fields)) {
    if (element === fields.ackSampling || element === fields.continuousPageSummaries) continue;
    element.addEventListener("change", persistSettings);
  }
  fields.ackSampling.addEventListener("change", async () => {
    if (fields.ackSampling.checked) {
      if (fields.pageContextMode.value === "off" || fields.pageContextMode.value === "active_tab_only") {
        fields.pageContextMode.value = "ambiguous_with_permission";
      }
      if (fields.hostPermissionRequestMode.value === "never") {
        fields.hostPermissionRequestMode.value = "ask_for_all_visible_origins";
      }
      updateConditionalUi();
      await persistSettings();
      setStatus("正在请求页面摘要权限");
      try {
        await ensurePageSamplingPermissions(readSettings(), { requestMissing: true });
      } catch (error) {
        fields.ackSampling.checked = false;
        fields.pageContextMode.value = "off";
        fields.hostPermissionRequestMode.value = "never";
        updateConditionalUi();
        await persistSettings();
        setStatus(error.message, true);
        return;
      }
      await persistSettings();
      setStatus("页面摘要已开启");
      return;
    } else {
      fields.pageContextMode.value = "off";
      fields.hostPermissionRequestMode.value = "never";
    }
    await persistSettings();
  });
  fields.continuousPageSummaries.addEventListener("change", async () => {
    if (fields.continuousPageSummaries.checked) {
      try {
        await ensureContinuousSummaryPermissions();
      } catch (error) {
        fields.continuousPageSummaries.checked = false;
        setStatus(error.message, true);
      }
    }
    persistSettings();
  });
  fields.customPrompt.addEventListener("input", debounce(persistSettings, 250));
  fields.gatewayCustomModel.addEventListener("input", debounce(persistSettings, 250));
  fields.pageContextMode.addEventListener("change", updateConditionalUi);
  fields.organizeMode.addEventListener("change", updateConditionalUi);
  fields.plannerProvider.addEventListener("change", updateConditionalUi);
  fields.gatewayModel.addEventListener("change", updateConditionalUi);

  nodes.analyzeBtn.addEventListener("click", handleAnalyzeClick);
  nodes.cancelBtn.addEventListener("click", cancelAnalyze);
  nodes.applyBtn.addEventListener("click", applyLastPlan);
  nodes.undoBtn.addEventListener("click", undoLastApply);
  nodes.closeWindowBtn?.addEventListener("click", () => window.close());
}

function bindChoiceGroups() {
  document.querySelectorAll("[data-choice-for]").forEach((group) => {
    const field = fields[group.dataset.choiceFor];
    if (!field) return;

    group.querySelectorAll("button[data-value]").forEach((button) => {
      button.addEventListener("click", () => {
        field.value = button.dataset.value;
        syncChoiceGroups();
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  });
}

function bindSettingSwitches() {
  for (const settingSwitch of settingSwitches) {
    if (!settingSwitch.input || !fields[settingSwitch.field]) continue;
    settingSwitch.input.addEventListener("change", () => {
      const field = fields[settingSwitch.field];
      field.value = settingSwitch.input.checked ? settingSwitch.onValue : settingSwitch.offValue;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
}

function readSettings() {
  const contentAccessAvailable = hasContentAccessFeature();
  const pageContextMode = normalizePanelPageContextMode(fields.pageContextMode.value);
  const effectivePageContextMode =
    contentAccessAvailable && fields.ackSampling.checked
      ? pageContextMode === "off"
        ? "ambiguous_with_permission"
        : pageContextMode
      : "off";
  const continuousPageSummaries = contentAccessAvailable && fields.continuousPageSummaries.checked;
  return {
    organizeMode: fields.organizeMode.value,
    existingGroupMode: fields.existingGroupMode.value,
    targetWindowMode:
      fields.organizeMode.value === "consolidate_one_window" ? fields.targetWindowMode.value : "current_window",
    reviewGroupMode: fields.reviewGroupMode.value,
    undoTargetWindowMode: fields.undoTargetWindowMode.value,
    urlPrivacyMode: fields.urlPrivacyMode.value,
    pageContextMode: effectivePageContextMode,
    hostPermissionRequestMode:
      contentAccessAvailable &&
      fields.ackSampling.checked &&
      fields.hostPermissionRequestMode.value === "never"
        ? "ask_for_all_visible_origins"
        : fields.hostPermissionRequestMode.value,
    pageSamplingConsentMode:
      continuousPageSummaries
        ? "acknowledged_persistently"
        : contentAccessAvailable && fields.ackSampling.checked
        ? "acknowledged_for_session"
        : "not_acknowledged",
    languageMode: fields.languageMode.value,
    promptPreset: fields.promptPreset.value,
    plannerProvider: fields.plannerProvider.value || "gateway",
    rememberProviderKeys: Boolean(fields.gatewayApiKey.value),
    gatewayBaseUrl: fields.gatewayBaseUrl.value,
    gatewayModel: fields.gatewayModel.value,
    gatewayCustomModel: fields.gatewayCustomModel.value,
    gatewayThinkingIntensity: fields.gatewayThinkingIntensity.value,
    gatewayApiKey: fields.gatewayApiKey.value,
    customPrompt: fields.customPrompt.value,
    includePinnedTabs: fields.includePinnedTabs.checked,
    includeIncognitoTabs: fields.includeIncognitoTabs.checked,
    collapseGroupsAfterApply: fields.collapseGroupsAfterApply.checked,
    continuousPageSummaries,
    minConfidenceToApply: fields.minConfidenceToApply.value,
    maxTabsPerGroup: fields.maxTabsPerGroup.value
  };
}

function writeSettings(settings) {
  const displaySettings = {
    ...settings,
    pageContextMode: normalizePanelPageContextMode(settings.pageContextMode)
  };
  for (const [key, element] of Object.entries(fields)) {
    if (key === "ackSampling") {
      element.checked = hasContentAccessFeature() && displaySettings.pageContextMode !== "off";
    } else if (key === "plannerProvider") {
      element.value = allowInternalFakeProvider() && displaySettings[key] === "fake" ? "fake" : "gateway";
    } else if (element.type === "checkbox") {
      element.checked = Boolean(displaySettings[key]);
    } else if (displaySettings[key] !== undefined) {
      element.value = displaySettings[key];
    }
  }
  syncSettingSwitches();
  syncChoiceGroups();
}

function syncSettingSwitches() {
  for (const settingSwitch of settingSwitches) {
    const field = fields[settingSwitch.field];
    if (!settingSwitch.input || !field) continue;
    settingSwitch.input.checked = field.value === settingSwitch.onValue;
  }
}

function normalizePanelPageContextMode(value) {
  return value === "active_tab_only" ? "all_granted_origins" : value;
}

function allowInternalFakeProvider() {
  return Boolean(globalThis.__semanticTabAgentAllowFakeProvider);
}

async function persistSettings() {
  const settings = await sendMessage({ type: "settings:save", settings: readSettings() });
  writeSettings(settings);
  updateConditionalUi();
  setStatus("偏好已保存");
}

function updateConditionalUi() {
  const contentAccessAvailable = hasContentAccessFeature();
  nodes.appShell.dataset.contentAccess = contentAccessAvailable ? "on" : "off";
  const samplingEnabled = contentAccessAvailable && (fields.ackSampling.checked || fields.pageContextMode.value !== "off");
  const continuousEnabled = contentAccessAvailable && fields.continuousPageSummaries.checked;
  nodes.samplingRisk.hidden = !samplingEnabled;
  nodes.continuousSummaryRisk.hidden = !continuousEnabled;
  nodes.hostPermissionField.hidden =
    !samplingEnabled || fields.pageContextMode.value === "off";
  nodes.targetWindowField.hidden = fields.organizeMode.value !== "consolidate_one_window";
  nodes.gatewayCustomModelField.hidden = fields.gatewayModel.value !== GATEWAY_CUSTOM_MODEL_VALUE;
  syncChoiceGroups();
  schedulePageSamplingOriginRefresh();
}

function handleAnalyzeClick() {
  if (lastPreview) {
    resetToSetup();
    setStatus("AI 标签页整理");
    return;
  }
  analyze();
}

async function analyze() {
  setBusy(true, "正在准备整理", { cancelable: true, progress: 4 });
  try {
    const settings = readSettings();
    validateGatewaySettingsForAnalyze(settings);
    updateLocalProgress("正在检查权限", 8);
    await ensurePlannerHostPermission(settings);
    if (settings.pageContextMode !== "off" && settings.pageSamplingConsentMode !== "not_acknowledged") {
      updateLocalProgress("正在检查页面摘要权限", 12);
      await ensurePageSamplingPermissions(settings, { requestMissing: false });
      settings.hostPermissionRequestMode = "never";
    }
    updateLocalProgress("正在确认当前窗口", 14);
    const windowId = await resolveInvocationWindowId();
    updateLocalProgress("正在启动后台整理", 16);
    const started = await sendMessage({ type: "tabs:startAnalyze", settings, windowId });
    const job = await waitForAnalysisCompletion(started?.operationId);
    lastPreview = job.preview;
    lastCanApply = Boolean(job.validation?.ok);
    renderPreview(job);
    renderDetails(job);
    nodes.applyBtn.disabled = !lastCanApply;
    syncActionState();
    setStatus(job.validation?.ok ? "方案好了，可以先检查" : "方案需要检查", !job.validation?.ok);
  } catch (error) {
    if (isCancellationError(error)) {
      setStatus("已取消整理。");
    } else {
      setStatus(error.message, true);
      renderError(error);
    }
  } finally {
    stopProgressPolling();
    setBusy(false);
  }
}

function validateGatewaySettingsForAnalyze(settings) {
  if (settings.plannerProvider !== "gateway" || settings.gatewayModel !== GATEWAY_CUSTOM_MODEL_VALUE) return;
  if (!settings.gatewayBaseUrl.trim()) {
    throw new Error("自定义模型名需要先填写自定义 AI 网关地址。");
  }
  if (!settings.gatewayCustomModel.trim()) {
    throw new Error("请填写自定义模型名，或者选择一个预设模型。");
  }
}

function isCancellationError(error) {
  return /已取消整理/.test(String(error?.message || ""));
}

async function cancelAnalyze() {
  nodes.cancelBtn.disabled = true;
  setStatus("正在取消整理");
  try {
    const result = await sendMessage({ type: "tabs:cancelActiveJob" });
    if (result?.job) updateProgressFromJob(result.job);
    if (result?.job?.status === "canceled") {
      stopProgressPolling();
      setBusy(false);
      setStatus("已取消整理。");
    }
  } catch (error) {
    setStatus(error.message, true);
    nodes.cancelBtn.disabled = false;
  }
}

async function applyLastPlan() {
  if (lastPreview?.requiresConfirmation) {
    const confirmed = confirm("这会移动多个窗口里的标签页，并创建浏览器分组。确认开始整理吗？");
    if (!confirmed) return;
  }

  setBusy(true, "正在整理标签页");
  try {
    let result = await sendMessage({ type: "tabs:applyLastPlan" });
    if (result?.requiresChangedTabsConfirmation) {
      const confirmed = confirm(changedTabsConfirmationText(result.rebasedPlan));
      if (!confirmed) {
        setStatus("已取消整理");
        return;
      }
      setStatus("正在整理变化后的标签页");
      result = await sendMessage({ type: "tabs:applyLastPlan", confirmChangedTabs: true });
    }
    canUndo = true;
    setStatus(applyResultStatus(result));
    renderDetails({ applyResult: result });
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function changedTabsConfirmationText(summary = {}) {
  const newCount = (summary.skippedNewTabIds || summary.addedReviewTabIds || []).length;
  const removedCount = (summary.removedTabIds || []).length;
  const duplicateCount = (summary.duplicateTabIds || []).length;
  const reviewTitle = reviewGroupTitle(fields.languageMode.value);
  const lines = ["标签页在预览后发生了变化。"];

  if (newCount) {
    if (fields.reviewGroupMode.value === "create_review_group") {
      lines.push(`${newCount} 个新增标签页会放进「${reviewTitle}」。`);
    } else {
      lines.push(`${newCount} 个新增标签页会保持未分组。`);
    }
  }
  if (removedCount) lines.push(`${removedCount} 个已不存在的标签页会跳过。`);
  if (duplicateCount) lines.push(`${duplicateCount} 个重复引用会跳过。`);
  lines.push("确认继续整理吗？");
  return lines.join("\n");
}

function applyResultStatus(result) {
  const groupCount = result.createdGroupIds?.length || 0;
  const changedTabs = result.rebasedPlan?.changedTabsCount || 0;
  if (changedTabs) {
    const reviewCount = result.rebasedPlan?.addedReviewTabIds?.length || 0;
    const reviewText = reviewCount ? `，${reviewCount} 个放进「${reviewGroupTitle(fields.languageMode.value)}」` : "";
    return `已创建 ${groupCount} 个分组；已处理 ${changedTabs} 个变化标签页${reviewText}`;
  }
  return `已创建 ${groupCount} 个分组`;
}

async function undoLastApply() {
  setBusy(true, "正在撤销");
  try {
    const result = await sendMessage({ type: "tabs:undoLastApply" });
    canUndo = false;
    setStatus(`已恢复 ${result.restoredTabs || 0} 个标签页`);
    renderDetails({ undoResult: result });
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderPreview(job) {
  nodes.previewSection.hidden = false;
  const preview = job.preview;
  const languageMode = preview.languageMode || job.settings?.languageMode || fields.languageMode.value;
  const groups = preview.groups || [];
  const reviewTabsCount = preview.reviewTabsCount || 0;
  const reviewGroupWillBeCreated = Boolean(preview.reviewGroupWillBeCreated && reviewTabsCount);
  const visibleGroupCount = groups.length + (reviewGroupWillBeCreated ? 1 : 0);
  const groupedTabsCount = Number.isFinite(Number(preview.groupedTabsCount))
    ? Number(preview.groupedTabsCount)
    : groups.reduce((sum, group) => sum + (Number(group.tabCount) || 0), 0);
  const summaryPreview = {
    ...preview,
    groupedTabsCount,
    eligibleTabsCount: Number.isFinite(Number(preview.eligibleTabsCount))
      ? Number(preview.eligibleTabsCount)
      : groupedTabsCount + reviewTabsCount
  };

  if (!groups.length && !reviewTabsCount && !preview.lockedGroupsCount) {
    nodes.previewRoot.className = "empty";
    nodes.previewRoot.textContent = localizedText(languageMode, "没有可整理的标签页。", "No tabs to organize.");
    nodes.previewCount.textContent = localizedText(languageMode, "空", "Empty");
    return;
  }

  nodes.previewRoot.className = "preview-list";
  nodes.previewCount.textContent = localizedText(languageMode, `${visibleGroupCount} 组`, formatCount(visibleGroupCount, "group"));
  nodes.previewRoot.replaceChildren(
    previewSummary(summaryPreview, groups.length, reviewTabsCount, reviewGroupWillBeCreated, languageMode),
    ...groups.map((group, index) => groupRow(group, swatchForIndex(index), languageMode)),
    ...(reviewGroupWillBeCreated ? [reviewGroupRow(reviewTabsCount, languageMode, preview)] : [])
  );
}

function previewSummary(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, languageMode) {
  const summary = document.createElement("div");
  summary.className = "preview-summary";
  const main = document.createElement("span");
  main.textContent = previewSummaryText(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, languageMode);
  summary.append(main, pageSamplingLine(preview.pageSampling, languageMode), excludedTabsLine(preview, languageMode));
  return summary;
}

function previewSummaryText(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, languageMode) {
  const handledTabs = preview.eligibleTabsCount || (preview.groupedTabsCount || 0) + reviewTabsCount;
  const groupedTabs = preview.groupedTabsCount || 0;

  if (!handledTabs) {
    return localizedText(languageMode, "没有可整理的标签页。", "No tabs to organize.");
  }

  if (languageMode === "en-US") {
    const subjectText = groupCount ? `found ${formatCount(groupCount, "topic group")}` : "found no stable topic groups";
    const reviewText = reviewTabsCount
      ? reviewGroupWillBeCreated
        ? `, with ${formatCount(reviewTabsCount, "tab")} set aside for Needs Review`
        : `, with ${formatCount(reviewTabsCount, "tab")} left ungrouped`
      : "";

    if (!groupCount && reviewTabsCount) {
      return `AI reviewed ${formatCount(handledTabs, "tab")}, ${subjectText}${reviewText}.`;
    }

    return `AI reviewed ${formatCount(handledTabs, "tab")}, ${subjectText}; ${formatCount(groupedTabs, "tab")} will be grouped automatically${reviewText}.`;
  }

  const subjectText = groupCount ? `识别出 ${groupCount} 个主题` : "没有找到足够稳定的主题";
  const reviewText = reviewTabsCount
    ? reviewGroupWillBeCreated
      ? `，${reviewTabsCount} 个留到「${reviewGroupTitle(languageMode)}」`
      : `，${reviewTabsCount} 个暂不归类`
    : "";

  if (!groupCount && reviewTabsCount) {
    return `AI 已梳理 ${handledTabs} 个标签页，${subjectText}${reviewText}。`;
  }

  return `AI 已梳理 ${handledTabs} 个标签页，${subjectText}；${groupedTabs} 个已自动归类${reviewText}。`;
}

function pageSamplingLine(pageSampling, languageMode) {
  const line = document.createElement("small");
  if (!pageSampling?.requested) return line;

  const missed = Math.max(0, (pageSampling.permissionRequired || 0) + (pageSampling.blocked || 0));
  line.textContent =
    languageMode === "en-US"
      ? missed
        ? `Page summaries were read for ${pageSampling.ok}/${pageSampling.requested} tabs; ${missed} used only title and URL signals.`
        : `Page summaries were read for ${pageSampling.ok}/${pageSampling.requested} tabs.`
      : missed
        ? `页面摘要读到 ${pageSampling.ok}/${pageSampling.requested} 个标签页；${missed} 个只参考标题和网址。`
        : `页面摘要读到 ${pageSampling.ok}/${pageSampling.requested} 个标签页。`;
  return line;
}

function excludedTabsLine(preview, languageMode) {
  const line = document.createElement("small");
  if (!preview?.excludedTabsCount) return line;
  line.textContent = localizedText(
    languageMode,
    `另有 ${preview.excludedTabsCount} 个固定、无痕或受限标签页未参与整理。`,
    `${preview.excludedTabsCount} pinned, incognito, or restricted tabs were not included.`
  );
  return line;
}

function groupRow(group, swatchColor, languageMode = "auto") {
  const row = document.createElement("div");
  row.className = "group-row";
  row.style.setProperty("--swatch", swatchColor);

  const swatch = document.createElement("div");
  swatch.className = "group-swatch";

  const body = document.createElement("div");
  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = group.title;
  const meta = document.createElement("div");
  meta.className = "group-meta";
  meta.textContent = group.reason || group.groupKey;
  body.append(title, meta);

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = localizedText(languageMode, `${group.tabCount} 个`, formatCount(group.tabCount, "tab"));

  row.append(swatch, body, badge);
  return row;
}

function formatCount(count, noun) {
  const numeric = Number(count) || 0;
  return `${numeric} ${noun}${numeric === 1 ? "" : "s"}`;
}

function reviewGroupRow(tabCount, languageMode, preview) {
  return groupRow(
    {
      title: preview.reviewGroupTitle || reviewGroupTitle(languageMode),
      reason: preview.reviewGroupReason || reviewGroupReason(languageMode),
      tabCount
    },
    "var(--muted)",
    languageMode
  );
}

function swatchForIndex(index) {
  return ["var(--group-a)", "var(--group-b)", "var(--group-c)", "var(--group-d)", "var(--group-e)", "var(--group-f)"][
    index % 6
  ];
}

function renderDetails(payload) {
  nodes.detailsRoot.hidden = false;
  nodes.detailsText.textContent = JSON.stringify(payload, replacerForDetails, 2);
}

function renderError(error) {
  nodes.previewSection.hidden = false;
  nodes.detailsRoot.hidden = false;
  nodes.previewCount.textContent = "出错";
  nodes.detailsText.textContent = JSON.stringify({ error: error.message }, null, 2);
}

function resetToSetup() {
  lastPreview = null;
  lastCanApply = false;
  nodes.previewSection.hidden = true;
  nodes.previewCount.textContent = "待生成";
  nodes.previewRoot.className = "empty";
  nodes.previewRoot.textContent = "还没有方案。";
  nodes.detailsRoot.hidden = true;
  nodes.detailsText.textContent = "";
  syncActionState();
}

function replacerForDetails(key, value) {
  if (key === "gatewayApiKey") return "";
  if (key === "inventory" && value?.tabs) {
    return {
      ...value,
      tabs: `${value.tabs.length} tab(s)`,
      plannerTabs: `${value.plannerTabs?.length || 0} planner tab(s)`,
      excludedTabs: `${value.excludedTabs?.length || 0} excluded tab(s)`
    };
  }
  return value;
}

function setBusy(isBusy, label = "", options = {}) {
  nodes.analyzeBtn.disabled = isBusy;
  nodes.undoBtn.disabled = isBusy;
  nodes.applyBtn.disabled = isBusy || !lastPreview || !lastCanApply;
  nodes.cancelBtn.hidden = !(isBusy && options.cancelable);
  nodes.cancelBtn.disabled = false;
  nodes.actions.dataset.busy = isBusy ? "true" : "false";
  nodes.progressBar.hidden = !isBusy;
  showProgress(isBusy ? options.progress || 8 : 0);
  if (isBusy && label) {
    setStatus(label);
    setProgressLabel(label);
  }
  syncActionState();
}

async function hydrateActiveJob() {
  const job = await sendMessage({ type: "tabs:getActiveJob" }).catch(() => null);
  if (!job) return;
  if (isLiveJob(job)) {
    updateProgressFromJob(job);
    setBusy(true, job.message || "正在整理", { cancelable: true, progress: job.progress || 8 });
    startProgressPolling();
  } else if (job.status === "error" || job.status === "canceled") {
    setStatus(job.status === "error" ? "上次生成失败，请重新生成" : "上次整理已取消", job.status === "error");
  }
}

function startProgressPolling() {
  stopProgressPolling();
  pollActiveJob();
  progressPollTimer = setInterval(pollActiveJob, ACTIVE_JOB_POLL_MS);
}

function stopProgressPolling() {
  if (!progressPollTimer) return;
  clearInterval(progressPollTimer);
  progressPollTimer = null;
}

async function pollActiveJob() {
  try {
    const job = await sendMessage({ type: "tabs:getActiveJob" });
    updateProgressFromJob(job);
    if (!isLiveJob(job)) stopProgressPolling();
  } catch {
    stopProgressPolling();
  }
}

async function waitForAnalysisCompletion(operationId) {
  while (true) {
    const activeJob = await sendMessage({ type: "tabs:getActiveJob" });
    updateProgressFromJob(activeJob);

    if (!activeJob) {
      throw new Error("后台整理任务没有启动，请重试。");
    }
    if (operationId && activeJob.operationId && activeJob.operationId !== operationId) {
      throw new Error("后台已有另一个整理任务，请先取消或等待它完成。");
    }
    if (activeJob.status === "complete") {
      const job = await sendMessage({ type: "tabs:getLastJob" });
      if (!job?.preview) throw new Error("方案已生成，但预览数据没有保存成功。");
      return job;
    }
    if (activeJob.status === "error" || activeJob.status === "canceled") {
      throw new Error(activeJob.message || "整理没有完成。");
    }

    await delay(ACTIVE_JOB_POLL_MS);
  }
}

function updateProgressFromJob(job) {
  if (!job) return;
  requestGeneratedProgressCopy(job);
  if (typeof job.progress === "number") {
    nodes.progressBar.hidden = false;
    showProgress(displayProgressForJob(job));
  }
  if (job.message) {
    const message = displayMessageForJob(job);
    setStatus(message, job.status === "error");
    setProgressLabel(message);
  }
  if (job.status === "canceling") {
    nodes.cancelBtn.hidden = false;
    nodes.cancelBtn.disabled = true;
  }
  if (job.status === "canceled" || job.status === "error" || job.status === "complete") {
    nodes.cancelBtn.hidden = true;
  }
}

function showProgress(value) {
  const progress = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
  nodes.progressFill.style.width = `${progress}%`;
  nodes.progressPercent.textContent = `${Math.round(progress)}%`;
}

function setProgressLabel(text) {
  if (nodes.progressLabel) nodes.progressLabel.textContent = text;
}

function updateLocalProgress(label, progress) {
  nodes.progressBar.hidden = false;
  showProgress(progress);
  setProgressLabel(label);
  setStatus(label);
}

function displayProgressForJob(job) {
  const baseProgress = clampProgress(job.progress);
  if (!isLiveAiWait(job)) return baseProgress;

  const cap = optimisticProgressCap(job, baseProgress);
  const elapsedMs = elapsedSinceJobUpdate(job);
  const ramp = 1 - Math.exp(-elapsedMs / AI_WAIT_RAMP_MS);
  return Math.max(baseProgress, Math.min(cap, Math.round(baseProgress + (cap - baseProgress) * ramp)));
}

function displayMessageForJob(job) {
  if (!isLiveAiWait(job)) return job.message;
  const elapsedSeconds = Math.floor(elapsedSinceJobUpdate(job) / 1000);
  if (elapsedSeconds < 3) return job.message;
  return `${aiWaitCopy(job, elapsedSeconds)} · ${formatElapsedSeconds(elapsedSeconds)}`;
}

function optimisticProgressCap(job, baseProgress) {
  if (job.phase === "coarse_planning") return Math.max(baseProgress, 54);
  if (job.phase === "refining") return Math.max(baseProgress, Math.min(85, baseProgress + 12));
  if (job.phase === "retrying") return Math.max(baseProgress, 93);
  return Math.max(baseProgress, 80);
}

function elapsedSinceJobUpdate(job) {
  const startedAt = Date.parse(job.updatedAt || job.createdAt || "");
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Date.now() - startedAt);
}

function clampProgress(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
}

function isLiveAiWait(job) {
  return isLiveJob(job) && AI_WAIT_PHASES.has(job.phase);
}

function aiWaitCopy(job, elapsedSeconds) {
  const copies = generatedProgressCopyForJob(job) || AI_WAIT_COPY[job.phase] || AI_WAIT_COPY.planning;
  const index = Math.floor(elapsedSeconds / AI_WAIT_COPY_INTERVAL_SECONDS) % copies.length;
  return copies[index];
}

function requestGeneratedProgressCopy(job) {
  if (!isLiveAiWait(job)) return;
  const operationId = progressCopyOperationId(job);
  if (generatedCopyByOperation.has(operationId) || generatedCopyRequests.has(operationId)) return;

  generatedCopyRequests.add(operationId);
  sendMessage({
    type: "progressCopy:generate",
    operationId,
    phase: job.phase,
    tabCount: job.tabCount || 0,
    windowCount: job.windowCount || 0,
    languageMode: fields.languageMode.value
  })
    .then((result) => {
      const messages = Array.isArray(result?.messages) ? result.messages.filter(Boolean) : [];
      if (messages.length) rememberGeneratedProgressCopy(operationId, messages);
    })
    .catch(() => {})
    .finally(() => {
      generatedCopyRequests.delete(operationId);
    });
}

function generatedProgressCopyForJob(job) {
  return generatedCopyByOperation.get(progressCopyOperationId(job)) || null;
}

function progressCopyOperationId(job) {
  return job.operationId || `${job.phase || "planning"}:${job.createdAt || ""}`;
}

function rememberGeneratedProgressCopy(operationId, messages) {
  if (!generatedCopyByOperation.has(operationId) && generatedCopyByOperation.size >= GENERATED_COPY_CACHE_LIMIT) {
    const oldestKey = generatedCopyByOperation.keys().next().value;
    generatedCopyByOperation.delete(oldestKey);
  }
  generatedCopyByOperation.set(operationId, messages);
}

function formatElapsedSeconds(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}分${seconds}秒` : `${minutes}分`;
}

function isLiveJob(job) {
  return job?.status === "running" || job?.status === "canceling";
}

function setStatus(text, isError = false) {
  nodes.statusText.textContent = text;
  nodes.statusText.dataset.tone = isError ? "error" : "";
}

function syncChoiceGroups() {
  document.querySelectorAll("[data-choice-for]").forEach((group) => {
    const field = fields[group.dataset.choiceFor];
    if (!field) return;
    group.querySelectorAll("button[data-value]").forEach((button) => {
      const selected = button.dataset.value === field.value;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  });
}

function syncActionState() {
  nodes.appShell.dataset.flowState = lastPreview ? "preview" : "setup";
  nodes.actions.dataset.state = lastPreview ? "preview" : "idle";
  nodes.actions.dataset.canUndo = canUndo ? "true" : "false";
  nodes.applyBtn.hidden = !lastPreview;
  nodes.undoBtn.hidden = !canUndo;
  setButtonLabel(nodes.analyzeBtn, lastPreview ? "重新生成" : "生成方案");
  nodes.applyBtn.dataset.role = lastPreview && lastCanApply ? "primary" : "";
}

function setButtonLabel(button, text) {
  const label = button.querySelector(".button-label");
  if (label) {
    label.textContent = text;
  } else {
    button.textContent = text;
  }
}

async function ensurePlannerHostPermission(settings) {
  if (settings.plannerProvider !== "gateway") return;
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;

  const pattern = providerPermissionPattern(settings.gatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL);
  if (!pattern) return;

  const hasPermission = await chrome.permissions.contains({ origins: [pattern] });
  if (hasPermission) return;

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    throw new Error("需要授权这个 AI 服务地址，才能发送整理请求。");
  }
}

async function ensureContinuousSummaryPermissions() {
  if (!hasContentAccessFeature()) {
    throw new Error("当前构建不包含实验性页面摘要缓存。");
  }
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;

  await requireOptionalPermission(
    {
      permissions: ["scripting"],
      origins: ["https://*/*", "http://*/*"]
    },
    "需要授权网页读取权限后，才能持续积累页面摘要。"
  );
}

async function ensurePageSamplingPermissions(settings, options = {}) {
  if (settings.pageContextMode === "off" || settings.pageSamplingConsentMode === "not_acknowledged") return;
  if (!hasContentAccessFeature()) {
    throw new Error("当前构建不包含页面摘要功能。");
  }
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;
  const requestMissing = Boolean(options.requestMissing);

  const shouldRequestHostOrigins =
    settings.pageContextMode !== "active_tab_only" && settings.hostPermissionRequestMode !== "never";
  if (shouldRequestHostOrigins && !pageSamplingOriginCache.origins.length) {
    await refreshPageSamplingOriginCache();
  }
  const origins = shouldRequestHostOrigins ? pageSamplingOriginCache.origins : [];
  const missingPermissions = [];
  const hasScripting = await chrome.permissions.contains({ permissions: ["scripting"] });
  if (!hasScripting) missingPermissions.push("scripting");
  const missingOrigins = await getMissingOrigins(origins);

  if (!requestMissing) {
    if (missingPermissions.length) {
      throw new Error("需要先打开「参考页面短摘要」并完成授权，才能读取页面摘要。");
    }
    return;
  }

  if (settings.hostPermissionRequestMode === "ask_per_origin" && missingOrigins.length > 1) {
    const [firstOrigin, ...remainingOrigins] = missingOrigins;
    await requireOptionalPermission(
      {
        permissions: missingPermissions,
        origins: firstOrigin ? [firstOrigin] : []
      },
      "需要授权页面摘要权限，才能读取网页文字摘要。"
    );
    for (const origin of remainingOrigins) {
      await requireOptionalPermission({ origins: [origin] }, "需要授权页面摘要权限，才能读取网页文字摘要。");
    }
    return;
  }

  if (missingPermissions.length || missingOrigins.length) {
    await requireOptionalPermission(
      {
        permissions: missingPermissions,
        origins: missingOrigins
      },
      "需要授权页面摘要权限，才能读取网页文字摘要。"
    );
  }
}

function schedulePageSamplingOriginRefresh() {
  clearTimeout(pageSamplingOriginRefreshTimer);
  pageSamplingOriginRefreshTimer = setTimeout(() => {
    refreshPageSamplingOriginCache().catch(() => {
      pageSamplingOriginCache = { origins: [], refreshedAt: Date.now() };
      globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
    });
  }, 50);
}

function hasContentAccessFeature() {
  const manifest = globalThis.chrome?.runtime?.getManifest?.();
  if (!manifest) return true;
  return Boolean(
    (manifest.optional_permissions || []).includes("scripting") &&
      (manifest.optional_host_permissions || []).some((origin) => origin === "https://*/*" || origin === "http://*/*")
  );
}

async function refreshPageSamplingOriginCache() {
  if (!hasContentAccessFeature()) {
    pageSamplingOriginCache = { origins: [], refreshedAt: Date.now() };
    globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
    return;
  }
  const settings = readSettings();
  const shouldCollect =
    settings.pageContextMode !== "off" &&
    settings.pageSamplingConsentMode !== "not_acknowledged" &&
    settings.pageContextMode !== "active_tab_only" &&
    settings.hostPermissionRequestMode !== "never";
  const windowId = shouldCollect ? await resolveInvocationWindowId() : null;
  const origins = shouldCollect ? await collectPageSamplingOrigins(settings, windowId) : [];
  pageSamplingOriginCache = { origins, refreshedAt: Date.now() };
  globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
}

async function getMissingOrigins(origins) {
  const missing = [];
  for (const origin of origins) {
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (!hasPermission) missing.push(origin);
  }
  return missing;
}

async function requestOptionalPermission(request) {
  const permissionRequest = compactPermissionRequest(request);
  if (!permissionRequest) return true;

  const hasPermission = await chrome.permissions.contains(permissionRequest);
  if (hasPermission) return true;
  return chrome.permissions.request(permissionRequest);
}

async function requireOptionalPermission(request, errorMessage) {
  const granted = await requestOptionalPermission(request);
  if (!granted) {
    throw new Error(errorMessage || "需要授权后才能继续。");
  }
}

function compactPermissionRequest(request = {}) {
  const permissions = request.permissions?.filter(Boolean) || [];
  const origins = request.origins?.filter(Boolean) || [];
  if (!permissions.length && !origins.length) return null;
  return {
    ...(permissions.length ? { permissions } : {}),
    ...(origins.length ? { origins } : {})
  };
}

async function collectPageSamplingOrigins(settings, windowId) {
  const tabs = await collectVisibleTabs(settings, windowId);
  return [
    ...new Set(
      tabs
        .filter((tab) => isEligibleForPageSampling(tab, settings))
        .filter((tab) => settings.pageContextMode !== "ambiguous_with_permission" || isAmbiguousTab(tab))
        .map((tab) => hostPermissionPattern(tab.url || tab.pendingUrl || ""))
        .filter(Boolean)
    )
  ];
}

async function collectVisibleTabs(settings, windowId) {
  if (!globalThis.chrome?.windows) return [];
  if (settings.organizeMode === "consolidate_one_window") {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    return windows.flatMap((window) => window.tabs || []);
  }

  const targetWindow =
    Number.isInteger(windowId)
      ? await chrome.windows.get(windowId, { populate: true })
      : await chrome.windows.getCurrent({ populate: true });
  return targetWindow?.tabs || [];
}

function isEligibleForPageSampling(tab, settings) {
  if (!tab || typeof tab.id !== "number") return false;
  if (tab.pinned && !settings.includePinnedTabs) return false;
  if (tab.incognito && !settings.includeIncognitoTabs) return false;
  return Boolean(hostPermissionPattern(tab.url || tab.pendingUrl || ""));
}

function isAmbiguousTab(tab) {
  const title = String(tab.title || "").trim().toLowerCase();
  return !title || title.length < 18 || ["home", "new tab", "untitled", "login", "sign in"].some((term) => title.includes(term));
}

function providerPermissionPattern(baseUrl) {
  return hostPermissionPattern(baseUrl);
}

function hostPermissionPattern(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return "";
  }
}

async function sendMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return mockMessage(message);
  }

  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension request failed.");
  }
  return response.result;
}

async function resolveInvocationWindowId() {
  const sourceWindowId = sourceWindowIdFromUrl();
  if (Number.isInteger(sourceWindowId)) {
    if (!globalThis.chrome?.windows?.get) return sourceWindowId;
    const sourceWindow = await chrome.windows.get(sourceWindowId).catch(() => null);
    if (sourceWindow?.type === "normal") return sourceWindowId;
  }

  const activeTabWindowId = await lastFocusedActiveTabWindowId();
  if (Number.isInteger(activeTabWindowId)) return activeTabWindowId;

  if (!globalThis.chrome?.windows?.getCurrent) return null;
  try {
    if (globalThis.chrome?.windows?.getLastFocused) {
      const focusedNormalWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      if (Number.isInteger(focusedNormalWindow?.id)) return focusedNormalWindow.id;
    }
    const currentWindow = await chrome.windows.getCurrent();
    return currentWindow?.id ?? null;
  } catch {
    return null;
  }
}

async function lastFocusedActiveTabWindowId() {
  if (!globalThis.chrome?.tabs?.query) return null;
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (!Number.isInteger(activeTab?.windowId)) return null;
  if (!globalThis.chrome?.windows?.get) return activeTab.windowId;

  const window = await chrome.windows.get(activeTab.windowId).catch(() => null);
  return window?.type === "normal" ? activeTab.windowId : null;
}

function sourceWindowIdFromUrl() {
  try {
    const rawSourceWindowId = new URL(globalThis.location.href).searchParams.get("sourceWindowId");
    if (!rawSourceWindowId) return null;

    const sourceWindowId = Number(rawSourceWindowId);
    return Number.isInteger(sourceWindowId) && sourceWindowId > 0 ? sourceWindowId : null;
  } catch {
    return null;
  }
}

async function mockMessage(message) {
  if (message.type === "settings:get") {
    return {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "auto",
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayCustomModel: "",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
  }
  if (message.type === "settings:save") {
    return message.settings || {};
  }
  if (message.type === "tabs:startAnalyze") {
    mockLastJob = mockAnalysisJob();
    mockActiveJob = {
      operationId: "mock_job",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    return { operationId: mockActiveJob.operationId };
  }
  if (message.type === "tabs:analyze") {
    return mockAnalysisJob();
  }
  if (message.type === "tabs:getLastJob") return mockLastJob || mockAnalysisJob();
  if (message.type === "tabs:applyLastPlan") return { createdGroupIds: [1, 2] };
  if (message.type === "tabs:undoLastApply") return { restoredTabs: 20 };
  if (message.type === "tabs:getActiveJob") return mockActiveJob;
  if (message.type === "tabs:cancelActiveJob") return { canceled: false, job: mockActiveJob };
  throw new Error(`Mock does not implement ${message.type}`);
}

function mockAnalysisJob() {
  return {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [
          { title: "AI 研究", reason: "模型、论文和文档", tabCount: 12 },
          { title: "当前项目", reason: "Issue、PR 和本地应用", tabCount: 8 }
        ],
        totalTabsCount: 24,
        eligibleTabsCount: 23,
        windowCount: 1,
        groupedTabsCount: 20,
        reviewTabsCount: 3,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 1,
        lockedGroupsCount: 0,
        pageSampling: {
          requested: 3,
          ok: 2,
          permissionRequired: 1,
          blocked: 0
        },
        warnings: []
      }
  };
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
