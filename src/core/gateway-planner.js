import {
  BUILTIN_GATEWAY_BASE_URL,
  GATEWAY_CUSTOM_MODEL_VALUE,
  ORGANIZE_MODES,
  PROMPT_PRESET_TEXT,
  REVIEW_GROUP_MODES,
  TARGET_WINDOW_MODES,
  THINKING_INTENSITIES,
  normalizeSettings,
  resolveGatewayModel
} from "../shared/settings.js";
import { languageInstruction, localizedText, targetWindowTitle } from "../shared/language.js";
import { fetchJsonWithTimeout } from "./fetch-timeout.js";
import { ACTION_PLAN_JSON_SCHEMA } from "./plan-schema.js";
import { CHROME_GROUP_COLORS } from "./plan-validator.js";

const HIERARCHICAL_MIN_TABS = 100;
const REFINE_BUCKET_MIN_TABS = 50;
const REFINE_MAX_TABS_PER_REQUEST = 80;
const REFINE_CONFIDENCE_BELOW = 0.78;
const COARSE_MAX_BUCKETS = 24;
const WINDOW_FIELDS = Object.freeze(["id", "type", "focused", "incognito", "tabCount"]);
const TAB_FIELDS = Object.freeze([
  "id",
  "windowId",
  "index",
  "sequenceIndex",
  "title",
  "hostname",
  "sanitizedUrl",
  "urlKind",
  "audible",
  "discarded",
  "sampleable",
  "existingGroup",
  "pageSample"
]);
const PAGE_SAMPLE_FIELDS = Object.freeze(["status", "title", "metaDescription", "language", "contentKind", "headings", "visibleText", "reason"]);
const EXCLUDED_FIELDS = Object.freeze(["id", "windowId", "reason"]);
const LOCKED_GROUP_FIELDS = Object.freeze(["id", "windowId", "title", "color", "collapsed", "tabIds"]);
const PAGE_SAMPLE_RESULT_FIELDS = Object.freeze(["id", "windowId", "status", "origin", "reason"]);

export async function createGatewayPlan(inventory, rawSettings = {}, fetchImpl = globalThis.fetch, options = {}) {
  const settings = normalizeSettings(rawSettings);
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }

  if (shouldUseHierarchicalPlanner(inventory, options)) {
    return createHierarchicalGatewayPlan(inventory, settings, fetchImpl, options);
  }

  return createSingleGatewayPlan(inventory, settings, fetchImpl, options);
}

export async function createGatewayCleanupAnalysis(inventory, activityOverview = {}, rawSettings = {}, fetchImpl = globalThis.fetch, options = {}) {
  const settings = normalizeSettings(rawSettings);
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }

  await emitProgress(options, { phase: "cleanup_planning", progress: 44, message: "正在整理清理建议" });
  const body = {
    model: requireGatewayModel(settings),
    messages: [
      { role: "system", content: buildCleanupSystemPrompt(settings) },
      { role: "user", content: buildCleanupUserPrompt(inventory, activityOverview, settings, options) }
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096
  };
  applyThinkingIntensity(body, settings);

  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    gatewayChatCompletionsUrl(settings),
    {
      method: "POST",
      headers: gatewayHeaders(settings, gatewayRequestMeta(inventory, options)),
      body: JSON.stringify(body)
    },
    "AI gateway cleanup planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(gatewayErrorMessage(response, data, settings));
  }

  await emitProgress(options, { phase: "cleanup_planning", progress: 82, message: "清理建议已生成" });
  return normalizeCleanupAnalysis(parseGatewayJson(data), inventory, activityOverview, settings);
}

async function createSingleGatewayPlan(inventory, settings, fetchImpl, options = {}) {
  if (!options.suppressSingleRequestProgress) {
    await emitProgress(options, { phase: "planning", progress: 45, message: "正在请求 AI 规划" });
  }
  const body = {
    model: requireGatewayModel(settings),
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
      headers: gatewayHeaders(settings, gatewayRequestMeta(inventory, options)),
      body: JSON.stringify(body)
    },
    "AI gateway planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(gatewayErrorMessage(response, data, settings));
  }

  if (!options.suppressSingleRequestProgress) {
    await emitProgress(options, { phase: "planning", progress: 82, message: "正在整理可执行方案" });
  }
  return parsePlanFromGatewayResponse(data, inventory, settings);
}

