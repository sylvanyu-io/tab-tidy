import { ORGANIZE_MODES, PROMPT_PRESET_TEXT, TARGET_WINDOW_MODES, normalizeSettings } from "../shared/settings.js";
import { fetchJsonWithTimeout } from "./fetch-timeout.js";
import { ACTION_PLAN_JSON_SCHEMA } from "./plan-schema.js";
import { CHROME_GROUP_COLORS } from "./plan-validator.js";

const HIERARCHICAL_MIN_TABS = 100;
const REFINE_BUCKET_MIN_TABS = 50;
const REFINE_MAX_TABS_PER_REQUEST = 80;
const REFINE_CONFIDENCE_BELOW = 0.78;
const COARSE_MAX_BUCKETS = 24;

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

async function createSingleGatewayPlan(inventory, settings, fetchImpl, options = {}) {
  if (!options.suppressSingleRequestProgress) {
    await emitProgress(options, { phase: "planning", progress: 45, message: "正在请求 AI 规划" });
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
      headers: gatewayHeaders(settings),
      body: JSON.stringify(body)
    },
    "AI gateway planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(data?.error?.message || `AI gateway planner failed with status ${response.status}.`);
  }

  if (!options.suppressSingleRequestProgress) {
    await emitProgress(options, { phase: "planning", progress: 82, message: "AI 已返回，正在解析方案" });
  }
  return parsePlanFromGatewayResponse(data, inventory, settings);
}

async function createHierarchicalGatewayPlan(inventory, settings, fetchImpl, options = {}) {
  await emitProgress(options, { phase: "coarse_planning", progress: 42, message: "正在快速粗分标签页" });
  const coarse = await createCoarseGatewayBuckets(inventory, settings, fetchImpl, options);
  await emitProgress(options, {
    phase: "coarse_planning",
    progress: 55,
    message: `粗分完成：${coarse.buckets.length} 个候选主题`
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
      mergePlanParts(refined.groups, refined.reviewTabs, { finalGroups, finalReviewTabs, seen });
    } else if (bucket.confidence >= settings.minConfidenceToApply) {
      mergePlanParts([bucketToGroup(bucket)], [], { finalGroups, finalReviewTabs, seen });
    } else {
      mergePlanParts([], bucket.tabRefs.map((ref) => ({ ...ref, reason: `Low-confidence coarse bucket: ${bucket.title}.` })), {
        finalGroups,
        finalReviewTabs,
        seen
      });
    }
  }

  if (coarse.reviewTabs.length) {
    const reviewBucket = {
      groupKey: "coarse-review",
      title: "Review",
      color: "grey",
      confidence: 0.5,
      tabRefs: coarse.reviewTabs,
      reason: "Coarse pass left these tabs uncertain."
    };
    await emitProgress(options, {
      phase: "refining",
      progress: refinementProgress(refinementDone, refinementTotal),
      message: "正在精分待确认标签页"
    });
    const refined = await refineBucket(reviewBucket, inventory, settings, fetchImpl, options);
    refinementDone += countBucketRefinementRequests(reviewBucket, settings, options);
    await emitProgress(options, {
      phase: "refining",
      progress: refinementProgress(refinementDone, refinementTotal),
      message: "待确认标签页已精分"
    });
    mergePlanParts(refined.groups, refined.reviewTabs, { finalGroups, finalReviewTabs, seen });
  }

  for (const tab of inventory.plannerTabs || []) {
    if (!seen.has(tab.tabId)) {
      finalReviewTabs.push({ tabId: tab.tabId, windowId: tab.windowId, reason: "Hierarchical planner did not assign this tab." });
      seen.add(tab.tabId);
    }
  }

  await emitProgress(options, { phase: "building_plan", progress: 86, message: "正在合并精分结果" });
  return buildActionPlan(finalGroups, finalReviewTabs, inventory, settings);
}

