import { handleRuntimeMessage } from "../core/controller.js";

const PANEL_PATH = "src/sidepanel/index.html";
const PANEL_WIDTH = 390;
const PANEL_HEIGHT = 680;
let panelWindowId = null;

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