async function createHierarchicalGatewayPlan(inventory, settings, fetchImpl, options = {}) {
  await emitProgress(options, { phase: "coarse_planning", progress: 42, message: "正在快速粗分标签页" });
  const coarse = await createCoarseGatewayBuckets(inventory, settings, fetchImpl, options);
  await emitProgress(options, {
    phase: "coarse_planning",
    progress: 55,
    message: `已找到 ${coarse.buckets.length} 个主题方向`
  });
  const finalGroups = [];
  const finalReviewTabs = [];
  const seen = new Set();
  const refinementTotal = countRefinementRequests(coarse, settings, options);
  let refinementDone = 0;

  for (const bucket of coarse.buckets) {
    if (shouldRefineBucket(bucket, settings, options)) {
      await emitProgress(options, {
        phase: "refining",
        progress: refinementProgress(refinementDone, refinementTotal),
        message: `正在精分「${bucket.title}」`
      });
      const refined = await refineBucket(bucket, inventory, settings, fetchImpl, options);
      refinementDone += countBucketRefinementRequests(bucket, settings, options);
      await emitProgress(options, {
        phase: "refining",
        progress: refinementProgress(refinementDone, refinementTotal),
        message: `已精分「${bucket.title}」`
      });
      mergePlanParts(refined.groups, refined.reviewTabs, { finalGroups, finalReviewTabs, seen, settings });
    } else if (bucket.confidence >= settings.minConfidenceToApply) {
      mergePlanParts([bucketToGroup(bucket)], [], { finalGroups, finalReviewTabs, seen, settings });
    } else {
      mergePlanParts(
        [],
        bucket.tabRefs.map((ref) => ({
          ...ref,
          reason: localizedText(settings.languageMode, `粗分主题「${bucket.title}」置信度不足。`, `Low-confidence coarse bucket: ${bucket.title}.`)
        })),
        { finalGroups, finalReviewTabs, seen, settings }
      );
    }
  }

  if (coarse.reviewTabs.length) {
    const reviewBucket = {
      groupKey: "coarse-review",
      title: localizedText(settings.languageMode, "待分类", "Review"),
      color: "grey",
      confidence: 0.5,
      tabRefs: coarse.reviewTabs,
      reason: localizedText(settings.languageMode, "粗分阶段认为这些标签页仍不确定。", "Coarse pass left these tabs uncertain.")
    };
    await emitProgress(options, {
      phase: "refining",
      progress: refinementProgress(refinementDone, refinementTotal),
      message: "正在细分不确定标签页"
    });
    const refined = await refineBucket(reviewBucket, inventory, settings, fetchImpl, options);
    refinementDone += countBucketRefinementRequests(reviewBucket, settings, options);
    await emitProgress(options, {
      phase: "refining",
      progress: refinementProgress(refinementDone, refinementTotal),
      message: "不确定标签页已细分"
    });
    mergePlanParts(refined.groups, refined.reviewTabs, { finalGroups, finalReviewTabs, seen, settings });
  }

  for (const tab of inventory.plannerTabs || []) {
    if (!seen.has(tab.tabId)) {
      finalReviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: localizedText(settings.languageMode, "分层规划没有稳定归类这个标签页。", "Hierarchical planner did not assign this tab.")
      });
      seen.add(tab.tabId);
    }
  }

  await emitProgress(options, { phase: "building_plan", progress: 86, message: "正在合并精分结果" });
  return buildActionPlan(finalGroups, finalReviewTabs, inventory, settings);
}

export function gatewayChatCompletionsUrl(settings) {
  return `${effectiveGatewayBaseUrl(settings).replace(/\/+$/, "")}/chat/completions`;
}

export function effectiveGatewayBaseUrl(settings) {
  return settings.gatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL;
}

function requireGatewayModel(settings) {
  const model = resolveGatewayModel(settings);
  if (settings.gatewayModel === GATEWAY_CUSTOM_MODEL_VALUE && !settings.gatewayBaseUrl) {
    throw new Error(
      localizedText(
        settings.languageMode,
        "自定义模型名需要先填写自定义 AI 网关地址。",
        "A custom model name requires a custom AI gateway URL."
      )
    );
  }
  if (!model) {
    throw new Error(
      localizedText(
        settings.languageMode,
        "请填写自定义模型名，或者选择一个预设模型。",
        "Enter a custom model name or choose a preset model."
      )
    );
  }
  return model;
}

function gatewayHeaders(settings, requestMeta = {}) {
  const headers = { "content-type": "application/json" };
  if (settings.gatewayBaseUrl && settings.gatewayApiKey) {
    headers.authorization = `Bearer ${settings.gatewayApiKey}`;
  }
  if (!settings.gatewayBaseUrl && requestMeta.installId) {
    headers["x-tab-tidy-install-id"] = requestMeta.installId;
  }
  if (!settings.gatewayBaseUrl && requestMeta.hasPageSamples) {
    headers["x-tab-tidy-page-summary"] = "1";
  }
  return headers;
}

function gatewayRequestMeta(inventory, options = {}) {
  return {
    installId: options.installId || "",
    hasPageSamples: (inventory.pageSamples || []).some((sample) => sample.status === "ok")
  };
}

function gatewayErrorMessage(response, data, settings) {
  const providerMessage = extractProviderErrorMessage(data);
  if (response.status === 401 || response.status === 403) {
    return settings.gatewayBaseUrl
      ? "AI 服务拒绝访问。请检查自定义网关地址和密钥。"
      : "默认 AI 服务拒绝访问。请稍后重试，或在更多选项里切换自定义网关。";
  }
  if (isGatewayInfrastructureError(response, providerMessage)) {
    return settings.gatewayBaseUrl
      ? "自定义 AI 网关暂时连不上。请检查网关地址、隧道或上游服务是否在线。"
      : "默认 AI 服务暂时不可用。请稍后再试，或在更多选项里临时切换自定义 AI 网关。";
  }
  if (settings.gatewayBaseUrl) {
    return providerMessage
      ? `自定义 AI 网关这次没有完成请求（${response.status}）。${providerMessage}`
      : `自定义 AI 网关这次没有完成请求（${response.status}）。请检查网关服务后重试。`;
  }
  return providerMessage
    ? "默认 AI 服务这次没有成功完成。请稍后再试，或在更多选项里临时切换自定义 AI 网关。"
    : "默认 AI 服务这次没有成功响应。请稍后再试，或在更多选项里临时切换自定义 AI 网关。";
}

function extractProviderErrorMessage(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.error === "string") return data.error.trim();
  if (typeof data.error?.message === "string") return data.error.message.trim();
  if (typeof data.message === "string") return data.message.trim();
  return "";
}

function isGatewayInfrastructureError(response, providerMessage) {
  const message = String(providerMessage || "");
  return (
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504 ||
    (response.status === 530 && /1033|cloudflare|argo|tunnel/i.test(message)) ||
    /cloudflare tunnel|argo tunnel|error code:\s*1033/i.test(message)
  );
}

