import { getSettings, handleRuntimeMessage } from "../core/controller.js";
import { capturePageSummaryIfAllowed } from "../core/page-summary-cache.js";

const summaryCaptureTimers = new Map();
const SUMMARY_SWEEP_ALARM = "tabTidy.summarySweep";
const SUMMARY_SWEEP_PERIOD_MINUTES = 30;
const SUMMARY_CAPTURE_DELAY_MS = 1200;

configureSidePanel();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(chrome, message, sender)
    .then(async (result) => {
      if (message?.type === "settings:save") {
        await syncSummarySweepAlarm().catch((error) => console.debug(error));
        if (result?.continuousPageSummaries) {
          scheduleOpenTabSummarySweep();
        }
      }
      sendResponse({ ok: true, result });
    })
    .catch((error) => {
      console.warn(error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

  return true;
});

chrome.runtime.onInstalled?.addListener(() => {
  configureSidePanel();
  syncSummarySweepAlarm().catch((error) => console.debug(error));
  scheduleOpenTabSummarySweep();
});

chrome.runtime.onStartup?.addListener(() => {
  configureSidePanel();
  syncSummarySweepAlarm().catch((error) => console.debug(error));
  scheduleOpenTabSummarySweep();
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name === SUMMARY_SWEEP_ALARM) {
    scheduleOpenTabSummarySweep();
  }
});

chrome.tabs.onActivated?.addListener(({ tabId }) => {
  scheduleSummaryCapture(tabId);
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    scheduleSummaryCapture(tabId);
  }
});

chrome.windows.onFocusChanged?.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
    if (tab?.id) scheduleSummaryCapture(tab.id);
  }).catch((error) => console.debug(error));
});

function configureSidePanel() {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch((error) => console.debug(error));
}

function scheduleSummaryCapture(tabId) {
  if (!Number.isInteger(tabId)) return;
  clearTimeout(summaryCaptureTimers.get(tabId));
  summaryCaptureTimers.set(
    tabId,
    setTimeout(() => {
      summaryCaptureTimers.delete(tabId);
      captureSummaryForTab(tabId).catch((error) => console.debug(error));
    }, SUMMARY_CAPTURE_DELAY_MS)
  );
}

async function syncSummarySweepAlarm() {
  if (!chrome.alarms?.create) return;
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) {
    await chrome.alarms.clear?.(SUMMARY_SWEEP_ALARM);
    return;
  }
  await chrome.alarms.create(SUMMARY_SWEEP_ALARM, {
    periodInMinutes: SUMMARY_SWEEP_PERIOD_MINUTES,
    delayInMinutes: 1
  });
}

function scheduleOpenTabSummarySweep() {
  setTimeout(() => {
    sweepOpenTabsForSummaries().catch((error) => console.debug(error));
  }, SUMMARY_CAPTURE_DELAY_MS);
}

async function sweepOpenTabsForSummaries() {
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) return;
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }).catch(() => []);
  const tabs = windows.flatMap((window) => window.tabs || []);
  for (const tab of tabs) {
    if (tab?.id) await captureSummaryForTab(tab.id);
  }
}

async function captureSummaryForTab(tabId) {
  const settings = await getSettings(chrome);
  if (!settings.continuousPageSummaries) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  await capturePageSummaryIfAllowed(chrome, tab, settings);
}
