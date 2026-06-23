import { ORGANIZE_MODES, PROMPT_PRESET_TEXT, normalizeSettings } from "../shared/settings.js";

const GROUP_COLORS = ["blue", "green", "purple", "cyan", "yellow", "pink", "grey"];

const TOPIC_RULES = [
  {
    key: "project-work",
    title: "Project Work",
    color: "blue",
    confidence: 0.82,
    terms: ["github", "gitlab", "pull request", "pulls", "issue", "jira", "linear", "localhost", "vercel", "deploy"]
  },
  {
    key: "ai-research",
    title: "AI Research",
    color: "purple",
    confidence: 0.8,
    terms: ["openai", "anthropic", "llm", "gpt", "model", "prompt", "embedding", "arxiv", "paper", "agent"]
  },
  {
    key: "technical-docs",
    title: "Technical Docs",
    color: "cyan",
    confidence: 0.76,
    terms: ["docs", "documentation", "developer", "api", "reference", "mdn", "chrome", "typescript", "npm"]
  },
  {
    key: "reading",
    title: "Reading",
    color: "green",
    confidence: 0.72,
    terms: ["article", "blog", "news", "newsletter", "medium", "substack", "wikipedia"]
  },
  {
    key: "media",
    title: "Media",
    color: "pink",
    confidence: 0.74,
    terms: ["youtube", "bilibili", "video", "music", "podcast", "netflix"]
  },
  {
    key: "shopping-finance",
    title: "Shopping & Finance",
    color: "yellow",
    confidence: 0.7,
    terms: ["amazon", "shop", "cart", "bank", "invoice", "billing", "stripe", "paypal", "price"]
  }
];

export function createFakePlan(inventory, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const groupsByKey = new Map();
  const reviewTabs = [];
  const plannerTabs = inventory.plannerTabs || [];

  for (const tab of plannerTabs) {
    const match = classifyTab(tab, settings);
    if (!match || match.confidence < settings.minConfidenceToApply) {
      reviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: "Metadata is too generic for a confident semantic assignment."
      });
      continue;
    }

    if (!groupsByKey.has(match.key)) {
      groupsByKey.set(match.key, {
        groupKey: match.key,
        title: match.title,
        color: match.color,
        confidence: match.confidence,
        tabRefs: [],
        reason: match.reason
      });
    }
    groupsByKey.get(match.key).tabRefs.push({ tabId: tab.tabId, windowId: tab.windowId });
  }

  const groups = [...groupsByKey.values()]
    .map((group, index) => ({
      ...group,
      color: group.color || GROUP_COLORS[index % GROUP_COLORS.length]
    }))
    .sort((left, right) => right.tabRefs.length - left.tabRefs.length || left.title.localeCompare(right.title));

  return {
    schemaVersion: 1,
    mode: settings.organizeMode,
    scope:
      settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? { kind: "all_normal_windows", windowIds: inventory.scope.windowIds }
        : { kind: "current_window", windowIds: [inventory.scope.currentWindowId] },
    targetWindow:
      settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? { kind: settings.targetWindowMode, windowId: settings.selectedTargetWindowId, title: "AI Organized" }
        : { kind: "current_window", windowId: inventory.scope.currentWindowId },
    eligibleTabs: plannerTabs.map((tab) => ({ tabId: tab.tabId, windowId: tab.windowId })),
    excludedTabs: (inventory.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: tab.exclusionReason
    })),
    groups,
    reviewTabs,
    plannerNotes: {
      provider: "fake",
      promptPreset: settings.promptPreset,
      presetText: PROMPT_PRESET_TEXT[settings.promptPreset],
      customPromptUsed: Boolean(settings.customPrompt.trim())
    }
  };
}

function classifyTab(tab, settings) {
  const haystack = `${tab.title || ""} ${tab.hostname || ""} ${tab.sanitizedUrl || ""}`.toLowerCase();
  if (!haystack.trim()) return null;

  for (const rule of TOPIC_RULES) {
    if (rule.terms.some((term) => haystack.includes(term))) {
      return {
        key: rule.key,
        title: rule.title,
        color: rule.color,
        confidence: adjustConfidence(rule.confidence, settings, haystack),
        reason: `Matched semantic signals for ${rule.title.toLowerCase()}.`
      };
    }
  }

  if (looksGeneric(haystack)) return null;

  return {
    key: "general-workbench",
    title: "General Workbench",
    color: "grey",
    confidence: 0.66,
    reason: "Useful pages without a stronger shared topic."
  };
}

function adjustConfidence(base, settings, haystack) {
  let confidence = base;
  if (settings.promptPreset === "aggressive_cleanup") confidence += 0.05;
  if (settings.promptPreset === "research" && /paper|arxiv|docs|model|api/.test(haystack)) confidence += 0.04;
  if (settings.promptPreset === "project_work" && /github|jira|linear|localhost/.test(haystack)) confidence += 0.04;
  return Math.min(0.95, confidence);
}

function looksGeneric(haystack) {
  return ["new tab", "untitled", "home", "login", "sign in"].some((term) => haystack.includes(term));
}