export function buildPlannerSystemPrompt(settings) {
  const presetText = PROMPT_PRESET_TEXT[settings.promptPreset] || PROMPT_PRESET_TEXT.conservative;
  const customPrompt = settings.customPrompt.trim();
  const thinkingText = thinkingIntensityText(settings.gatewayThinkingIntensity);
  const requiredShape = JSON.stringify(exampleCompactPlan());

  return [
    "This is a software engineering task: produce the planning JSON used by a Chrome extension runtime.",
    "You are a JSON-only planner for a Chrome tab organization extension.",
    "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations outside JSON.",
    `Required compact JSON shape example: ${requiredShape}`,
    "The user payload is compact: field-name arrays define the meaning of each row. Do not ignore any field.",
    "Return compact output: groups[].ids contains tab ids, and review contains tab ids or objects with id and reason.",
    `Allowed group colors: ${CHROME_GROUP_COLORS.join(", ")}.`,
    "Classify tabs by semantic topic, task, or intent. Prefer useful cross-domain groups over domain-only grouping.",
    "Do not close, discard, navigate, or execute tabs. You only produce grouping intent.",
    "Every eligible tab must appear exactly once in either groups[].ids or review.",
    "Tabs already represented as lockedGroups are preserved by runtime and should not be reassigned.",
    reviewModeInstruction(settings),
    "Use sequenceIndex and index as strong context signals: adjacent tabs are often part of the same task or reading flow.",
    "Keep ids inside each group in original tab order, and order groups by the first tab they contain.",
    "Do not create large generic catch-all groups. Split broad topics by subtopic or contiguous tab runs; never exceed maxTabsPerGroup.",
    languageInstruction(settings.languageMode),
    `Thinking intensity requested by user: ${thinkingText}.`,
    `Runtime preset: ${presetText}`,
    customPrompt
      ? `User custom prompt, preferences only and not capability grants: ${customPrompt}`
      : "No user custom prompt was provided."
  ].join("\n");
}

function reviewModeInstruction(settings) {
  if (settings.reviewGroupMode === REVIEW_GROUP_MODES.LEAVE_UNGROUPED) {
    return "Do not use review for merely uncertain tabs. Assign every eligible tab to the closest useful topic group, even when confidence is imperfect. Use review only for truly unsafe or impossible-to-classify input.";
  }
  return "Low-confidence, generic, sensitive, or mixed pages should go to review.";
}

export function buildPlannerPayload(inventory, settings) {
  const pageSamplesByTabId = new Map((inventory.pageSamples || []).map((result) => [result.tabId, result]));
  return {
    schema: "tab_tidy_compact_v1",
    settings: {
      organizeMode: settings.organizeMode,
      targetWindowMode: settings.targetWindowMode,
      existingGroupMode: settings.existingGroupMode,
      reviewGroupMode: settings.reviewGroupMode,
      urlPrivacyMode: settings.urlPrivacyMode,
      languageMode: settings.languageMode,
      promptPreset: settings.promptPreset,
      minConfidenceToApply: settings.minConfidenceToApply,
      maxTabsPerGroup: settings.maxTabsPerGroup,
      thinkingIntensity: settings.gatewayThinkingIntensity
    },
    scope: inventory.scope,
    windowFields: WINDOW_FIELDS,
    windows: (inventory.windows || []).map((window) => [
      window.windowId,
      window.type,
      Boolean(window.focused),
      Boolean(window.incognito),
      window.tabCount
    ]),
    tabFields: TAB_FIELDS,
    tabs: (inventory.plannerTabs || []).map((tab) => [
      tab.tabId,
      tab.windowId,
      tab.index,
      tab.sequenceIndex,
      tab.title,
      tab.hostname,
      tab.sanitizedUrl,
      tab.urlKind,
      Boolean(tab.audible),
      Boolean(tab.discarded),
      Boolean(tab.sampleable),
      tab.groupTitle || "",
      formatPageSample(pageSamplesByTabId.get(tab.tabId))
    ]),
    pageSampleFields: PAGE_SAMPLE_FIELDS,
    excludedFields: EXCLUDED_FIELDS,
    excluded: (inventory.excludedTabs || []).map((tab) => [tab.tabId, tab.windowId, tab.exclusionReason]),
    lockedGroupFields: LOCKED_GROUP_FIELDS,
    lockedGroups: (inventory.lockedGroups || []).map((group) => [
      group.groupId,
      group.windowId,
      group.title,
      group.color,
      Boolean(group.collapsed),
      group.tabIds || []
    ]),
    pageSampleResultFields: PAGE_SAMPLE_RESULT_FIELDS,
    pageSampleResults: (inventory.pageSamples || []).map((result) => [
      result.tabId,
      result.windowId,
      result.status,
      result.origin,
      result.reason
    ])
  };
}

export function buildGatewayUserPrompt(inventory, settings) {
  return [
    "Software engineering task input: classify this browser tab inventory for a Chrome extension runtime.",
    "Return the JSON action plan only.",
    JSON.stringify(buildPlannerPayload(inventory, settings))
  ].join("\n");
}

export function buildCleanupSystemPrompt(settings) {
  const thinkingText = thinkingIntensityText(settings.gatewayThinkingIntensity);
  return [
    "This is a software engineering task: produce cleanup-review JSON used by a Chrome tab organization extension.",
    "You are a JSON-only cleanup planner for a Chrome tab organization extension.",
    "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations outside JSON.",
    "Required JSON shape: {\"summary\":\"short product-facing sentence\",\"candidates\":[{\"id\":1,\"priority\":\"high\",\"reason\":\"Why this is worth reviewing\",\"evidence\":[\"time signal\",\"group/content signal\"]}]}",
    "Do not close, discard, navigate, execute, or mutate tabs. You only rank tabs for the human to review.",
    "Every candidate id must come from the eligible browser tab inventory.",
    "Do not recommend pinned, incognito, excluded, locked, or unavailable tabs.",
    "Use tab age, last active time, active count, original order, current group, semantic group plan, titles, URLs, and page summaries when available.",
    "Prefer candidates that are likely stale, superseded, finished research, duplicate reading, old comparison notes, outdated search results, or weakly connected leftovers.",
    "Do not overfit to age alone. A very old but central reference can be low priority or omitted.",
    "Return at most 12 candidates, ordered from most worth reviewing to least.",
    languageInstruction(settings.languageMode),
    `Thinking intensity requested by user: ${thinkingText}.`
  ].join("\n");
}

