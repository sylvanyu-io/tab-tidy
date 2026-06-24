import { getSettings, handleRuntimeMessage } from "../core/controller.js";
import { capturePageSummaryIfAllowed } from "../core/page-summary-cache.js";

const PANEL_PATH = "src/sidepanel/index.html";
const PANEL_WIDTH = 390;
const PANEL_HEIGHT = 680;
let panelWindowId = null;
const summaryCaptureTimers = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(chrome, message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

  return true;
});

chrome.action.onClicked.addListener((tab) => {
  openPanelWindow(tab?.windowId).catch((error) => console.error(error));
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === panelWindowId) panelWindowId = null;
});

chrome.tabs.onActivated?.addListener(({ tabId }) => {
  scheduleSummaryCapture(tabId);
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.active) {
    scheduleSummaryCapture(tabId);
  }
});

chrome.windows.onFocusChanged?.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
    if (tab?.id) scheduleSummaryCapture(tab.id);
  }).catch((error) => console.debug(error));
});

async function openPanelWindow(sourceWindowId = null) {
  const existingWindow = await findExistingPanelWindow();
  if (existingWindow) {
    await updatePanelTabSource(existingWindow, sourceWindowId);
    panelWindowId = existingWindow.id;
    await chrome.windows.update(existingWindow.id, {
      focused: true,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT
    });
    return existingWindow;
  }

  const created = await chrome.windows.create({
    url: panelUrl(sourceWindowId),
    type: "popup",
    focused: true,
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    ...(await panelPlacement())
  });
  panelWindowId = created.id;
  return created;
}

function scheduleSummaryCapture(tabId) {
  if (!Number.isInteger(tabId)) return;
  clearTimeout(summaryCaptureTimers.get(tabId));
  summaryCaptureTimers.set(
    tabId,
    setTimeout(() => {
      summaryCaptureTimers.delete(tabId);
      captureSummaryForTab(tabId).catch((error) => console.debug(error));
    }, 1200)
  );
}

async function captureSummaryForTab(tabId) {
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active) return;
  await capturePageSummaryIfAllowed(chrome, tab, settings);
}

async function findExistingPanelWindow() {
  if (Number.isInteger(panelWindowId)) {
    const existing = await chrome.windows.get(panelWindowId, { populate: true }).catch(() => null);
    if (isPanelWindow(existing)) return existing;
  }

  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
  return windows.find(isPanelWindow) || null;
}

function isPanelWindow(window) {
  return Boolean(window?.id && findPanelTab(window));
}

function findPanelTab(window) {
  return (window?.tabs || []).find((tab) => isPanelUrl(tab.url)) || null;
}

async function updatePanelTabSource(window, sourceWindowId) {
  const panelTab = findPanelTab(window);
  if (!panelTab?.id) return;

  const nextUrl = panelUrl(sourceWindowId);
  if (stripHash(panelTab.url) !== nextUrl) {
    await chrome.tabs.update(panelTab.id, { url: nextUrl });
  }
}

function panelUrl(sourceWindowId) {
  const url = new URL(chrome.runtime.getURL(PANEL_PATH));
  if (Number.isInteger(sourceWindowId)) {
    url.searchParams.set("sourceWindowId", String(sourceWindowId));
  }
  return url.toString();
}

function isPanelUrl(rawUrl) {
  try {
    const panel = new URL(chrome.runtime.getURL(PANEL_PATH));
    const url = new URL(rawUrl);
    return url.origin === panel.origin && url.pathname === panel.pathname;
  } catch {
    return false;
  }
}

function stripHash(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function panelPlacement() {
  const focused = await chrome.windows.getLastFocused().catch(() => null);
  if (!focused) return {};

  const left =
    Number.isFinite(focused.left) && Number.isFinite(focused.width)
      ? Math.max(0, Math.round(focused.left + focused.width - PANEL_WIDTH - 28))
      : undefined;
  const top = Number.isFinite(focused.top) ? Math.max(0, Math.round(focused.top + 72)) : undefined;

  return {
    ...(Number.isFinite(left) ? { left } : {}),
    ...(Number.isFinite(top) ? { top } : {})
  };
}
