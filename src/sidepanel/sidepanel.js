const fields = {
  organizeMode: document.querySelector("#organizeMode"),
  targetWindowMode: document.querySelector("#targetWindowMode"),
  existingGroupMode: document.querySelector("#existingGroupMode"),
  reviewGroupMode: document.querySelector("#reviewGroupMode"),
  urlPrivacyMode: document.querySelector("#urlPrivacyMode"),
  pageContextMode: document.querySelector("#pageContextMode"),
  hostPermissionRequestMode: document.querySelector("#hostPermissionRequestMode"),
  promptPreset: document.querySelector("#promptPreset"),
  plannerProvider: document.querySelector("#plannerProvider"),
  rememberProviderKeys: document.querySelector("#rememberProviderKeys"),
  openaiModel: document.querySelector("#openaiModel"),
  openaiApiKey: document.querySelector("#openaiApiKey"),
  deepseekModel: document.querySelector("#deepseekModel"),
  deepseekApiKey: document.querySelector("#deepseekApiKey"),
  customPrompt: document.querySelector("#customPrompt"),
  includePinnedTabs: document.querySelector("#includePinnedTabs"),
  includeIncognitoTabs: document.querySelector("#includeIncognitoTabs"),
  collapseGroupsAfterApply: document.querySelector("#collapseGroupsAfterApply"),
  minConfidenceToApply: document.querySelector("#minConfidenceToApply"),
  maxTabsPerGroup: document.querySelector("#maxTabsPerGroup"),
  ackSampling: document.querySelector("#ackSampling")
};

const nodes = {
  statusText: document.querySelector("#statusText"),
  samplingRisk: document.querySelector("#samplingRisk"),
  hostPermissionField: document.querySelector("#hostPermissionField"),
  targetWindowField: document.querySelector("#targetWindowField"),
  openaiFields: document.querySelector("#openaiFields"),
  deepseekFields: document.querySelector("#deepseekFields"),
  rememberProviderKeysRow: document.querySelector("#rememberProviderKeysRow"),
  progressBar: document.querySelector("#progressBar"),
  progressFill: document.querySelector("#progressFill"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  applyBtn: document.querySelector("#applyBtn"),
  undoBtn: document.querySelector("#undoBtn"),
  previewRoot: document.querySelector("#previewRoot"),
  detailsRoot: document.querySelector("#detailsRoot"),
  detailsText: document.querySelector("#detailsText")
};

let lastPreview = null;
let lastCanApply = false;

init().catch((error) => setStatus(error.message, true));

async function init() {
  bindEvents();

  const settings = await sendMessage({ type: "settings:get" });
  writeSettings(settings);
  updateConditionalUi();
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
  nodes.applyBtn.addEventListener("click", applyLastPlan);
  nodes.undoBtn.addEventListener("click", undoLastApply);
}

function readSettings() {
  const pageContextMode = fields.pageContextMode.value;
  return {
    organizeMode: fields.organizeMode.value,
    existingGroupMode: fields.existingGroupMode.value,
    targetWindowMode:
      fields.organizeMode.value === "consolidate_one_window" ? fields.targetWindowMode.value : "current_window",
    reviewGroupMode: fields.reviewGroupMode.value,
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
    plannerProvider: fields.plannerProvider.value,
    rememberProviderKeys: fields.rememberProviderKeys.checked,
    openaiModel: fields.openaiModel.value,
    openaiApiKey: fields.openaiApiKey.value,
    deepseekModel: fields.deepseekModel.value,
    deepseekApiKey: fields.deepseekApiKey.value,
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
    } else if (element.type === "checkbox") {
      element.checked = Boolean(settings[key]);
    } else if (settings[key] !== undefined) {
      element.value = settings[key];
    }
  }
}

async function persistSettings() {
  const settings = await sendMessage({ type: "settings:save", settings: readSettings() });
  writeSettings(settings);
  updateConditionalUi();
  setStatus("Settings saved");
}

function updateConditionalUi() {
  const samplingEnabled = fields.ackSampling.checked || fields.pageContextMode.value !== "off";
  nodes.samplingRisk.hidden = !samplingEnabled;
  nodes.hostPermissionField.hidden =
    !samplingEnabled || fields.pageContextMode.value === "off" || fields.pageContextMode.value === "active_tab_only";
  nodes.targetWindowField.hidden = fields.organizeMode.value !== "consolidate_one_window";
  nodes.openaiFields.hidden = fields.plannerProvider.value !== "openai";
  nodes.deepseekFields.hidden = fields.plannerProvider.value !== "deepseek";
  nodes.rememberProviderKeysRow.hidden = fields.plannerProvider.value === "fake";
}

