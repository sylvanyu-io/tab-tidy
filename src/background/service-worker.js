import { getSettings, handleRuntimeMessage } from "../core/controller.js";
import { capturePageSummaryIfAllowed } from "../core/page-summary-cache.js";

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
