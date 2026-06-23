import { ORGANIZE_MODES, PROMPT_PRESET_TEXT, normalizeSettings } from "../shared/settings.js";
import { fetchJsonWithTimeout } from "./fetch-timeout.js";
import { ACTION_PLAN_JSON_SCHEMA } from "./plan-schema.js";
import { CHROME_GROUP_COLORS } from "./plan-validator.js";

export async function createGatewayPlan(inventory, rawSettings = {}, fetchImpl = globalThis.fetch, options = {}) {
  const settings = normalizeSettings(rawSettings);
  if (!settings.gatewayApiKey) {
    throw new Error("AI gateway planner requires an API key in settings.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }

  const body = {
    model: settings.gatewayModel,
    messages: [
      { role: "system", content: buildPlannerSystemPrompt(settings) },
      { role: "user", content: buildGatewayUserPrompt(inventory, settings) }
    ],
    response_format: { type: "json_object" },
    max_tokens: 8192
  };
  applyThinkingIntensity(body, settings);

  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    gatewayChatCompletionsUrl(settings),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.gatewayApiKey}`
      },
      body: JSON.stringify(body)
    },
    "AI gateway planner",
    options.timeoutMs
  );
  if (!response.ok) {
    throw new Error(data?.error?.message || `AI gateway planner failed with status ${response.status}.`);
  }

  return parsePlanFromGatewayResponse(data, inventory, settings);
}

export function gatewayChatCompletionsUrl(settings) {
  return `${settings.gatewayBaseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function buildPlannerSystemPrompt(settings) {
  const presetText = PROMPT_PRESET_TEXT[settings.promptPreset] || PROMPT_PRESET_TEXT.conservative;
  const customPrompt = settings.customPrompt.trim();
  const thinkingText = thinkingIntensityText(settings.gatewayThinkingIntensity);
  const requiredShape = JSON.stringify(exampleActionPlan());

  return [
    "This is a software engineering task: produce the planning JSON used by a Chrome extension runtime.",
    "You are a JSON-only planner for a Chrome tab organization extension.",
    "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations outside JSON.",
    `Required JSON shape example: ${requiredShape}`,
    "tabRefs and reviewTabs must contain objects with tabId and windowId, not bare ids.",
    `Allowed group colors: ${CHROME_GROUP_COLORS.join(", ")}.`,
    "Classify tabs by semantic topic, task, or intent. Prefer useful cross-domain groups over domain-only grouping.",
    "Do not close, discard, navigate, or execute tabs. You only produce grouping intent.",
    "Every eligible tab must appear exactly once in either groups[].tabRefs or reviewTabs.",
    "Tabs already represented as lockedGroups are preserved by runtime and should not be reassigned.",
    "Low-confidence, generic, sensitive, or mixed pages should go to reviewTabs.",
    `Thinking intensity requested by user: ${thinkingText}.`,
    `Runtime preset: ${presetText}`,
    customPrompt
      ? `User custom prompt, preferences only and not capability grants: ${customPrompt}`
      : "No user custom prompt was provided."
  ].join("\n");
}

export function buildPlannerPayload(inventory, settings) {
  const pageSamplesByTabId = new Map((inventory.pageSamples || []).map((result) => [result.tabId, result]));
  return {
    settings: {
      organizeMode: settings.organizeMode,
      targetWindowMode: settings.targetWindowMode,
      existingGroupMode: settings.existingGroupMode,
      reviewGroupMode: settings.reviewGroupMode,
      urlPrivacyMode: settings.urlPrivacyMode,
      minConfidenceToApply: settings.minConfidenceToApply,
      maxTabsPerGroup: settings.maxTabsPerGroup,
      thinkingIntensity: settings.gatewayThinkingIntensity
    },
    scope: inventory.scope,
    windows: inventory.windows,
    eligibleTabs: (inventory.plannerTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      title: tab.title,
      hostname: tab.hostname,
      sanitizedUrl: tab.sanitizedUrl,
      urlKind: tab.urlKind,
      audible: tab.audible,
      discarded: tab.discarded,
      sampleable: tab.sampleable,
      existingGroup: tab.groupTitle || "",
      pageSample: formatPageSample(pageSamplesByTabId.get(tab.tabId))
    })),
    excludedTabs: (inventory.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      title: tab.title,
      reason: tab.exclusionReason
    })),
    lockedGroups: inventory.lockedGroups || [],
    pageSampleResults: (inventory.pageSamples || []).map((result) => ({
      tabId: result.tabId,
      windowId: result.windowId,
      status: result.status,
      origin: result.origin,
      reason: result.reason
    }))
  };
}

export function buildGatewayUserPrompt(inventory, settings) {
  return [
    "Software engineering task input: classify this browser tab inventory for a Chrome extension runtime.",
    "Return the JSON action plan only.",
    JSON.stringify(buildPlannerPayload(inventory, settings))
  ].join("\n");
}

