const fields = {
  organizeMode: document.querySelector("#organizeMode"),
  targetWindowMode: document.querySelector("#targetWindowMode"),
  existingGroupMode: document.querySelector("#existingGroupMode"),
  reviewGroupMode: document.querySelector("#reviewGroupMode"),
  undoTargetWindowMode: document.querySelector("#undoTargetWindowMode"),
  urlPrivacyMode: document.querySelector("#urlPrivacyMode"),
  pageContextMode: document.querySelector("#pageContextMode"),
  hostPermissionRequestMode: document.querySelector("#hostPermissionRequestMode"),
  promptPreset: document.querySelector("#promptPreset"),
  plannerProvider: document.querySelector("#plannerProvider"),
  gatewayBaseUrl: document.querySelector("#gatewayBaseUrl"),
  gatewayModel: document.querySelector("#gatewayModel"),
  gatewayThinkingIntensity: document.querySelector("#gatewayThinkingIntensity"),
  gatewayApiKey: document.querySelector("#gatewayApiKey"),
  customPrompt: document.querySelector("#customPrompt"),
  includePinnedTabs: document.querySelector("#includePinnedTabs"),
  includeIncognitoTabs: document.querySelector("#includeIncognitoTabs"),
  collapseGroupsAfterApply: document.querySelector("#collapseGroupsAfterApply"),
  minConfidenceToApply: document.querySelector("#minConfidenceToApply"),
  maxTabsPerGroup: document.querySelector("#maxTabsPerGroup"),
  ackSampling: document.querySelector("#ackSampling")
};

const AI_WAIT_PHASES = new Set(["planning", "coarse_planning", "refining", "retrying"]);
const AI_WAIT_RAMP_MS = 45000;
const AI_WAIT_COPY_INTERVAL_SECONDS = 4;
const ACTIVE_JOB_POLL_MS = 600;
const AI_WAIT_COPY = Object.freeze({
  planning: ["理解标题线索", "寻找相邻任务", "避开域名硬分组", "检查待确认页", "整理分组边界"],
  coarse_planning: ["快速扫一遍", "寻找跨窗口主题", "切出候选大组", "标记模糊标签"],
  refining: ["拆开过大的组", "复核模糊边界", "合并同一任务", "保留原始顺序"],
  retrying: ["修正校验问题", "补齐遗漏标签", "移除重复分配", "重新检查结构"]
});