async function analyze() {
  setBusy(true, "正在生成方案");
  try {
    const windowId = await resolveInvocationWindowId();
    const job = await sendMessage({ type: "tabs:analyze", settings: readSettings(), windowId });
    lastPreview = job.preview;
    lastCanApply = Boolean(job.validation?.ok);
    renderPreview(job);
    renderDetails(job);
    nodes.applyBtn.disabled = !lastCanApply;
    setStatus(job.validation?.ok ? "方案已生成" : "方案需要检查", !job.validation?.ok);
  } catch (error) {
    setStatus(error.message, true);
    renderError(error);
  } finally {
    setBusy(false);
  }
}

async function applyLastPlan() {
  if (lastPreview?.requiresConfirmation) {
    const confirmed = confirm("这会移动多个窗口里的标签页，并创建浏览器分组。确认应用吗？");
    if (!confirmed) return;
  }

  setBusy(true, "正在应用");
  try {
    const result = await sendMessage({ type: "tabs:applyLastPlan" });
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
    setStatus(`已恢复 ${result.restoredTabs || 0} 个标签页`);
    renderDetails({ undoResult: result });
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderPreview(job) {
  const preview = job.preview;
  const groups = preview.groups || [];
  const warnings = preview.warnings || [];
  const sample = preview.pageSampling || { requested: 0, ok: 0, permissionRequired: 0, blocked: 0 };

  if (!groups.length && !preview.reviewTabsCount && !preview.lockedGroupsCount) {
    nodes.previewRoot.className = "empty";
    nodes.previewRoot.textContent = "没有可整理的标签页。";
    return;
  }

  nodes.previewRoot.className = "preview-list";
  nodes.previewRoot.replaceChildren(
    ...groups.map((group) => {
      const row = document.createElement("div");
      row.className = "group-row";

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

      row.append(body, badge);
      return row;
    }),
    summaryRow("待确认", preview.reviewTabsCount || 0),
    summaryRow("不会处理", preview.excludedTabsCount || 0),
    summaryRow("保留原分组", preview.lockedGroupsCount || 0),
    summaryRow("页面摘要", `${sample.ok}/${sample.requested}`),
    summaryRow("需要授权", sample.permissionRequired || 0),
    summaryRow("提醒", warnings.length)
  );
}

function summaryRow(label, count) {
  const row = document.createElement("div");
  row.className = "group-row";
  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = label;
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = String(count);
  row.append(title, badge);
  return row;
}

function renderDetails(payload) {
  nodes.detailsRoot.hidden = false;
  nodes.detailsText.textContent = JSON.stringify(payload, replacerForDetails, 2);
}

function renderError(error) {
  nodes.detailsRoot.hidden = false;
  nodes.detailsText.textContent = JSON.stringify({ error: error.message }, null, 2);
}

function replacerForDetails(key, value) {
  if (key === "openaiApiKey" || key === "deepseekApiKey") return "";
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

function setBusy(isBusy, label = "") {
  nodes.analyzeBtn.disabled = isBusy;
  nodes.undoBtn.disabled = isBusy;
  nodes.applyBtn.disabled = isBusy || !lastPreview || !lastCanApply;
  nodes.progressBar.hidden = !isBusy;
  nodes.progressFill.style.width = isBusy ? "65%" : "0";
  if (isBusy && label) setStatus(label);
}

function setStatus(text, isError = false) {
  nodes.statusText.textContent = text;
  nodes.statusText.style.color = isError ? "#b42318" : "";
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
  if (!globalThis.chrome?.windows?.getCurrent) return null;
  try {
    const currentWindow = await chrome.windows.getCurrent();
    return currentWindow?.id ?? null;
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
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 80,
      promptPreset: "conservative",
      plannerProvider: "fake",
      rememberProviderKeys: false,
      openaiModel: "gpt-5.5",
      openaiApiKey: "",
      deepseekModel: "deepseek-chat",
      deepseekApiKey: "",
      customPrompt: ""
    };
  }
  if (message.type === "settings:save") {
    return message.settings || {};
  }
  if (message.type === "tabs:analyze") {
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
  if (message.type === "tabs:applyLastPlan") return { createdGroupIds: [1, 2] };
  if (message.type === "tabs:undoLastApply") return { restoredTabs: 20 };
  throw new Error(`Mock does not implement ${message.type}`);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
