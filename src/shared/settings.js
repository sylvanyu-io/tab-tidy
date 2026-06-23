export const ORGANIZE_MODES = Object.freeze({
  CURRENT_WINDOW: "current_window",
  CONSOLIDATE_ONE_WINDOW: "consolidate_one_window"
});

export const TARGET_WINDOW_MODES = Object.freeze({
  NEW_WINDOW: "new_window",
  CURRENT_WINDOW: "current_window",
  SELECTED_WINDOW: "selected_window"
});

export const EXISTING_GROUP_MODES = Object.freeze({
  PRESERVE: "preserve_existing_groups",
  DISSOLVE: "dissolve_existing_groups"
});

export const REVIEW_GROUP_MODES = Object.freeze({
  CREATE: "create_review_group",
  LEAVE_UNGROUPED: "leave_review_ungrouped"
});

export const PAGE_CONTEXT_MODES = Object.freeze({
  OFF: "off",
  ACTIVE_TAB_ONLY: "active_tab_only",
  AMBIGUOUS_WITH_PERMISSION: "ambiguous_with_permission",
  ALL_GRANTED_ORIGINS: "all_granted_origins"
});

export const HOST_PERMISSION_REQUEST_MODES = Object.freeze({
  NEVER: "never",
  ASK_PER_ORIGIN: "ask_per_origin",
  ASK_FOR_ALL_VISIBLE_ORIGINS: "ask_for_all_visible_origins"
});

export const PAGE_SAMPLING_CONSENT_MODES = Object.freeze({
  NOT_ACKNOWLEDGED: "not_acknowledged",
  ACKNOWLEDGED_FOR_SESSION: "acknowledged_for_session",
  ACKNOWLEDGED_PERSISTENTLY: "acknowledged_persistently"
});

export const UNDO_TARGET_WINDOW_MODES = Object.freeze({
  LEAVE_EMPTY: "leave_empty_target_window",
  CLOSE_EMPTY_CREATED: "close_empty_created_target_window"
});

export const URL_PRIVACY_MODES = Object.freeze({
  TITLE_ONLY: "title_only",
  SANITIZED_URL: "sanitized_url",
  FULL_URL: "full_url"
});

export const PROMPT_PRESETS = Object.freeze({
  CONSERVATIVE: "conservative",
  RESEARCH: "research",
  PROJECT_WORK: "project_work",
  AGGRESSIVE_CLEANUP: "aggressive_cleanup"
});

export const PLANNER_PROVIDERS = Object.freeze({
  FAKE: "fake",
  GATEWAY: "gateway"
});

export const BUILTIN_GATEWAY_BASE_URL = "http://127.0.0.1:8317/v1";
export const BUILTIN_GATEWAY_PUBLIC_TOKEN = "7f1262f810e1074eaa51a1adc430cfae4c5a1b21d8807a78114658317bc1f91e";
export const DEFAULT_GATEWAY_BASE_URL = "";
const LEGACY_DEFAULT_GATEWAY_BASE_URLS = new Set([BUILTIN_GATEWAY_BASE_URL, "https://api.openai.com/v1"]);

export const GATEWAY_MODELS = Object.freeze(["gpt-5.5", "claude-opus-4-8", "claude-sonnet-4-6"]);

export const THINKING_INTENSITIES = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  ULTRA: "ultra"
});

export const PROMPT_PRESET_TEXT = Object.freeze({
  conservative:
    "Prefer fewer, clearer groups. Keep unknown or mixed pages in Review. Avoid merging tabs with weak semantic evidence.",
  research:
    "Group by research topic, paper/project, library, and question. Keep source material, notes, and implementation docs together.",
  project_work:
    "Group by active project or task. Keep issue trackers, PRs, docs, dashboards, and local app tabs together when they refer to the same workstream.",
  aggressive_cleanup:
    "Reduce clutter more aggressively and merge small related groups, while still placing low-confidence tabs in Review."
});

