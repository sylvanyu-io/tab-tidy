import {
  PAGE_CONTEXT_MODES,
  PAGE_SAMPLING_CONSENT_MODES,
  normalizeSettings
} from "../shared/settings.js";
import { canSampleUrl, getTabUrl } from "./url-sanitizer.js";

export async function requestPageSample(chromeApi, tab, rawSettings, reason = "") {
  const settings = normalizeSettings(rawSettings);
  const rawUrl = getTabUrl(tab);

  if (settings.pageContextMode === PAGE_CONTEXT_MODES.OFF) {
    return { status: "disabled", reason: "Page context is off." };
  }
  if (settings.pageSamplingConsentMode === PAGE_SAMPLING_CONSENT_MODES.NOT_ACKNOWLEDGED) {
    return { status: "blocked", reason: "Page sampling risk has not been acknowledged." };
  }
  if (!canSampleUrl(rawUrl)) {
    return { status: "unsupported_url", reason: "This URL scheme cannot be sampled." };
  }
  if (!chromeApi.scripting?.executeScript) {
    return { status: "blocked", reason: "The scripting permission is not available." };
  }

  if (settings.pageContextMode === PAGE_CONTEXT_MODES.ACTIVE_TAB_ONLY) {
    if (!tab.active) {
      return { status: "blocked", reason: "activeTab sampling is limited to the active tab." };
    }
    try {
      return {
        status: "ok",
        origin: new URL(rawUrl).origin + "/*",
        sample: await executePageSample(chromeApi, tab, reason)
      };
    } catch {
      return {
        status: "permission_required",
        origin: new URL(rawUrl).origin + "/*",
        reason: "Temporary activeTab access is not available for this tab."
      };
    }
  }

  const origin = new URL(rawUrl).origin + "/*";
  const hasPermission = await containsHostPermission(chromeApi, origin);
  if (!hasPermission) {
    return { status: "permission_required", origin, reason: "Host permission is required for page sampling." };
  }

  try {
    return { status: "ok", origin, sample: await executePageSample(chromeApi, tab, reason) };
  } catch (error) {
    return {
      status: "permission_required",
      origin,
      reason: executionPermissionReason(error)
    };
  }
}

async function containsHostPermission(chromeApi, origin) {
  if (await chromeApi.permissions.contains({ origins: [origin] })) return true;
  const broadOrigin = broadHostPattern(origin);
  return Boolean(broadOrigin && (await chromeApi.permissions.contains({ origins: [broadOrigin] })));
}

function broadHostPattern(origin) {
  if (origin.startsWith("https://")) return "https://*/*";
  if (origin.startsWith("http://")) return "http://*/*";
  return "";
}

async function executePageSample(chromeApi, tab, reason) {
  const [result] = await chromeApi.scripting.executeScript({
    target: { tabId: tab.id || tab.tabId },
    func: samplePage,
    args: [reason]
  });

  return result?.result || null;
}

function executionPermissionReason(error) {
  const message = String(error?.message || "");
  if (/cannot access contents|manifest must request permission|Cannot access a chrome/i.test(message)) {
    return "Chrome did not allow reading this page. Host permission may be missing, expired, or restricted for this page.";
  }
  return "Chrome did not allow reading this page.";
}

function samplePage(reason) {
  const metaDescription = document.querySelector('meta[name="description"]')?.content || "";
  const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || "";
  const headings = [...document.querySelectorAll("h1,h2")]
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12);
  const visibleText = document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 1800) || "";

  return {
    reason,
    title: document.title,
    metaDescription,
    canonicalUrl,
    language: document.documentElement.lang || "",
    headings,
    visibleText
  };
}
