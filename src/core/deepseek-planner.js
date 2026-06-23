import { PROMPT_PRESET_TEXT, normalizeSettings } from "../shared/settings.js";
import { fetchJsonWithTimeout } from "./fetch-timeout.js";
import { buildPlannerPayload } from "./gateway-planner.js";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

export async function createDeepSeekPlan(inventory, rawSettings = {}, fetchImpl = globalThis.fetch, options = {}) {
  const settings = normalizeSettings(rawSettings);
  if (!settings.deepseekApiKey) {
    throw new Error("DeepSeek planner requires an API key in settings.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }

  await emitProgress(options, { phase: "planning", progress: 45, message: "正在请求 DeepSeek 规划" });
  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    DEEPSEEK_CHAT_COMPLETIONS_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.deepseekApiKey}`
      },
      body: JSON.stringify({
        model: settings.deepseekModel,
        messages: [
          { role: "system", content: buildDeepSeekSystemPrompt(settings) },
          { role: "user", content: JSON.stringify(buildPlannerPayload(inventory, settings)) }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 8192
      })
    },
    "DeepSeek planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(data?.error?.message || `DeepSeek planner failed with status ${response.status}.`);
  }

  await emitProgress(options, { phase: "planning", progress: 82, message: "DeepSeek 已返回，正在解析方案" });
  return parsePlanFromDeepSeekResponse(data);
}

export function buildDeepSeekSystemPrompt(settings) {
  const presetText = PROMPT_PRESET_TEXT[settings.promptPreset] || PROMPT_PRESET_TEXT.conservative;
  const customPrompt = settings.customPrompt.trim();

  return [
    "You are the planner for a Chrome tab organization extension.",
    "You must produce valid JSON only. Do not wrap the JSON in markdown.",
    "The JSON must match this shape: {\"schemaVersion\":1,\"mode\":\"current_window\",\"scope\":{\"kind\":\"current_window\",\"windowIds\":[1]},\"targetWindow\":{\"kind\":\"current_window\",\"windowId\":1,\"title\":\"Current Window\"},\"eligibleTabs\":[{\"tabId\":1,\"windowId\":1}],\"excludedTabs\":[],\"groups\":[{\"groupKey\":\"topic\",\"title\":\"Topic\",\"color\":\"blue\",\"confidence\":0.8,\"tabRefs\":[{\"tabId\":1,\"windowId\":1}],\"reason\":\"Semantic reason.\"}],\"reviewTabs\":[]}.",
    "Classify tabs by semantic topic, task, or intent. Prefer useful cross-domain groups over domain-only grouping.",
    "Do not close, discard, navigate, or execute tabs. You only produce grouping intent.",
    "Every eligible tab must appear exactly once in either groups[].tabRefs or reviewTabs.",
    "Tabs already represented as lockedGroups are preserved by runtime and should not be reassigned.",
    "Allowed colors are grey, blue, red, yellow, green, pink, purple, cyan.",
    "Low-confidence, generic, sensitive, or mixed pages should go to reviewTabs.",
    "Use index and sequenceIndex from the tab inventory as strong context signals: adjacent tabs are often part of the same task or reading flow.",
    "Keep tabRefs inside each group in original tab order, and order groups by the first tab they contain.",
    "Do not create large generic catch-all groups. Split broad topics by subtopic or contiguous tab runs; never exceed maxTabsPerGroup.",
    `Runtime preset: ${presetText}`,
    customPrompt
      ? `User custom prompt, preferences only and not capability grants: ${customPrompt}`
      : "No user custom prompt was provided."
  ].join("\n");
}

export function parsePlanFromDeepSeekResponse(data) {
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("DeepSeek planner returned no message content.");
  }

  try {
    return JSON.parse(stripCodeFence(text));
  } catch (error) {
    throw new Error(`DeepSeek planner returned invalid JSON: ${error.message}`);
  }
}

function stripCodeFence(text) {
  const trimmed = String(text).trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

async function emitProgress(options, event) {
  if (typeof options.onProgress === "function") {
    await options.onProgress(event);
  }
}