export function gatewayChatCompletionsUrl(settings) {
  return `${settings.gatewayBaseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function gatewayHeaders(settings) {
  const headers = { "content-type": "application/json" };
  if (settings.gatewayApiKey) {
    headers.authorization = `Bearer ${settings.gatewayApiKey}`;
  }
  return headers;
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
    "Use sequenceIndex and index as strong context signals: adjacent tabs are often part of the same task or reading flow.",
    "Keep tabRefs inside each group in original tab order, and order groups by the first tab they contain.",
    "Do not create large generic catch-all groups. Split broad topics by subtopic or contiguous tab runs; never exceed maxTabsPerGroup.",
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
      index: tab.index,
      sequenceIndex: tab.sequenceIndex,
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

async function createCoarseGatewayBuckets(inventory, settings, fetchImpl, options = {}) {
  const body = {
    model: settings.gatewayModel,
    messages: [
      { role: "system", content: buildCoarseSystemPrompt(settings, options) },
      { role: "user", content: buildCoarseUserPrompt(inventory, settings) }
    ],
    response_format: { type: "json_object" },
    max_tokens: 8192,
    reasoning_effort: "low"
  };
  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    gatewayChatCompletionsUrl(settings),
    {
      method: "POST",
      headers: gatewayHeaders(settings),
      body: JSON.stringify(body)
    },
    "AI gateway coarse planner",
    options.timeoutMs,
    options.signal
  );
  if (!response.ok) {
    throw new Error(data?.error?.message || `AI gateway coarse planner failed with status ${response.status}.`);
  }
  return normalizeCoarsePlan(parseGatewayJson(data), inventory);
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
        groups: [
          {
            ...bucketToGroup(bucket),
            reason: `${bucket.reason} Refinement unavailable: ${error.message}`
          }
        ],
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
      windows: payload.windows,
      eligibleTabs: payload.eligibleTabs.map((tab) => ({
        tabId: tab.tabId,
        windowId: tab.windowId,
        index: tab.index,
        sequenceIndex: tab.sequenceIndex,
        title: tab.title,
        hostname: tab.hostname,
        sanitizedUrl: tab.sanitizedUrl,
        pageSample: tab.pageSample
      })),
      lockedGroups: payload.lockedGroups,
      pageSampleResults: payload.pageSampleResults
    })
  ].join("\n");
}

function normalizeCoarsePlan(plan, inventory) {
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
      title: String(bucket.title || bucket.name || `Bucket ${index + 1}`).slice(0, 40),
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
      return { ...ref, reason: ref.reason || "Coarse pass left this tab for review." };
    });

  for (const tab of inventory.plannerTabs || []) {
    if (!seen.has(tab.tabId)) {
      reviewTabs.push({ tabId: tab.tabId, windowId: tab.windowId, reason: "Coarse pass did not assign this tab." });
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
      reason: ref.reason || "Left for review by hierarchical planner."
    });
  }
}

function buildActionPlan(groups, reviewTabs, inventory, settings) {
  const orderedGroups = orderGroupsByOriginalPosition(
    uniquifyGroupKeys(groups).map((group) => ({ ...group, tabRefs: sortRefsByOriginalOrder(group.tabRefs || [], inventory) })),
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

function uniquifyGroupKeys(groups) {
  const seen = new Map();
  return groups.map((group) => {
    const base = slugify(group.groupKey || group.title);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return {
      ...group,
      groupKey: count ? `${base}-${count + 1}` : base,
      title: String(group.title || "Topic").slice(0, 40),
      color: CHROME_GROUP_COLORS.includes(group.color) ? group.color : "grey",
      confidence: clampConfidence(group.confidence),
      reason: String(group.reason || "Semantic grouping.").slice(0, 280)
    };
  });
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
  if (plan?.schemaVersion === 1) return normalizeSchemaPlanOrder(plan, inventory);
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.groups)) return plan;

  const plannerTabs = inventory.plannerTabs || [];
  const tabById = new Map(plannerTabs.map((tab) => [tab.tabId, tab]));
  const seen = new Set();
  const groups = [];

  for (const [index, group] of plan.groups.entries()) {
    const refs = sortRefsByOriginalOrder(
      normalizeTabRefs(group.tabRefs || group.tabIds || group.tabs || [], tabById).filter((ref) => {
        if (seen.has(ref.tabId)) return false;
        seen.add(ref.tabId);
        return true;
      }),
      inventory
    ).map(toPlainTabRef);
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

  const reviewTabs = sortRefsByOriginalOrder(
    normalizeTabRefs(plan.reviewTabs || plan.ungrouped || [], tabById)
    .filter((ref) => !seen.has(ref.tabId))
    .map((ref) => ({ ...ref, reason: ref.reason || "AI gateway left this tab for review." })),
    inventory
  );
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

function normalizeSchemaPlanOrder(plan, inventory) {
  return {
    ...plan,
    groups: orderGroupsByOriginalPosition(
      (plan.groups || []).map((group) => ({ ...group, tabRefs: sortRefsByOriginalOrder(group.tabRefs || [], inventory) })),
      inventory
    ),
    reviewTabs: sortRefsByOriginalOrder(plan.reviewTabs || [], inventory)
  };
}

function buildTargetWindow(inventory, settings) {
  if (settings.targetWindowMode === TARGET_WINDOW_MODES.SELECTED_WINDOW) {
    return { kind: settings.targetWindowMode, windowId: settings.selectedTargetWindowId, title: "Selected Window" };
  }

  if (settings.targetWindowMode === TARGET_WINDOW_MODES.CURRENT_WINDOW) {
    return { kind: settings.targetWindowMode, windowId: resolveInvocationWindowId(inventory), title: "Current Window" };
  }

  return { kind: settings.targetWindowMode, windowId: null, title: "AI Organized" };
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
  return [...(refs || [])].sort((left, right) => tabOrder(left.tabId) - tabOrder(right.tabId));
}

function orderGroupsByOriginalPosition(groups, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return [...(groups || [])].sort((left, right) => firstGroupOrder(left, tabOrder) - firstGroupOrder(right, tabOrder));
}

function firstGroupOrder(group, tabOrder) {
  const orders = (group.tabRefs || []).map((ref) => tabOrder(ref.tabId));
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

async function emitProgress(options, event) {
  if (typeof options.onProgress === "function") {
    await options.onProgress(event);
  }
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