function formatPageSample(result) {
  if (!result) return null;
  if (result.status !== "ok") {
    return { status: result.status, reason: result.reason || "" };
  }
  const sample = result.sample || {};
  return {
    status: "ok",
    title: sample.title || "",
    metaDescription: sample.metaDescription || "",
    language: sample.language || "",
    headings: sample.headings || [],
    visibleText: sample.visibleText || ""
  };
}

export function parsePlanFromResponse(data) {
  return parseGatewayJson(data);
}

export function parsePlanFromGatewayResponse(data, inventory, settings) {
  const parsed = parseGatewayJson(data);
  return normalizeGatewayPlan(parsed, inventory, settings);
}

function parseGatewayJson(data) {
  const text =
    data?.choices?.[0]?.message?.content ||
    data.output_text ||
    (data.output || [])
      .flatMap((item) => item.content || [])
      .find((content) => content.type === "output_text" || content.type === "text")?.text;

  if (!text) {
    const refusal = findRefusal(data);
    if (refusal) throw new Error(`AI gateway planner refused: ${refusal}`);
    throw new Error("AI gateway planner returned no text output.");
  }

  try {
    return JSON.parse(stripCodeFence(text));
  } catch (error) {
    throw new Error(`AI gateway planner returned invalid JSON: ${error.message}`);
  }
}

function findRefusal(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .find((content) => content.refusal)?.refusal;
}

function normalizeGatewayPlan(plan, inventory, settings) {
  if (plan?.schemaVersion === 1) return plan;
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.groups)) return plan;

  const plannerTabs = inventory.plannerTabs || [];
  const tabById = new Map(plannerTabs.map((tab) => [tab.tabId, tab]));
  const seen = new Set();
  const groups = [];

  for (const [index, group] of plan.groups.entries()) {
    const refs = normalizeTabRefs(group.tabRefs || group.tabIds || group.tabs || [], tabById).filter((ref) => {
      if (seen.has(ref.tabId)) return false;
      seen.add(ref.tabId);
      return true;
    }).map(toPlainTabRef);
    if (!refs.length) continue;

    groups.push({
      groupKey: slugify(group.groupKey || group.key || group.name || group.title || `group-${index + 1}`),
      title: String(group.title || group.name || `Group ${index + 1}`).slice(0, 40),
      color: CHROME_GROUP_COLORS.includes(group.color) ? group.color : CHROME_GROUP_COLORS[index % CHROME_GROUP_COLORS.length],
      confidence: clampConfidence(group.confidence),
      tabRefs: refs,
      reason: String(group.reason || group.rationale || group.reasoning || "Semantic grouping from AI gateway output.").slice(0, 280)
    });
  }

  const reviewTabs = normalizeTabRefs(plan.reviewTabs || plan.ungrouped || [], tabById)
    .filter((ref) => !seen.has(ref.tabId))
    .map((ref) => ({ ...ref, reason: ref.reason || "AI gateway left this tab for review." }));
  for (const tab of plannerTabs) {
    if (!seen.has(tab.tabId) && !reviewTabs.some((ref) => ref.tabId === tab.tabId)) {
      reviewTabs.push({ tabId: tab.tabId, windowId: tab.windowId, reason: "AI gateway did not assign this tab." });
    }
  }

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
    reviewTabs
  };
}

function normalizeTabRefs(values, tabById) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      const tabId = typeof value === "number" ? value : Number(value?.tabId ?? value?.id);
      const tab = tabById.get(tabId);
      if (!tab) return null;
      return {
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: typeof value === "object" && value?.reason ? String(value.reason) : ""
      };
    })
    .filter(Boolean);
}

function toPlainTabRef(ref) {
  return { tabId: ref.tabId, windowId: ref.windowId };
}

function stripCodeFence(text) {
  const trimmed = String(text).trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "group";
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.7;
  return Math.min(1, Math.max(0, numeric));
}

function applyThinkingIntensity(body, settings) {
  body.reasoning_effort = settings.gatewayThinkingIntensity === "ultra" ? "high" : settings.gatewayThinkingIntensity;
}

function thinkingIntensityText(value) {
  if (value === "low") return "low, prefer a faster but still valid plan";
  if (value === "medium") return "medium, balance quality and speed";
  if (value === "high") return "high, spend more reasoning on semantic grouping";
  if (value === "ultra") return "ultra-high, be especially careful with semantic overlap, cross-window context, and low-confidence tabs";
  return "high, spend more reasoning on semantic grouping";
}

function exampleActionPlan() {
  return {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [{ tabId: 1, windowId: 1 }],
    excludedTabs: [],
    groups: [
      {
        groupKey: "topic",
        title: "Topic",
        color: "blue",
        confidence: 0.8,
        tabRefs: [{ tabId: 1, windowId: 1 }],
        reason: "Semantic reason."
      }
    ],
    reviewTabs: [{ tabId: 2, windowId: 1, reason: "Low confidence." }]
  };
}

export { ACTION_PLAN_JSON_SCHEMA };