export function buildCleanupPayload(inventory, activityOverview = {}, settings, options = {}) {
  const basePayload = buildPlannerPayload(inventory, settings);
  return {
    ...basePayload,
    schema: "tab_tidy_cleanup_compact_v1",
    task: "cleanup_review",
    cleanupInstructions: {
      actionLimit: 12,
      nonDestructive: true,
      humanMustDecide: true,
      outputFields: ["summary", "candidates[].id", "candidates[].priority", "candidates[].reason", "candidates[].evidence"]
    },
    activityFields: [
      "id",
      "windowId",
      "index",
      "firstSeenAt",
      "lastSeenAt",
      "ageDays",
      "idleDays",
      "activeCount",
      "currentGroup",
      "discarded",
      "summary"
    ],
    activity: cleanupActivityRows(activityOverview),
    semanticGroupFields: ["title", "reason", "tabIds"],
    semanticGroups: cleanupSemanticGroupRows(options.lastJob),
    recap: {
      rangeMs: activityOverview.rangeMs || null,
      trackedOpenTabs: activityOverview.openTabs?.tracked || 0,
      localEntries: activityOverview.cache?.entries || 0,
      sampledEntries: activityOverview.cache?.sampledEntries || 0,
      topTerms: (activityOverview.recap?.topTerms || []).slice(0, 8),
      topHosts: (activityOverview.recap?.topHosts || []).slice(0, 8)
    }
  };
}

export function buildCleanupUserPrompt(inventory, activityOverview, settings, options = {}) {
  return [
    "Software engineering task input: review this browser tab inventory and return cleanup candidates for Tab Tidy.",
    "This is still a browser tab inventory request; return cleanup-review JSON only.",
    JSON.stringify(buildCleanupPayload(inventory, activityOverview, settings, options))
  ].join("\n");
}

function cleanupActivityRows(activityOverview = {}) {
  return (activityOverview.openTabSignals || activityOverview.staleTabs || []).map((tab) => [
    tab.tabId,
    tab.windowId,
    tab.index,
    tab.firstSeenAt || "",
    tab.lastSeenAt || "",
    daysFromMs(tab.ageMs),
    daysFromMs(tab.idleMs),
    Number(tab.activeCount || 0),
    tab.currentGroupTitle || "",
    Boolean(tab.discarded),
    compactActivitySummary(tab.summary)
  ]);
}

function cleanupSemanticGroupRows(lastJob) {
  const planGroups = lastJob?.plan?.groups || [];
  const previewGroups = lastJob?.preview?.groups || [];
  const groups = planGroups.length
    ? planGroups.map((group, index) => ({
        ...group,
        title: previewGroups[index]?.title || group.title,
        reason: previewGroups[index]?.reason || group.reason
      }))
    : previewGroups;
  return groups.slice(0, 40).map((group) => [
    String(group.title || "").slice(0, 80),
    String(group.reason || "").slice(0, 180),
    (group.tabRefs || group.tabs || [])
      .map((ref) => Number(ref?.tabId ?? ref?.id))
      .filter(Number.isInteger)
      .slice(0, 80)
  ]);
}

function compactActivitySummary(summary = null) {
  if (!summary) return null;
  return [
    String(summary.title || "").slice(0, 120),
    String(summary.metaDescription || "").slice(0, 180),
    String(summary.contentKind || "").slice(0, 40),
    Array.isArray(summary.headings) ? summary.headings.slice(0, 3).map((heading) => String(heading || "").slice(0, 80)) : []
  ];
}

function normalizeCleanupAnalysis(parsed, inventory, activityOverview = {}, settings = {}) {
  const source = unwrapCleanupAnalysis(parsed);
  const tabById = new Map((inventory.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const activityById = new Map(
    [...(activityOverview.openTabSignals || []), ...(activityOverview.staleTabs || [])]
      .filter((tab) => Number.isInteger(tab?.tabId))
      .map((tab) => [tab.tabId, tab])
  );
  const seen = new Set();
  const rawCandidates = Array.isArray(source?.candidates)
    ? source.candidates
    : Array.isArray(source?.tabs)
    ? source.tabs
    : Array.isArray(source?.review)
    ? source.review
    : [];
  const candidates = [];

  for (const raw of rawCandidates) {
    const id = typeof raw === "number" ? raw : Number(raw?.id ?? raw?.tabId);
    const tab = tabById.get(id);
    if (!tab || seen.has(id)) continue;
    seen.add(id);
    const activity = activityById.get(id) || {};
    candidates.push({
      tabId: tab.tabId,
      windowId: tab.windowId,
      index: tab.index,
      sequenceIndex: tab.sequenceIndex,
      title: tab.title || activity.title || "",
      hostname: tab.hostname || activity.hostname || "",
      sanitizedUrl: tab.sanitizedUrl || activity.sanitizedUrl || "",
      currentGroupTitle: activity.currentGroupTitle || tab.groupTitle || "",
      currentGroupColor: activity.currentGroupColor || tab.groupColor || "",
      ageMs: Number(activity.ageMs || 0),
      idleMs: Number(activity.idleMs || 0),
      activeCount: Number(activity.activeCount || 0),
      discarded: Boolean(activity.discarded || tab.discarded),
      pinned: Boolean(tab.pinned),
      priority: normalizeCleanupPriority(raw?.priority),
      reason: String(
        raw?.reason ||
          raw?.rationale ||
          localizedText(settings.languageMode, "AI 建议优先复核这个标签页。", "AI suggests reviewing this tab first.")
      ).slice(0, 220),
      evidence: normalizeCleanupEvidence(raw?.evidence || raw?.signals || raw?.clues),
      summary: activity.summary || null
    });
    if (candidates.length >= 12) break;
  }

  return {
    schema: "tab_tidy_cleanup_v1",
    summary: String(
      source?.summary ||
        localizedText(
          settings.languageMode,
          `找到 ${candidates.length} 个可以先检查的标签页。`,
          `Found ${candidates.length} tabs worth reviewing first.`
        )
    ).slice(0, 220),
    candidates
  };
}

function unwrapCleanupAnalysis(value) {
  if (!value || typeof value !== "object") return {};
  return value.cleanup || value.cleanupPlan || value.result || value.data || value;
}

function normalizeCleanupPriority(value) {
  const normalized = String(value || "").toLowerCase();
  if (["high", "medium", "low"].includes(normalized)) return normalized;
  if (["urgent", "strong", "delete", "close"].includes(normalized)) return "high";
  return "medium";
}

function normalizeCleanupEvidence(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4).map((item) => item.slice(0, 120));
}

function daysFromMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round((numeric / (24 * 60 * 60 * 1000)) * 10) / 10;
}

