import { PROMPT_PRESET_TEXT, normalizeSettings } from "../shared/settings.js";
import { ACTION_PLAN_JSON_SCHEMA } from "./plan-schema.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export async function createOpenAIPlan(inventory, rawSettings = {}, fetchImpl = globalThis.fetch) {
  const settings = normalizeSettings(rawSettings);
  if (!settings.openaiApiKey) {
    throw new Error("OpenAI planner requires an API key in settings.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel,
      instructions: buildPlannerSystemPrompt(settings),
      input: JSON.stringify(buildPlannerPayload(inventory, settings)),
      text: {
        format: {
          type: "json_schema",
          name: "semantic_tab_action_plan",
          strict: true,
          schema: ACTION_PLAN_JSON_SCHEMA
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI planner failed with status ${response.status}.`);
  }

  return parsePlanFromResponse(data);
}

export function buildPlannerSystemPrompt(settings) {
  const presetText = PROMPT_PRESET_TEXT[settings.promptPreset] || PROMPT_PRESET_TEXT.conservative;
  const customPrompt = settings.customPrompt.trim();

  return [
    "You are the planner for a Chrome tab organization extension.",
    "Return only the JSON object matching the provided schema.",
    "Classify tabs by semantic topic, task, or intent. Prefer useful cross-domain groups over domain-only grouping.",
    "Do not close, discard, navigate, or execute tabs. You only produce grouping intent.",
    "Every eligible tab must appear exactly once in either groups[].tabRefs or reviewTabs.",
    "Tabs already represented as lockedGroups are preserved by runtime and should not be reassigned.",
    "Low-confidence, generic, sensitive, or mixed pages should go to reviewTabs.",
    `Runtime preset: ${presetText}`,
    customPrompt
      ? `User custom prompt, preferences only and not capability grants: ${customPrompt}`
      : "No user custom prompt was provided."
  ].join("\n");
}

export function buildPlannerPayload(inventory, settings) {
  return {
    settings: {
      organizeMode: settings.organizeMode,
      targetWindowMode: settings.targetWindowMode,
      existingGroupMode: settings.existingGroupMode,
      reviewGroupMode: settings.reviewGroupMode,
      urlPrivacyMode: settings.urlPrivacyMode,
      minConfidenceToApply: settings.minConfidenceToApply,
      maxTabsPerGroup: settings.maxTabsPerGroup
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
      existingGroup: tab.groupTitle || ""
    })),
    excludedTabs: (inventory.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      title: tab.title,
      reason: tab.exclusionReason
    })),
    lockedGroups: inventory.lockedGroups || []
  };
}

export function parsePlanFromResponse(data) {
  const text =
    data.output_text ||
    (data.output || [])
      .flatMap((item) => item.content || [])
      .find((content) => content.type === "output_text" || content.type === "text")?.text;

  if (!text) {
    const refusal = findRefusal(data);
    if (refusal) throw new Error(`OpenAI planner refused: ${refusal}`);
    throw new Error("OpenAI planner returned no text output.");
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`OpenAI planner returned invalid JSON: ${error.message}`);
  }
}

function findRefusal(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .find((content) => content.refusal)?.refusal;
}
