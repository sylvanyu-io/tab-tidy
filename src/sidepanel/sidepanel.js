const fields = {
  organizeMode: document.querySelector("#organizeMode"),
  existingGroupMode: document.querySelector("#existingGroupMode"),
  reviewGroupMode: document.querySelector("#reviewGroupMode"),
  urlPrivacyMode: document.querySelector("#urlPrivacyMode"),
  pageContextMode: document.querySelector("#pageContextMode"),
  promptPreset: document.querySelector("#promptPreset"),
  plannerProvider: document.querySelector("#plannerProvider"),
  openaiModel: document.querySelector("#openaiModel"),
  openaiApiKey: document.querySelector("#openaiApiKey"),
  deepseekModel: document.querySelector("#deepseekModel"),
  deepseekApiKey: document.querySelector("#deepseekApiKey"),
  customPrompt: document.querySelector("#customPrompt"),
  includePinnedTabs: document.querySelector("#includePinnedTabs"),
  collapseGroupsAfterApply: document.querySelector("#collapseGroupsAfterApply"),
  ackSampling: document.querySelector("#ackSampling")
};

const nodes = {
  statusText: document.querySelector("#statusText"),
  samplingRisk: document.querySelector("#samplingRisk"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  applyBtn: document.querySelector("#applyBtn"),
  undoBtn: document.querySelector("#undoBtn"),
  previewRoot: document.querySelector("#previewRoot")
};

let lastPreview = null;
let lastCanApply = false;

init().catch((error) => setStatus(error.message, true));

async function init() {
  bindEvents();

  const settings = await sendMessage({ type: "settings:get" });
  writeSettings(settings);
  updateRiskVisibility();
}

function bindEvents() {
  for (const element of Object.values(fields)) {
    element.addEventListener("change", persistSettings);
  }
  fields.customPrompt.addEventListener("input", debounce(persistSettings, 250));
  fields.pageContextMode.addEventListener("change", updateRiskVisibility);

  nodes.analyzeBtn.addEventListener("click", analyze);
  nodes.applyBtn.addEventListener("click", applyLastPlan);
  nodes.undoBtn.addEventListener("click", undoLastApply);
}

function readSettings() {
  const pageContextMode = fields.pageContextMode.value;
  return {
    organizeMode: fields.organizeMode.value,
    existingGroupMode: fields.existingGroupMode.value,
    reviewGroupMode: fields.reviewGroupMode.value,
    urlPrivacyMode: fields.urlPrivacyMode.value,
    pageContextMode,
    pageSamplingConsentMode:
      pageContextMode !== "off" && fields.ackSampling.checked
        ? "acknowledged_for_session"
        : "not_acknowledged",
    promptPreset: fields.promptPreset.value,
    plannerProvider: fields.plannerProvider.value,
    openaiModel: fields.openaiModel.value,
    openaiApiKey: fields.openaiApiKey.value,
    deepseekModel: fields.deepseekModel.value,
    deepseekApiKey: fields.deepseekApiKey.value,
    customPrompt: fields.customPrompt.value,
    includePinnedTabs: fields.includePinnedTabs.checked,
    collapseGroupsAfterApply: fields.collapseGroupsAfterApply.checked,
    targetWindowMode: fields.organizeMode.value === "consolidate_one_window" ? "new_window" : "current_window"
  };
}

function writeSettings(settings) {
  for (const [key, element] of Object.entries(fields)) {
    if (key === "ackSampling") {
      element.checked = settings.pageSamplingConsentMode === "acknowledged_for_session";
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
  updateRiskVisibility();
  setStatus("Settings saved");
}

function updateRiskVisibility() {
  nodes.samplingRisk.hidden = fields.pageContextMode.value === "off";
}

async function analyze() {
  setBusy(true);
  try {
    const windowId = await resolveInvocationWindowId();
    const job = await sendMessage({ type: "tabs:analyze", settings: readSettings(), windowId });
    lastPreview = job.preview;
    lastCanApply = Boolean(job.validation?.ok);
    renderPreview(job);
    nodes.applyBtn.disabled = !lastCanApply;
    setStatus(job.validation?.ok ? "Plan ready" : "Plan has validation errors", !job.validation?.ok);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function applyLastPlan() {
  if (lastPreview?.requiresConfirmation) {
    const confirmed = confirm("Move tabs across windows and create groups?");
    if (!confirmed) return;
  }

  setBusy(true);
  try {
    const result = await sendMessage({ type: "tabs:applyLastPlan" });
    setStatus(`Applied ${result.createdGroupIds?.length || 0} groups`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function undoLastApply() {
  setBusy(true);
  try {
    const result = await sendMessage({ type: "tabs:undoLastApply" });
    setStatus(`Undo restored ${result.restoredTabs || 0} tabs`);
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

  if (!groups.length && !preview.reviewTabsCount && !preview.lockedGroupsCount) {
    nodes.previewRoot.className = "empty";
    nodes.previewRoot.textContent = "No eligible tabs.";
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
      badge.textContent = `${group.tabCount} tabs`;

      row.append(body, badge);
      return row;
    }),
    summaryRow("Review", preview.reviewTabsCount || 0),
    summaryRow("Excluded", preview.excludedTabsCount || 0),
    summaryRow("Locked groups", preview.lockedGroupsCount || 0),
    summaryRow("Warnings", warnings.length)
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

function setBusy(isBusy) {
  nodes.analyzeBtn.disabled = isBusy;
  nodes.undoBtn.disabled = isBusy;
  nodes.applyBtn.disabled = isBusy || !lastPreview || !lastCanApply;
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
  if (message.type === "settings:get" || message.type === "settings:save") {
    return message.settings || {};
  }
  if (message.type === "tabs:analyze") {
    return {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [
          { title: "AI Research", reason: "Models, papers, and docs", tabCount: 12 },
          { title: "Project Work", reason: "Issues, PRs, and local app tabs", tabCount: 8 }
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