async function createCoarseGatewayBuckets(inventory, settings, fetchImpl, options = {}) {
  const body = {
    model: requireGatewayModel(settings),
    messages: [
      { role: "system", content: buildCoarseSystemPrompt(settings, options) },
      { role: "user", content: buildCoarseUserPrompt(inventory, settings) }
    ],
    response_format: { type: "json_object" },
    max_tokens: 8192
  };
  applyThinkingIntensity(body, settings, THINKING_INTENSITIES.LOW);
  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    gatewayChatCompletionsUrl(settings),
    {
      method: "POST",
      headers: gatewayHeaders(settings, gatewayRequestMeta(inventory, options)),
      body: JSON.stringify(body)
    },
    "AI gateway coarse planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(gatewayErrorMessage(response, data, settings));
  }
  return normalizeCoarsePlan(parseGatewayJson(data), inventory, settings);
}

async function refineBucket(bucket, inventory, settings, fetchImpl, options = {}) {
  const maxTabsPerRequest = options.refineMaxTabsPerRequest || Math.min(settings.maxTabsPerGroup, REFINE_MAX_TABS_PER_REQUEST);
  if (bucket.tabRefs.length > maxTabsPerRequest) {
    const refinedParts = { groups: [], reviewTabs: [] };
    for (const [index, tabRefs] of chunkRefs(bucket.tabRefs, maxTabsPerRequest).entries()) {
      const refined = await refineBucket(
        {
          ...bucket,
          groupKey: `${bucket.groupKey}-part-${index + 1}`,
          title: `${bucket.title} ${index + 1}`,
          tabRefs,
          reason: `${bucket.reason} Split from an oversized coarse bucket.`
        },
        inventory,
        settings,
        fetchImpl,
        options
      );
      refinedParts.groups.push(...refined.groups);
      refinedParts.reviewTabs.push(...refined.reviewTabs);
    }
    return refinedParts;
  }

  const subInventory = subsetInventory(inventory, bucket.tabRefs);
  if (!(subInventory.plannerTabs || []).length) return { groups: [], reviewTabs: [] };

  const refineSettings = {
    ...settings,
    customPrompt: [
      settings.customPrompt,
      `Refine this coarse bucket: ${bucket.title}.`,
      `Coarse reason: ${bucket.reason}`,
      "This is a large-session refinement pass; use the configured thinking effort.",
      "Split it only when there are clearly different semantic tasks or topics.",
      "Keep uncertain or sensitive tabs in reviewTabs."
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000)
  };

  try {
    const plan = await createSingleGatewayPlan(subInventory, refineSettings, fetchImpl, {
      ...options,
      suppressSingleRequestProgress: true
    });
    return {
      groups: (plan.groups || []).map((group) => ({
        ...group,
        groupKey: `${bucket.groupKey}-${group.groupKey || slugify(group.title)}`.slice(0, 64)
      })),
      reviewTabs: plan.reviewTabs || []
    };
  } catch (error) {
    if (bucket.confidence >= settings.minConfidenceToApply) {
      return {
        groups: fallbackGroupsForBucket(bucket, settings, error),
        reviewTabs: []
      };
    }

    return {
      groups: [],
      reviewTabs: bucket.tabRefs.map((ref) => ({ ...ref, reason: `Refinement unavailable for uncertain bucket: ${error.message}` }))
    };
  }
}

function buildCoarseSystemPrompt(settings, options = {}) {
  const presetText = PROMPT_PRESET_TEXT[settings.promptPreset] || PROMPT_PRESET_TEXT.conservative;
  const maxBuckets = options.coarseMaxBuckets || COARSE_MAX_BUCKETS;
  return [
    "This is a fast first-pass software engineering task for a Chrome tab organization extension.",
    "Return exactly one compact JSON object. Do not include markdown or prose outside JSON.",
    "Shape: {\"buckets\":[{\"bucketKey\":\"topic\",\"title\":\"Topic\",\"color\":\"blue\",\"confidence\":0.8,\"tabIds\":[1],\"reason\":\"Short reason.\"}],\"reviewTabIds\":[2]}",
    "Use tabIds arrays, not full tab objects.",
    `Use at most ${maxBuckets} broad semantic buckets.`,
    `Allowed colors: ${CHROME_GROUP_COLORS.join(", ")}.`,
    "Prefer broad, useful semantic topics over domain-only grouping.",
    "This is a coarse pass: mixed or large buckets are acceptable because a second pass will refine them.",
    "Every eligible tab id must appear exactly once, either in buckets[].tabIds or reviewTabIds.",
    "Put generic, sensitive, or very uncertain tabs in reviewTabIds.",
    "Use sequenceIndex and index as ordering signals. Adjacent tabs often belong together.",
    "Do not create a broad catch-all bucket for unrelated leftovers; use reviewTabIds instead.",
    languageInstruction(settings.languageMode),
    `Runtime preset: ${presetText}`
  ].join("\n");
}

function buildCoarseUserPrompt(inventory, settings) {
  const payload = buildPlannerPayload(inventory, settings);
  return [
    "Software engineering task input: create broad semantic buckets for these browser tabs.",
    "Return compact coarse-bucket JSON only.",
    JSON.stringify({
      settings: payload.settings,
      scope: payload.scope,
      windowFields: payload.windowFields,
      windows: payload.windows,
      tabFields: payload.tabFields,
      tabs: payload.tabs,
      pageSampleFields: payload.pageSampleFields,
      lockedGroupFields: payload.lockedGroupFields,
      lockedGroups: payload.lockedGroups,
      pageSampleResultFields: payload.pageSampleResultFields,
      pageSampleResults: payload.pageSampleResults
    })
  ].join("\n");
}