const nodes = {
  appShell: document.querySelector(".app-shell"),
  statusText: document.querySelector("#statusText"),
  samplingRisk: document.querySelector("#samplingRisk"),
  hostPermissionField: document.querySelector("#hostPermissionField"),
  targetWindowField: document.querySelector("#targetWindowField"),
  progressBar: document.querySelector("#progressBar"),
  progressFill: document.querySelector("#progressFill"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  settingsSummaryBtn: document.querySelector("#settingsSummaryBtn"),
  settingsSummaryText: document.querySelector("#settingsSummaryText"),
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
  detailsText: document.querySelector("#detailsText")
};

let lastPreview = null;
let lastCanApply = false;
let canUndo = false;
let isEditingSettings = false;
let pageSamplingOriginCache = { origins: [], refreshedAt: 0 };
let pageSamplingOriginRefreshTimer = null;
let progressPollTimer = null;
let mockActiveJob = null;
let mockLastJob = null;

init().catch((error) => setStatus(error.message, true));

async function init() {
  bindEvents();
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
    element.addEventListener("change", persistSettings);
  }
  fields.customPrompt.addEventListener("input", debounce(persistSettings, 250));
  fields.pageContextMode.addEventListener("change", updateConditionalUi);
  fields.organizeMode.addEventListener("change", updateConditionalUi);
  fields.plannerProvider.addEventListener("change", updateConditionalUi);

  nodes.analyzeBtn.addEventListener("click", analyze);
  nodes.cancelBtn.addEventListener("click", cancelAnalyze);
  nodes.applyBtn.addEventListener("click", applyLastPlan);
  nodes.undoBtn.addEventListener("click", undoLastApply);
  nodes.closeWindowBtn?.addEventListener("click", () => window.close());
  nodes.settingsSummaryBtn.addEventListener("click", () => {
    isEditingSettings = true;
    syncActionState();
  });
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

function readSettings() {
  const pageContextMode = fields.pageContextMode.value;
  return {
    organizeMode: fields.organizeMode.value,
    existingGroupMode: fields.existingGroupMode.value,
    targetWindowMode:
      fields.organizeMode.value === "consolidate_one_window" ? fields.targetWindowMode.value : "current_window",
    reviewGroupMode: fields.reviewGroupMode.value,
    undoTargetWindowMode: fields.undoTargetWindowMode.value,
    urlPrivacyMode: fields.urlPrivacyMode.value,
    pageContextMode:
      fields.ackSampling.checked && pageContextMode === "off"
        ? "active_tab_only"
        : fields.ackSampling.checked
          ? pageContextMode
          : "off",
    hostPermissionRequestMode: fields.hostPermissionRequestMode.value,
    pageSamplingConsentMode:
      fields.ackSampling.checked
        ? "acknowledged_for_session"
        : "not_acknowledged",
    promptPreset: fields.promptPreset.value,
    plannerProvider: fields.plannerProvider.value || "gateway",
    rememberProviderKeys: Boolean(fields.gatewayApiKey.value),
    gatewayBaseUrl: fields.gatewayBaseUrl.value,
    gatewayModel: fields.gatewayModel.value,
    gatewayThinkingIntensity: fields.gatewayThinkingIntensity.value,
    gatewayApiKey: fields.gatewayApiKey.value,
    customPrompt: fields.customPrompt.value,
    includePinnedTabs: fields.includePinnedTabs.checked,
    includeIncognitoTabs: fields.includeIncognitoTabs.checked,
    collapseGroupsAfterApply: fields.collapseGroupsAfterApply.checked,
    minConfidenceToApply: fields.minConfidenceToApply.value,
    maxTabsPerGroup: fields.maxTabsPerGroup.value
  };
}

function writeSettings(settings) {
  for (const [key, element] of Object.entries(fields)) {
    if (key === "ackSampling") {
      element.checked =
        settings.pageSamplingConsentMode === "acknowledged_for_session" || settings.pageContextMode !== "off";
    } else if (key === "plannerProvider") {
      element.value = allowInternalFakeProvider() && settings[key] === "fake" ? "fake" : "gateway";
    } else if (element.type === "checkbox") {
      element.checked = Boolean(settings[key]);
    } else if (settings[key] !== undefined) {
      element.value = settings[key];
    }
  }
  syncChoiceGroups();
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
  const samplingEnabled = fields.ackSampling.checked || fields.pageContextMode.value !== "off";
  nodes.samplingRisk.hidden = !samplingEnabled;
  nodes.hostPermissionField.hidden =
    !samplingEnabled || fields.pageContextMode.value === "off" || fields.pageContextMode.value === "active_tab_only";
  nodes.targetWindowField.hidden = fields.organizeMode.value !== "consolidate_one_window";
  syncChoiceGroups();
  schedulePageSamplingOriginRefresh();
}

async function analyze() {
  setBusy(true, "正在准备整理", { cancelable: true, progress: 4 });
  try {
    const settings = readSettings();
    updateLocalProgress("正在检查权限", 8);
    await ensurePlannerHostPermission(settings);
    if (settings.pageContextMode !== "off" && settings.pageSamplingConsentMode !== "not_acknowledged") {
      updateLocalProgress("正在检查页面摘要权限", 12);
    }
    await ensurePageSamplingPermissions(settings);
    updateLocalProgress("正在确认当前窗口", 14);
    const windowId = await resolveInvocationWindowId();
    updateLocalProgress("正在启动后台整理", 16);
    const started = await sendMessage({ type: "tabs:startAnalyze", settings, windowId });
    const job = await waitForAnalysisCompletion(started?.operationId);
    lastPreview = job.preview;
    lastCanApply = Boolean(job.validation?.ok);
    isEditingSettings = false;
    renderPreview(job);
    renderDetails(job);
    nodes.applyBtn.disabled = !lastCanApply;
    syncActionState();
    setStatus(job.validation?.ok ? "方案好了，可以先检查" : "方案需要检查", !job.validation?.ok);
  } catch (error) {
    setStatus(error.message, true);
    renderError(error);
  } finally {
    stopProgressPolling();
    setBusy(false);
  }
}

async function cancelAnalyze() {
  nodes.cancelBtn.disabled = true;
  setStatus("正在取消整理");
  try {
    await sendMessage({ type: "tabs:cancelActiveJob" });
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
    const result = await sendMessage({ type: "tabs:applyLastPlan" });
    canUndo = true;
    setStatus(`已创建 ${result.createdGroupIds?.length || 0} 个分组`);
    renderDetails({ applyResult: result });
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
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
  const groups = preview.groups || [];
  const reviewTabsCount = preview.reviewTabsCount || 0;

  if (!groups.length && !reviewTabsCount && !preview.lockedGroupsCount) {
    nodes.previewRoot.className = "empty";
    nodes.previewRoot.textContent = "没有可整理的标签页。";
    nodes.previewCount.textContent = "空";
    return;
  }

  nodes.previewRoot.className = "preview-list";
  nodes.previewCount.textContent = `${groups.length} 组`;
  nodes.previewRoot.replaceChildren(
    previewSummary(groups.length, reviewTabsCount),
    ...groups.map((group, index) => {
      const row = document.createElement("div");
      row.className = "group-row";
      row.style.setProperty("--swatch", swatchForIndex(index));

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
      badge.textContent = `${group.tabCount} 个`;

      row.append(swatch, body, badge);
      return row;
    })
  );
}

function previewSummary(groupCount, reviewTabsCount) {
  const summary = document.createElement("div");
  summary.className = "preview-summary";
  const groupText = groupCount ? `将创建 ${groupCount} 个分组` : "不会创建新分组";
  const reviewText = reviewTabsCount ? `，${reviewTabsCount} 个放到待确认` : "";
  summary.textContent = `${groupText}${reviewText}。`;
  return summary;
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
  nodes.progressBar.dataset.estimated = "";
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
  if (typeof job.progress === "number") {
    nodes.progressBar.hidden = false;
    nodes.progressBar.dataset.estimated = isLiveAiWait(job) ? "true" : "";
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
  nodes.progressBar.dataset.estimated = "";
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
  const copies = AI_WAIT_COPY[job.phase] || AI_WAIT_COPY.planning;
  const index = Math.floor(elapsedSeconds / AI_WAIT_COPY_INTERVAL_SECONDS) % copies.length;
  return copies[index];
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
  const compactPreview = Boolean(lastPreview && !isEditingSettings);
  nodes.appShell.dataset.flowState = compactPreview ? "preview" : "setup";
  nodes.settingsSummaryBtn.hidden = !compactPreview;
  nodes.settingsSummaryText.textContent = scopeLabel();
  nodes.actions.dataset.state = lastPreview ? "preview" : "idle";
  nodes.actions.dataset.canUndo = canUndo ? "true" : "false";
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

function scopeLabel() {
  return fields.organizeMode.value === "consolidate_one_window" ? "所有窗口" : "当前窗口";
}

async function ensurePlannerHostPermission(settings) {
  if (settings.plannerProvider !== "gateway") return;
  if (!settings.gatewayBaseUrl) return;
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;

  const pattern = providerPermissionPattern(settings.gatewayBaseUrl);
  if (!pattern) return;

  const hasPermission = await chrome.permissions.contains({ origins: [pattern] });
  if (hasPermission) return;

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    throw new Error("需要授权这个 AI 服务地址，才能发送整理请求。");
  }
}

async function ensurePageSamplingPermissions(settings) {
  if (settings.pageContextMode === "off" || settings.pageSamplingConsentMode === "not_acknowledged") return;
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;

  const shouldRequestHostOrigins =
    settings.pageContextMode !== "active_tab_only" && settings.hostPermissionRequestMode !== "never";
  const origins = shouldRequestHostOrigins ? pageSamplingOriginCache.origins : [];
  const missingPermissions = [];
  const hasScripting = await chrome.permissions.contains({ permissions: ["scripting"] });
  if (!hasScripting) missingPermissions.push("scripting");
  const missingOrigins = await getMissingOrigins(origins);

  if (settings.hostPermissionRequestMode === "ask_per_origin" && missingOrigins.length > 1) {
    const [firstOrigin, ...remainingOrigins] = missingOrigins;
    await requestOptionalPermission({
      permissions: missingPermissions,
      origins: firstOrigin ? [firstOrigin] : []
    });
    for (const origin of remainingOrigins) {
      await requestOptionalPermission({ origins: [origin] });
    }
    return;
  }

  if (missingPermissions.length || missingOrigins.length) {
    await requestOptionalPermission({
      permissions: missingPermissions,
      origins: missingOrigins
    });
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

async function refreshPageSamplingOriginCache() {
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
  const permissions = request.permissions?.filter(Boolean) || [];
  const origins = request.origins?.filter(Boolean) || [];
  if (!permissions.length && !origins.length) return true;

  const hasPermission = await chrome.permissions.contains({ permissions, origins });
  if (hasPermission) return true;
  return chrome.permissions.request({ permissions, origins });
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
  if (Number.isInteger(sourceWindowId)) return sourceWindowId;

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

function sourceWindowIdFromUrl() {
  try {
    const sourceWindowId = Number(new URL(globalThis.location.href).searchParams.get("sourceWindowId"));
    return Number.isInteger(sourceWindowId) ? sourceWindowId : null;
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
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
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
        reviewTabsCount: 3,
        excludedTabsCount: 1,
        lockedGroupsCount: 0,
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