export const DEFAULT_SETTINGS = Object.freeze({
  organizeMode: ORGANIZE_MODES.CURRENT_WINDOW,
  targetWindowMode: TARGET_WINDOW_MODES.CURRENT_WINDOW,
  existingGroupMode: EXISTING_GROUP_MODES.PRESERVE,
  reviewGroupMode: REVIEW_GROUP_MODES.CREATE,
  pageContextMode: PAGE_CONTEXT_MODES.OFF,
  hostPermissionRequestMode: HOST_PERMISSION_REQUEST_MODES.NEVER,
  pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.NOT_ACKNOWLEDGED,
  urlPrivacyMode: URL_PRIVACY_MODES.SANITIZED_URL,
  includePinnedTabs: false,
  includeIncognitoTabs: false,
  collapseGroupsAfterApply: true,
  minConfidenceToApply: 0.65,
  maxTabsPerGroup: 40,
  undoTargetWindowMode: UNDO_TARGET_WINDOW_MODES.LEAVE_EMPTY,
  promptPreset: PROMPT_PRESETS.CONSERVATIVE,
  customPrompt: "",
  selectedTargetWindowId: null,
  plannerProvider: PLANNER_PROVIDERS.GATEWAY,
  rememberProviderKeys: false,
  gatewayBaseUrl: DEFAULT_GATEWAY_BASE_URL,
  gatewayModel: "gpt-5.5",
  gatewayThinkingIntensity: THINKING_INTENSITIES.HIGH,
  gatewayApiKey: ""
});

const enumValues = {
  organizeMode: Object.values(ORGANIZE_MODES),
  targetWindowMode: Object.values(TARGET_WINDOW_MODES),
  existingGroupMode: Object.values(EXISTING_GROUP_MODES),
  reviewGroupMode: Object.values(REVIEW_GROUP_MODES),
  pageContextMode: Object.values(PAGE_CONTEXT_MODES),
  hostPermissionRequestMode: Object.values(HOST_PERMISSION_REQUEST_MODES),
  pageSamplingConsentMode: Object.values(PAGE_SAMPLING_CONSENT_MODES),
  undoTargetWindowMode: Object.values(UNDO_TARGET_WINDOW_MODES),
  urlPrivacyMode: Object.values(URL_PRIVACY_MODES),
  promptPreset: Object.values(PROMPT_PRESETS),
  plannerProvider: Object.values(PLANNER_PROVIDERS),
  gatewayThinkingIntensity: Object.values(THINKING_INTENSITIES)
};

export function normalizeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(input || {}) };

  for (const [key, values] of Object.entries(enumValues)) {
    if (!values.includes(merged[key])) {
      merged[key] = DEFAULT_SETTINGS[key];
    }
  }

  merged.includePinnedTabs = Boolean(merged.includePinnedTabs);
  merged.includeIncognitoTabs = Boolean(merged.includeIncognitoTabs);
  merged.collapseGroupsAfterApply = Boolean(merged.collapseGroupsAfterApply);
  merged.rememberProviderKeys = Boolean(merged.rememberProviderKeys);
  merged.minConfidenceToApply = clampNumber(merged.minConfidenceToApply, 0, 1, DEFAULT_SETTINGS.minConfidenceToApply);
  merged.maxTabsPerGroup = Math.max(1, Number.parseInt(merged.maxTabsPerGroup, 10) || DEFAULT_SETTINGS.maxTabsPerGroup);
  merged.customPrompt = String(merged.customPrompt || "").slice(0, 4000);
  merged.gatewayBaseUrl = normalizeOptionalBaseUrl(merged.gatewayBaseUrl);
  merged.gatewayModel = normalizeGatewayModel(merged.gatewayModel);
  merged.gatewayApiKey = String(merged.gatewayApiKey || "").trim();
  if (!merged.gatewayBaseUrl) {
    merged.gatewayApiKey = "";
    merged.rememberProviderKeys = false;
  }
  const selectedTargetWindowId =
    merged.selectedTargetWindowId === null || merged.selectedTargetWindowId === ""
      ? null
      : Number(merged.selectedTargetWindowId);
  merged.selectedTargetWindowId = Number.isInteger(selectedTargetWindowId) ? selectedTargetWindowId : null;

  return merged;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeOptionalBaseUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  try {
    const url = new URL(rawValue);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    const normalized = url.toString().replace(/\/$/, "");
    return LEGACY_DEFAULT_GATEWAY_BASE_URLS.has(normalized) ? "" : normalized;
  } catch {
    return "";
  }
}

function normalizeGatewayModel(value) {
  const model = String(value || "").trim();
  return GATEWAY_MODELS.includes(model) ? model : DEFAULT_SETTINGS.gatewayModel;
}