function normalizeCoarsePlan(plan, inventory, settings) {
  const tabById = new Map((inventory.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const seen = new Set();
  const buckets = [];
  const sourceBuckets = Array.isArray(plan?.buckets) ? plan.buckets : Array.isArray(plan?.groups) ? plan.groups : [];

  for (const [index, bucket] of sourceBuckets.entries()) {
    const tabRefs = sortRefsByOriginalOrder(
      normalizeTabRefs(bucket.tabRefs || bucket.tabIds || bucket.tabs || [], tabById)
      .filter((ref) => {
        if (seen.has(ref.tabId)) return false;
        seen.add(ref.tabId);
        return true;
      }),
      inventory
    )
      .map(toPlainTabRef);
    if (!tabRefs.length) continue;

    buckets.push({
      groupKey: slugify(bucket.bucketKey || bucket.groupKey || bucket.key || bucket.title || bucket.name || `bucket-${index + 1}`),
      title: String(bucket.title || bucket.name || localizedText(settings.languageMode, `粗分主题 ${index + 1}`, `Bucket ${index + 1}`)).slice(0, 40),
      color: CHROME_GROUP_COLORS.includes(bucket.color) ? bucket.color : CHROME_GROUP_COLORS[index % CHROME_GROUP_COLORS.length],
      confidence: clampConfidence(bucket.confidence),
      tabRefs,
      reason: String(bucket.reason || bucket.rationale || "Coarse semantic bucket.").slice(0, 280)
    });
  }

  const reviewTabs = normalizeTabRefs(plan?.reviewTabs || plan?.reviewTabIds || plan?.ungrouped || [], tabById)
    .filter((ref) => !seen.has(ref.tabId))
    .map((ref) => {
      seen.add(ref.tabId);
      return {
        ...ref,
        reason: ref.reason || localizedText(settings.languageMode, "粗分阶段暂时保留给复核。", "Coarse pass left this tab for review.")
      };
    });

  for (const tab of inventory.plannerTabs || []) {
    if (!seen.has(tab.tabId)) {
      reviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: localizedText(settings.languageMode, "粗分阶段没有稳定归类这个标签页。", "Coarse pass did not assign this tab.")
      });
      seen.add(tab.tabId);
    }
  }

  return { buckets: orderGroupsByOriginalPosition(buckets, inventory), reviewTabs: sortRefsByOriginalOrder(reviewTabs, inventory) };
}

function shouldUseHierarchicalPlanner(inventory, options = {}) {
  if (options.hierarchical === false) return false;
  if (options.hierarchical === true) return true;
  const minTabs = options.hierarchicalMinTabs || HIERARCHICAL_MIN_TABS;
  return (inventory.plannerTabs || []).length >= minTabs;
}

function shouldRefineBucket(bucket, settings, options = {}) {
  const minTabs = options.refineBucketMinTabs || Math.min(settings.maxTabsPerGroup, REFINE_BUCKET_MIN_TABS);
  const confidenceBelow = options.refineConfidenceBelow ?? REFINE_CONFIDENCE_BELOW;
  return bucket.tabRefs.length >= minTabs || bucket.confidence < confidenceBelow;
}

function countRefinementRequests(coarse, settings, options = {}) {
  const bucketRequests = (coarse.buckets || []).reduce(
    (sum, bucket) => sum + (shouldRefineBucket(bucket, settings, options) ? countBucketRefinementRequests(bucket, settings, options) : 0),
    0
  );
  const reviewRequests = coarse.reviewTabs?.length
    ? countBucketRefinementRequests({ tabRefs: coarse.reviewTabs }, settings, options)
    : 0;
  return Math.max(1, bucketRequests + reviewRequests);
}

function countBucketRefinementRequests(bucket, settings, options = {}) {
  const maxTabsPerRequest = options.refineMaxTabsPerRequest || Math.min(settings.maxTabsPerGroup, REFINE_MAX_TABS_PER_REQUEST);
  return Math.max(1, Math.ceil((bucket.tabRefs || []).length / Math.max(1, maxTabsPerRequest)));
}

function refinementProgress(completed, total) {
  const ratio = Math.min(1, Math.max(0, completed / Math.max(1, total)));
  return 55 + Math.round(ratio * 30);
}

function chunkRefs(refs, size) {
  const chunks = [];
  const chunkSize = Math.max(1, size);
  for (let index = 0; index < refs.length; index += chunkSize) {
    chunks.push(refs.slice(index, index + chunkSize));
  }
  return chunks;
}

function subsetInventory(inventory, refs) {
  const ids = new Set(refs.map((ref) => ref.tabId));
  const plannerTabs = (inventory.plannerTabs || []).filter((tab) => ids.has(tab.tabId));
  const tabs = (inventory.tabs || []).filter((tab) => ids.has(tab.tabId));
  const windows = (inventory.windows || []).map((window) => ({
    ...window,
    tabCount: plannerTabs.filter((tab) => tab.windowId === window.windowId).length
  }));

  return {
    ...inventory,
    windows,
    tabs,
    plannerTabs,
    excludedTabs: [],
    lockedGroups: [],
    pageSamples: (inventory.pageSamples || []).filter((sample) => ids.has(sample.tabId))
  };
}

function bucketToGroup(bucket) {
  return {
    groupKey: bucket.groupKey,
    title: bucket.title,
    color: bucket.color,
    confidence: bucket.confidence,
    tabRefs: bucket.tabRefs.map(toPlainTabRef),
    reason: bucket.reason
  };
}

function fallbackGroupsForBucket(bucket, settings, error) {
  const chunkSize = Math.max(1, Number(settings.maxTabsPerGroup) || 1);
  const chunks = chunkRefs(bucket.tabRefs || [], chunkSize);
  return chunks.map((tabRefs, index) => {
    const suffix = chunks.length > 1 ? ` ${index + 1}` : "";
    const fallbackReason = localizedText(
      settings.languageMode,
      `${bucket.reason} 精分不可用：${error.message}`,
      `${bucket.reason} Refinement unavailable: ${error.message}`
    );
    return {
      ...bucketToGroup({ ...bucket, tabRefs }),
      groupKey: chunks.length > 1 ? `${bucket.groupKey}-${index + 1}` : bucket.groupKey,
      title: `${bucket.title}${suffix}`.slice(0, 40),
      reason: fallbackReason.slice(0, 280)
    };
  });
}

