import { URL_PRIVACY_MODES } from "../shared/settings.js";

const LONG_OR_TOKENISH = /([A-Za-z0-9_-]{18,}|[0-9a-f]{12,})/i;
const EMAILISH = /[^/@\s]+@[^/@\s]+\.[^/@\s]+/;

export function getTabUrl(tab) {
  return tab?.pendingUrl || tab?.url || "";
}

export function sanitizeTabUrl(rawUrl, mode) {
  if (!rawUrl || mode === URL_PRIVACY_MODES.TITLE_ONLY) {
    return {
      urlKind: classifyUrl(rawUrl),
      hostname: "",
      sanitizedUrl: "",
      fullUrl: ""
    };
  }

  if (mode === URL_PRIVACY_MODES.FULL_URL) {
    return {
      urlKind: classifyUrl(rawUrl),
      hostname: safeHostname(rawUrl),
      sanitizedUrl: rawUrl,
      fullUrl: rawUrl
    };
  }

  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return {
        urlKind: classifyUrl(rawUrl),
        hostname: url.protocol.replace(":", ""),
        sanitizedUrl: `${url.protocol}//${url.hostname || ""}`,
        fullUrl: ""
      };
    }

    const pathTokens = url.pathname
      .split("/")
      .filter(Boolean)
      .map((token) => decodeURIComponentSafe(token))
      .filter((token) => token && !LONG_OR_TOKENISH.test(token) && !EMAILISH.test(token))
      .slice(0, 4);

    return {
      urlKind: "web",
      hostname: url.hostname,
      sanitizedUrl: `${url.protocol}//${url.hostname}${pathTokens.length ? `/${pathTokens.join("/")}` : ""}`,
      fullUrl: ""
    };
  } catch {
    return {
      urlKind: classifyUrl(rawUrl),
      hostname: "",
      sanitizedUrl: "",
      fullUrl: ""
    };
  }
}

export function canSampleUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function classifyUrl(rawUrl) {
  if (!rawUrl) return "unknown";
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "http:" || url.protocol === "https:") return "web";
    return url.protocol.replace(":", "") || "unknown";
  } catch {
    return "unknown";
  }
}

function safeHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