function mergePlanParts(groups, reviewTabs, state) {
  for (const group of groups || []) {
    const tabRefs = (group.tabRefs || [])
      .filter((ref) => !state.seen.has(ref.tabId))
      .map((ref) => {
        state.seen.add(ref.tabId);
        return toPlainTabRef(ref);
      });
    if (!tabRefs.length) continue;
    state.finalGroups.push({ ...group, tabRefs });
  }

  for (const ref of reviewTabs || []) {
    if (state.seen.has(ref.tabId)) continue;
    state.seen.add(ref.tabId);
    state.finalReviewTabs.push({
      tabId: ref.tabId,
      windowId: ref.windowId,
      reason:
        ref.reason ||
        localizedText(state.settings?.languageMode, "分层规划后仍需要复核。", "Left for review by hierarchical planner.")
    });
  }
}

function buildActionPlan(groups, reviewTabs, inventory, settings) {
  const orderedGroups = orderGroupsByOriginalPosition(
    uniquifyGroupKeys(groups, settings).map((group) => ({ ...group, tabRefs: sortRefsByOriginalOrder(group.tabRefs || [], inventory) })),
    inventory
  );
  return {
    schemaVersion: 1,
    mode: settings.organizeMode,
    scope:
      settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? { kind: "all_normal_windows", windowIds: inventory.scope.windowIds }
        : { kind: "current_window", windowIds: [inventory.scope.currentWindowId] },
    targetWindow:
      settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? buildTargetWindow(inventory, settings)
        : { kind: "current_window", windowId: inventory.scope.currentWindowId },
    eligibleTabs: (inventory.plannerTabs || []).map((tab) => ({ tabId: tab.tabId, windowId: tab.windowId })),
    excludedTabs: (inventory.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: tab.exclusionReason
    })),
    groups: orderedGroups,
    reviewTabs: sortRefsByOriginalOrder(reviewTabs, inventory)
  };
}

function uniquifyGroupKeys(groups, settings) {
  const seen = new Map();
  return groups.map((group, index) => {
    const base = slugify(group.groupKey || group.title);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return {
      ...group,
      groupKey: count ? `${base}-${count + 1}` : base,
      title: String(group.title || localizedText(settings.languageMode, `主题 ${index + 1}`, "Topic")).slice(0, 40),
      color: CHROME_GROUP_COLORS.includes(group.color) ? group.color : "grey",
      confidence: clampConfidence(group.confidence),
      reason: String(group.reason || localizedText(settings.languageMode, "语义相近的标签页。", "Semantic grouping.")).slice(0, 280)
    };
  });
}

function formatPageSample(result) {
  if (!result) return null;
  if (result.status !== "ok") {
    return [result.status, "", "", "", "", [], "", result.reason || ""];
  }
  const sample = result.sample || {};
  return [
    "ok",
    sample.title || "",
    sample.metaDescription || "",
    sample.language || "",
    sample.contentKind || "",
    sample.headings || [],
    sample.visibleText || "",
    ""
  ];
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
    if (refusal) throw new Error("AI 没有生成可用方案。请调整自定义要求后重新生成。");
    throw new Error("AI 这次没有生成可用方案。请重新生成。");
  }

  try {
    return JSON.parse(extractJsonObjectText(text));
  } catch {
    throw new Error("AI 这次生成的方案格式不完整。请重新生成，或换一个模型再试。");
  }
}

function findRefusal(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .find((content) => content.refusal)?.refusal;
}

function normalizeGatewayPlan(plan, inventory, settings) {
  const wrappedPlan = unwrapGatewayPlan(plan);
  if (wrappedPlan !== plan) return normalizeGatewayPlan(wrappedPlan, inventory, settings);
  if (plan?.schemaVersion === 1 && hasInternalPlanShape(plan)) return normalizeSchemaPlanOrder(plan, inventory);
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.groups)) return plan;

  const plannerTabs = inventory.plannerTabs || [];
  const tabById = new Map(plannerTabs.map((tab) => [tab.tabId, tab]));
  const seen = new Set();
  const groups = [];

  for (const [index, group] of plan.groups.entries()) {
    const refs = sortRefsByOriginalOrder(
      normalizeTabRefs(group.tabRefs || group.ids || group.tabIds || group.tabs || [], tabById).filter((ref) => {
        if (seen.has(ref.tabId)) return false;
        seen.add(ref.tabId);
        return true;
      }),
      inventory
    ).map(toPlainTabRef);
    if (!refs.length) continue;

    groups.push({
      groupKey: slugify(group.groupKey || group.key || group.name || group.title || `group-${index + 1}`),
      title: String(group.title || group.name || localizedText(settings.languageMode, `分组 ${index + 1}`, `Group ${index + 1}`)).slice(0, 40),
      color: CHROME_GROUP_COLORS.includes(group.color) ? group.color : CHROME_GROUP_COLORS[index % CHROME_GROUP_COLORS.length],
      confidence: clampConfidence(group.confidence),
      tabRefs: refs,
      reason: String(
        group.reason ||
          group.rationale ||
          group.reasoning ||
          localizedText(settings.languageMode, "AI 网关输出的语义分组。", "Semantic grouping from AI gateway output.")
      ).slice(0, 280)
    });
  }

  const reviewSeen = new Set();
  const reviewTabs = sortRefsByOriginalOrder(
    normalizeTabRefs(plan.reviewTabs || plan.review || plan.ungrouped || [], tabById)
      .filter((ref) => {
        if (seen.has(ref.tabId) || reviewSeen.has(ref.tabId)) return false;
        reviewSeen.add(ref.tabId);
        return true;
      })
      .map((ref) => ({
        ...ref,
        reason: ref.reason || localizedText(settings.languageMode, "AI 网关把这个标签页留给复核。", "AI gateway left this tab for review.")
      })),
    inventory
  );
  for (const tab of plannerTabs) {
    if (!seen.has(tab.tabId) && !reviewTabs.some((ref) => ref.tabId === tab.tabId)) {
      reviewTabs.push({
        tabId: tab.tabId,
        windowId: tab.windowId,
        reason: localizedText(settings.languageMode, "AI 网关没有稳定归类这个标签页。", "AI gateway did not assign this tab.")
      });
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
        ? buildTargetWindow(inventory, settings)
        : { kind: "current_window", windowId: inventory.scope.currentWindowId },
    eligibleTabs: plannerTabs.map((tab) => ({ tabId: tab.tabId, windowId: tab.windowId })),
    excludedTabs: (inventory.excludedTabs || []).map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      reason: tab.exclusionReason
    })),
    groups: orderGroupsByOriginalPosition(groups, inventory),
    reviewTabs
  };
}

function unwrapGatewayPlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  return plan.plan || plan.actionPlan || plan.result || plan.data || plan;
}

function hasInternalPlanShape(plan) {
  return (
    plan &&
    typeof plan === "object" &&
    Array.isArray(plan.groups) &&
    Array.isArray(plan.reviewTabs) &&
    plan.groups.every((group) => Array.isArray(group?.tabRefs))
  );
}

function normalizeSchemaPlanOrder(plan, inventory) {
  return {
    ...plan,
    groups: Array.isArray(plan.groups)
      ? orderGroupsByOriginalPosition(
          plan.groups.map((group) => ({
            ...group,
            tabRefs: Array.isArray(group?.tabRefs) ? sortRefsByOriginalOrder(group.tabRefs, inventory) : group?.tabRefs
          })),
          inventory
        )
      : plan.groups,
    reviewTabs: Array.isArray(plan.reviewTabs) ? sortRefsByOriginalOrder(plan.reviewTabs, inventory) : plan.reviewTabs
  };
}

function buildTargetWindow(inventory, settings) {
  if (settings.targetWindowMode === TARGET_WINDOW_MODES.SELECTED_WINDOW) {
    return {
      kind: settings.targetWindowMode,
      windowId: settings.selectedTargetWindowId,
      title: targetWindowTitle(settings.targetWindowMode, settings.languageMode)
    };
  }

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.CURRENT_WINDOW) {
    return {
      kind: settings.targetWindowMode,
      windowId: resolveInvocationWindowId(inventory),
      title: targetWindowTitle(settings.targetWindowMode, settings.languageMode)
    };
  }

  return { kind: settings.targetWindowMode, windowId: null, title: targetWindowTitle(settings.targetWindowMode, settings.languageMode) };
}

function resolveInvocationWindowId(inventory) {
  if (Number.isInteger(inventory.scope?.invocationWindowId)) return inventory.scope.invocationWindowId;
  const focusedWindow = (inventory.windows || []).find((window) => window.focused) || inventory.windows?.[0];
  return focusedWindow?.windowId ?? null;
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

function sortRefsByOriginalOrder(refs, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return asArray(refs).sort((left, right) => tabOrder(left.tabId) - tabOrder(right.tabId));
}

function orderGroupsByOriginalPosition(groups, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return asArray(groups).sort((left, right) => firstGroupOrder(left, tabOrder) - firstGroupOrder(right, tabOrder));
}

function firstGroupOrder(group, tabOrder) {
  const orders = asArray(group?.tabRefs).map((ref) => tabOrder(ref.tabId));
  return orders.length ? Math.min(...orders) : Number.MAX_SAFE_INTEGER;
}

function buildTabOrder(inventory) {
  const order = new Map();
  for (const [fallbackIndex, tab] of (inventory.plannerTabs || []).entries()) {
    const value = Number.isInteger(tab.sequenceIndex) ? tab.sequenceIndex : fallbackIndex;
    order.set(tab.tabId, value);
  }
  return (tabId) => order.get(tabId) ?? Number.MAX_SAFE_INTEGER;
}

function asArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function stripCodeFence(text) {
  const trimmed = String(text).trim();
  const match = trimmed.match(/^```\s*(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

function extractJsonObjectText(text) {
  const raw = stripCodeFence(text).trim();
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return raw.slice(start, end + 1);
    return raw;
  }
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

function applyThinkingIntensity(body, settings, intensity = settings.gatewayThinkingIntensity) {
  if (usesGlmThinking(settings)) {
    body.thinking = { type: intensity === THINKING_INTENSITIES.LOW ? "disabled" : "enabled" };
    return;
  }

  body.reasoning_effort = intensity === THINKING_INTENSITIES.ULTRA ? THINKING_INTENSITIES.HIGH : intensity;
}

function usesGlmThinking(settings) {
  const model = resolveGatewayModel(settings).toLowerCase();
  if (model.startsWith("glm-")) return true;

  try {
    const hostname = new URL(effectiveGatewayBaseUrl(settings)).hostname.toLowerCase();
    return hostname.endsWith("bigmodel.cn") || hostname.endsWith("z.ai");
  } catch {
    return false;
  }
}

function thinkingIntensityText(value) {
  if (value === "low") return "low, prefer a faster but still valid plan";
  if (value === "medium") return "medium, balance quality and speed";
  if (value === "high") return "high, spend more reasoning on semantic grouping";
  if (value === "ultra") return "ultra-high, be especially careful with semantic overlap, cross-window context, and low-confidence tabs";
  return "high, spend more reasoning on semantic grouping";
}

async function emitProgress(options, event) {
  if (typeof options.onProgress === "function") {
    await options.onProgress(event);
  }
}

function exampleCompactPlan() {
  return {
    schema: "tab_tidy_plan_compact_v1",
    groups: [
      {
        key: "topic",
        title: "Topic",
        color: "blue",
        confidence: 0.8,
        ids: [1],
        reason: "Semantic reason."
      }
    ],
    review: [{ id: 2, reason: "Low confidence." }]
  };
}

export { ACTION_PLAN_JSON_SCHEMA };
