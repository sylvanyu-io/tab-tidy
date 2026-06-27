import { PLANNER_PROVIDERS, URL_PRIVACY_MODES, normalizeSettings } from "../shared/settings.js";
import { localizedText } from "../shared/language.js";
import { fetchJsonWithTimeout } from "./fetch-timeout.js";
import {
  applyThinkingIntensity,
  gatewayChatCompletionsUrl,
  gatewayErrorMessage,
  gatewayHeaders,
  gatewayRequestMeta,
  parsePlanFromResponse,
  requireGatewayModel
} from "./gateway-planner.js";
import { getLocal } from "./storage.js";
import { getTabLifecycleStats } from "./tab-lifecycle-log.js";
import { STORAGE_KEYS } from "./storage.js";
import { canSampleUrl, getTabUrl, sanitizeTabUrl } from "./url-sanitizer.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 7 * DAY_MS;
const MAX_RANGE_MS = 90 * DAY_MS;
const MAX_RECAP_PAGES = 360;
const GATEWAY_TIMEOUT_MS = 120_000;
const REVIEW_AGE_MS = 14 * DAY_MS;
const REVIEW_IDLE_MS = 7 * DAY_MS;

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "api",
  "are",
  "com",
  "docs",
  "for",
  "from",
  "guide",
  "http",
  "https",
  "into",
  "page",
  "pages",
  "the",
  "this",
  "with",
  "www",
  "一个",
  "这个",
  "页面",
  "文档",
  "教程"
]);

export async function generateTimeRecap(chromeApi, rawSettings = {}, options = {}) {
  const settings = normalizeSettings(rawSettings);
  const input = await buildTimeRecapInput(chromeApi, settings, options);
  const localRecap = buildLocalTimeRecap(input, settings);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (settings.plannerProvider !== PLANNER_PROVIDERS.GATEWAY || typeof fetchImpl !== "function" || !input.pages.length) {
    return {
      source: "local",
      recap: localRecap,
      input
    };
  }

  try {
    const recap = await createGatewayTimeRecap(input, settings, fetchImpl, options);
    return {
      source: "ai",
      recap,
      input
    };
  } catch (error) {
    return {
      source: "local_fallback",
      error: error?.message || String(error),
      recap: {
        ...localRecap,
        coverageNote: localizedText(
          settings.languageMode,
          `${localRecap.coverageNote} AI 回顾暂时不可用，先展示本机线索。`,
          `${localRecap.coverageNote} AI recap is unavailable, so this uses local signals.`
        )
      },
      input
    };
  }
}

export async function buildTimeRecapInput(chromeApi, rawSettings = {}, options = {}) {
  const settings = normalizeSettings(rawSettings);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const range = normalizeTimeRecapRange(options.range || options, now);
  const [activityCache, summaryCache, lifecycleLog, lifecycleStats, currentTabs] = await Promise.all([
    getLocal(chromeApi, STORAGE_KEYS.pageActivityCache, null),
    getLocal(chromeApi, STORAGE_KEYS.pageSummaryCache, null),
    getLocal(chromeApi, STORAGE_KEYS.tabLifecycleLog, null),
    getTabLifecycleStats(chromeApi, { now }),
    collectCurrentTabs(chromeApi, settings)
  ]);

  const rows = new Map();
  const activityEntries = normalizeEntryMap(activityCache);
  const summaryEntries = normalizeEntryMap(summaryCache);
  const lifecycleSessions = normalizeLifecycleSessions(lifecycleLog);

  for (const entry of Object.values(activityEntries)) {
    if (!entryOverlapsRange(entry, range)) continue;
    upsertPage(rows, entry.key, {
      title: entry.title || entry.sample?.title || "",
      hostname: entry.hostname || "",
      sanitizedUrl: entry.sanitizedUrl || "",
      firstSeenAt: entry.firstSeenAt || "",
      lastSeenAt: entry.lastSeenAt || "",
      seenCount: Number(entry.seenCount || 0),
      sampleable: Boolean(entry.sampleable),
      summary: compactSummary(entry.sample)
    });
  }

  for (const entry of Object.values(summaryEntries)) {
    if (!entryOverlapsRange(entry, range)) continue;
    upsertPage(rows, entry.key, {
      title: entry.title || entry.sample?.title || "",
      hostname: hostnameFromOrigin(entry.origin),
      firstSeenAt: entry.firstSeenAt || entry.sampledAt || "",
      lastSeenAt: latestIso(entry.lastSeenAt, entry.lastUsedAt, entry.sampledAt),
      seenCount: Number(entry.seenCount || 0),
      sampleable: true,
      summary: compactSummary(entry.sample)
    });
  }

  for (const session of lifecycleSessions) {
    if (!sessionOverlapsRange(session, range)) continue;
    const key = session.urlKey || pageCacheKey(session.sanitizedUrl);
    upsertPage(rows, key, {
      tabId: Number.isInteger(session.tabId) && !session.closedAt ? session.tabId : null,
      windowId: Number.isInteger(session.windowId) && !session.closedAt ? session.windowId : null,
      index: Number.isFinite(session.index) ? session.index : null,
      title: session.title || "",
      hostname: session.hostname || "",
      sanitizedUrl: session.sanitizedUrl || "",
      firstSeenAt: session.openedAt || session.firstObservedAt || "",
      lastSeenAt: latestIso(session.lastObservedAt, session.closedAt),
      lastActivatedAt: session.lastActivatedAt || "",
      closedAt: session.closedAt || "",
      activeCount: Number(session.activeCount || 0),
      open: !session.closedAt,
      pinned: Boolean(session.pinned),
      discarded: Boolean(session.discarded),
      audible: Boolean(session.audible)
    });
  }

  for (const tab of currentTabs) {
    const key = pageCacheKey(tab.rawUrl) || `tab_${tab.tabId}`;
    upsertPage(rows, key, {
      tabId: tab.tabId,
      windowId: tab.windowId,
      index: tab.index,
      title: tab.title,
      hostname: tab.hostname,
      sanitizedUrl: tab.sanitizedUrl,
      lastSeenAt: new Date(now).toISOString(),
      open: true,
      currentGroupTitle: tab.currentGroupTitle || "",
      discarded: Boolean(tab.discarded),
      pinned: Boolean(tab.pinned),
      audible: Boolean(tab.audible),
      sampleable: tab.sampleable
    });
  }

  const scored = [...rows.values()]
    .filter((page) => page.title || page.hostname || page.summary)
    .map((page) => ({ ...page, score: pageScore(page, range) }))
    .sort((left, right) => right.score - left.score || compareIsoDesc(left.lastSeenAt, right.lastSeenAt));
  const clipped = scored.slice(MAX_RECAP_PAGES);
  const pages = scored.slice(0, MAX_RECAP_PAGES).map((page, index) => ({
    id: index + 1,
    tabId: Number.isInteger(page.tabId) ? page.tabId : null,
    windowId: Number.isInteger(page.windowId) ? page.windowId : null,
    index: Number.isFinite(page.index) ? page.index : null,
    open: Boolean(page.open),
    title: String(page.title || page.summary?.title || page.hostname || localizedText(settings.languageMode, "无标题", "Untitled")).slice(0, 180),
    hostname: String(page.hostname || "").slice(0, 120),
    sanitizedUrl: settings.urlPrivacyMode === URL_PRIVACY_MODES.TITLE_ONLY ? "" : String(page.sanitizedUrl || "").slice(0, 220),
    firstSeenAt: page.firstSeenAt || "",
    lastSeenAt: page.lastSeenAt || "",
    lastActivatedAt: page.lastActivatedAt || "",
    closedAt: page.closedAt || "",
    seenCount: Math.max(0, Number(page.seenCount || 0)),
    activeCount: Math.max(0, Number(page.activeCount || 0)),
    currentGroupTitle: String(page.currentGroupTitle || "").slice(0, 80),
    discarded: Boolean(page.discarded),
    pinned: Boolean(page.pinned),
    audible: Boolean(page.audible),
    sampleable: Boolean(page.sampleable),
    summary: page.summary || null
  }));

  return {
    schema: "tab_tidy_time_recap_input_v1",
    languageMode: settings.languageMode,
    range,
    coverage: {
      activityEntries: Object.keys(activityEntries).length,
      summaryEntries: Object.keys(summaryEntries).length,
      sampledEntries: pages.filter((page) => page.summary).length,
      currentOpenTabs: currentTabs.length,
      lifecycleSessions: lifecycleStats.sessions || lifecycleSessions.length,
      lifecycleEvents: lifecycleStats.events || normalizeEvents(lifecycleLog).length,
      inferredClosed: lifecycleStats.inferredClosed || 0,
      includedPages: pages.length,
      clippedPages: clipped.length
    },
    pageFields: [
      "id",
      "tabId",
      "windowId",
      "open",
      "title",
      "hostname",
      "sanitizedUrl",
      "firstSeenAt",
      "lastSeenAt",
      "lastActivatedAt",
      "closedAt",
      "seenCount",
      "activeCount",
      "currentGroupTitle",
      "discarded",
      "pinned",
      "summary"
    ],
    pages
  };
}

export function normalizeTimeRecapRange(rawRange = {}, now = Date.now()) {
  const preset = String(rawRange.preset || rawRange.rangePreset || "7d");
  const nowMs = Number.isFinite(now) ? now : Date.now();
  let from = Number.NaN;
  let to = Number.NaN;

  if (preset === "custom") {
    from = Date.parse(rawRange.from || rawRange.fromIso || "");
    to = Date.parse(rawRange.to || rawRange.toIso || "");
  } else if (preset === "today") {
    const start = new Date(nowMs);
    start.setHours(0, 0, 0, 0);
    from = start.getTime();
    to = nowMs;
  } else if (preset === "30d") {
    from = nowMs - 30 * DAY_MS;
    to = nowMs;
  } else {
    from = nowMs - DEFAULT_RANGE_MS;
    to = nowMs;
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error("Invalid recap time range.");
  }
  if (to < from) {
    throw new Error("Recap end time must be after the start time.");
  }
  if (to - from > MAX_RANGE_MS) {
    from = to - MAX_RANGE_MS;
  }

  return {
    preset: ["today", "7d", "30d", "custom"].includes(preset) ? preset : "7d",
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    rangeMs: to - from,
    label: rangeLabel(to - from, preset)
  };
}

export async function createGatewayTimeRecap(input, rawSettings = {}, fetchImpl = globalThis.fetch, options = {}) {
  const settings = normalizeSettings(rawSettings);
  const body = {
    model: requireGatewayModel(settings),
    messages: [
      { role: "system", content: buildTimeRecapSystemPrompt(settings) },
      { role: "user", content: buildTimeRecapUserPrompt(input) }
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096
  };
  applyThinkingIntensity(body, settings, settings.gatewayThinkingIntensity);

  const { response, data } = await fetchJsonWithTimeout(
    fetchImpl,
    gatewayChatCompletionsUrl(settings),
    {
      method: "POST",
      headers: gatewayHeaders(settings, {
        ...gatewayRequestMeta({ pageSamples: input.pages.filter((page) => page.summary).map(() => ({ status: "ok" })) }, options),
        feature: "time_recap"
      }),
      body: JSON.stringify(body)
    },
    "AI gateway time recap",
    options.timeoutMs ?? GATEWAY_TIMEOUT_MS,
    options.signal
  );
  if (!response.ok) {
    throw new Error(gatewayErrorMessage(response, data, settings));
  }

  return normalizeTimeRecap(parsePlanFromResponse(data), input, settings);
}

export function buildLocalTimeRecap(input, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const pages = input.pages || [];
  const buckets = localThemeBuckets(pages);
  const themes = buckets.slice(0, 5).map((bucket) => ({
    title: bucket.title,
    description: localizedText(
      settings.languageMode,
      `集中在 ${bucket.pages.length} 个页面，代表线索包括 ${bucket.pages.slice(0, 3).map((page) => page.title).join("、")}。`,
      `Covers ${bucket.pages.length} pages, led by ${bucket.pages.slice(0, 3).map((page) => page.title).join(", ")}.`
    ),
    confidence: bucket.pages.some((page) => page.summary) ? "medium" : "low",
    pageIds: bucket.pages.slice(0, 12).map((page) => page.id),
    evidence: bucket.pages.slice(0, 3).map((page) => page.hostname || page.title).filter(Boolean)
  }));
  const reviewCandidates = pages
    .filter((page) => page.open && (ageMs(page.firstSeenAt, input.range.to) >= REVIEW_AGE_MS || ageMs(page.lastSeenAt, input.range.to) >= REVIEW_IDLE_MS))
    .sort((left, right) => ageMs(right.firstSeenAt, input.range.to) - ageMs(left.firstSeenAt, input.range.to))
    .slice(0, 12)
    .map((page) => ({
      pageId: page.id,
      tabId: page.tabId,
      priority: ageMs(page.firstSeenAt, input.range.to) >= 30 * DAY_MS ? "high" : "medium",
      reason: localizedText(
        settings.languageMode,
        "这个页面已经放了一段时间，可以先复查是否还需要保留。",
        "This page has been around for a while and is worth reviewing."
      ),
      evidence: [
        page.currentGroupTitle ? localizedText(settings.languageMode, `当前分组：${page.currentGroupTitle}`, `Current group: ${page.currentGroupTitle}`) : "",
        page.summary ? localizedText(settings.languageMode, "已有页面摘要", "Has a page summary") : ""
      ].filter(Boolean)
    }));

  return {
    schema: "tab_tidy_time_recap_v1",
    language: settings.languageMode === "en-US" ? "en-US" : "zh-CN",
    headline: localHeadline(themes, input, settings),
    summary: localSummary(themes, pages, input, settings),
    themes,
    timeline: localTimeline(pages, input, settings),
    followUps: localFollowUps(pages, settings),
    reviewCandidates,
    coverageNote: coverageNote(input, settings)
  };
}

function buildTimeRecapSystemPrompt(settings) {
  return [
    "You are a JSON-only time recap writer for a consumer Chrome tab organization product.",
    "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations outside JSON.",
    "Summarize what the user appears to have been working on during the requested time range using only the provided local tab activity and page summaries.",
    "This is not browser history. Be honest about weak evidence without using scary coverage language.",
    "Write user-facing product copy. Do not expose raw implementation terms such as activeCount, ageDays, idleDays, pageId, tabId, sampleable, sequenceIndex, cache, lifecycle, or hostname as labels.",
    "Do not say tabs will be deleted. Review candidates are manual suggestions only.",
    "Required JSON shape: {schema:\"tab_tidy_time_recap_v1\",language:\"zh-CN\"|\"en-US\",headline:string,summary:string,themes:[{title:string,description:string,confidence:\"high\"|\"medium\"|\"low\",ids:number[],evidence:string[]}],timeline:[{label:string,description:string,ids:number[]}],followUps:[{title:string,reason:string,ids:number[]}],reviewCandidates:[{id:number,priority:\"high\"|\"medium\"|\"low\",reason:string,evidence:string[]}],coverageNote:string}.",
    settings.languageMode === "en-US"
      ? "Write all user-visible text in English."
      : "Write all user-visible text in Simplified Chinese."
  ].join("\n");
}

function buildTimeRecapUserPrompt(input) {
  return [
    "Tab Tidy local time-recap input follows. Page rows are already privacy-reduced.",
    JSON.stringify(input)
  ].join("\n");
}

function normalizeTimeRecap(parsed, input, settings) {
  const source = parsed?.recap || parsed?.result || parsed?.data || parsed || {};
  const pagesById = new Map((input.pages || []).map((page) => [page.id, page]));
  const normalizeIds = (value) => uniqueNumbers(value?.ids || value?.pageIds || value?.pages || value?.tabIds)
    .map((id) => (pagesById.has(id) ? id : pageIdForTabId(input, id)))
    .filter((id) => pagesById.has(id));
  const themes = asArray(source.themes).slice(0, 8).map((theme, index) => {
    const ids = normalizeIds(theme).slice(0, 16);
    return {
      title: String(theme?.title || localizedText(settings.languageMode, `主题 ${index + 1}`, `Theme ${index + 1}`)).slice(0, 80),
      description: String(theme?.description || theme?.summary || "").slice(0, 360),
      confidence: normalizeConfidence(theme?.confidence),
      pageIds: ids,
      evidence: asArray(theme?.evidence).map(compactText).filter(Boolean).slice(0, 4)
    };
  }).filter((theme) => theme.title && (theme.description || theme.pageIds.length));

  const timeline = asArray(source.timeline).slice(0, 8).map((item) => ({
    label: String(item?.label || "").slice(0, 80),
    description: String(item?.description || item?.summary || "").slice(0, 300),
    pageIds: normalizeIds(item).slice(0, 12)
  })).filter((item) => item.label || item.description);

  const followUps = asArray(source.followUps || source.nextSteps).slice(0, 8).map((item) => ({
    title: String(item?.title || "").slice(0, 80),
    reason: String(item?.reason || item?.description || "").slice(0, 260),
    pageIds: normalizeIds(item).slice(0, 12)
  })).filter((item) => item.title || item.reason);

  const reviewCandidates = asArray(source.reviewCandidates || source.cleanupCandidates).slice(0, 20).map((item) => {
    const id = Number(item?.id ?? item?.pageId ?? pageIdForTabId(input, Number(item?.tabId)));
    const page = pagesById.get(id);
    if (!page) return null;
    return {
      pageId: id,
      tabId: page.tabId,
      windowId: page.windowId,
      priority: normalizePriority(item?.priority),
      reason: String(item?.reason || "").slice(0, 260),
      evidence: asArray(item?.evidence).map(compactText).filter(Boolean).slice(0, 4)
    };
  }).filter(Boolean);

  const local = buildLocalTimeRecap(input, settings);
  return {
    schema: "tab_tidy_time_recap_v1",
    language: settings.languageMode === "en-US" ? "en-US" : "zh-CN",
    headline: String(source.headline || local.headline).slice(0, 120),
    summary: String(source.summary || local.summary).slice(0, 700),
    themes: themes.length ? themes : local.themes,
    timeline: timeline.length ? timeline : local.timeline,
    followUps: followUps.length ? followUps : local.followUps,
    reviewCandidates: reviewCandidates.length ? reviewCandidates : local.reviewCandidates,
    coverageNote: String(source.coverageNote || local.coverageNote).slice(0, 300)
  };
}

async function collectCurrentTabs(chromeApi, settings) {
  const windows = await chromeApi.windows?.getAll?.({ populate: true, windowTypes: ["normal"] }).catch(() => []);
  const groupsById = await collectTabGroupsById(chromeApi, windows);
  return windows
    .flatMap((window) => window.tabs || [])
    .filter((tab) => (!tab.incognito || settings.includeIncognitoTabs) && (getTabUrl(tab) || tab.title))
    .map((tab) => {
      const rawUrl = getTabUrl(tab);
      const urlInfo = sanitizeTabUrl(rawUrl, URL_PRIVACY_MODES.SANITIZED_URL);
      const group = Number.isInteger(tab.groupId) && tab.groupId !== -1 ? groupsById.get(tab.groupId) : null;
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: String(tab.title || "").slice(0, 180),
        rawUrl,
        hostname: urlInfo.hostname || urlInfo.urlKind || "",
        sanitizedUrl: urlInfo.sanitizedUrl || "",
        currentGroupTitle: group?.title || "",
        discarded: Boolean(tab.discarded),
        pinned: Boolean(tab.pinned),
        audible: Boolean(tab.audible),
        sampleable: canSampleUrl(rawUrl)
      };
    });
}

async function collectTabGroupsById(chromeApi, windows = []) {
  const groupsById = new Map();
  if (!chromeApi.tabGroups?.query) return groupsById;
  for (const window of windows) {
    const groups = await chromeApi.tabGroups.query({ windowId: window.id }).catch(() => []);
    for (const group of groups) groupsById.set(group.id, group);
  }
  return groupsById;
}

function upsertPage(rows, rawKey, patch) {
  const key = rawKey || pageCacheKey(patch.sanitizedUrl || "");
  if (!key) return;
  const existing = rows.get(key) || { key };
  rows.set(key, mergePage(existing, patch));
}

function mergePage(existing, patch) {
  return {
    ...existing,
    ...patch,
    title: patch.title || existing.title || "",
    hostname: patch.hostname || existing.hostname || "",
    sanitizedUrl: patch.sanitizedUrl || existing.sanitizedUrl || "",
    firstSeenAt: earliestIso(existing.firstSeenAt, patch.firstSeenAt),
    lastSeenAt: latestIso(existing.lastSeenAt, patch.lastSeenAt),
    seenCount: Math.max(Number(existing.seenCount || 0), Number(patch.seenCount || 0)),
    activeCount: Math.max(Number(existing.activeCount || 0), Number(patch.activeCount || 0)),
    summary: patch.summary || existing.summary || null,
    open: Boolean(existing.open || patch.open)
  };
}

function compactSummary(sample = null) {
  if (!sample || typeof sample !== "object") return null;
  const visibleText = String(sample.visibleText || "").trim().replace(/\s+/g, " ");
  const metaDescription = String(sample.metaDescription || "").trim().replace(/\s+/g, " ");
  const headings = Array.isArray(sample.headings)
    ? sample.headings.map((heading) => String(heading || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  if (!sample.title && !metaDescription && !visibleText && !headings.length) return null;
  return {
    title: String(sample.title || "").slice(0, 160),
    metaDescription: metaDescription.slice(0, 260),
    contentKind: String(sample.contentKind || "").slice(0, 40),
    headings,
    excerpt: [metaDescription, visibleText].filter(Boolean).join(" ").slice(0, 620)
  };
}

function pageScore(page, range) {
  const lastSeenAge = ageMs(page.lastSeenAt, range.to);
  const firstSeenAge = ageMs(page.firstSeenAt, range.to);
  let score = 0;
  if (page.open) score += 80;
  if (page.summary) score += 32;
  if (page.currentGroupTitle) score += 8;
  if (page.activeCount) score += Math.min(24, page.activeCount * 4);
  if (page.seenCount) score += Math.min(18, page.seenCount * 3);
  if (page.discarded) score -= 6;
  score += Math.max(0, 40 - lastSeenAge / (6 * 60 * 60 * 1000));
  if (firstSeenAge >= REVIEW_AGE_MS && page.open) score += 8;
  return score;
}

function localThemeBuckets(pages) {
  const buckets = new Map();
  for (const page of pages) {
    const key = page.currentGroupTitle || page.summary?.contentKind || dominantToken(page) || page.hostname || "other";
    const title = titleForBucket(key, page);
    if (!buckets.has(key)) buckets.set(key, { key, title, pages: [] });
    buckets.get(key).pages.push(page);
  }
  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, pages: bucket.pages.sort((left, right) => compareIsoDesc(left.lastSeenAt, right.lastSeenAt)) }))
    .sort((left, right) => right.pages.length - left.pages.length);
}

function localHeadline(themes, input, settings) {
  if (!input.pages.length) {
    return localizedText(settings.languageMode, "这段时间还没有足够的本地线索", "Not enough local signals yet");
  }
  const names = themes.slice(0, 3).map((theme) => theme.title).filter(Boolean);
  return localizedText(
    settings.languageMode,
    `最近主要围绕 ${names.join("、") || "几个分散主题"}。`,
    `Recent work centered on ${names.join(", ") || "a few separate threads"}.`
  );
}

function localSummary(themes, pages, input, settings) {
  return localizedText(
    settings.languageMode,
    `已梳理 ${pages.length} 个本地页面线索，其中 ${input.coverage.sampledEntries} 个带页面摘要。这个回顾会优先参考仍打开、最近活跃和有摘要的页面。`,
    `Reviewed ${pages.length} local page signals, including ${input.coverage.sampledEntries} with page summaries. This recap favors still-open, recently active, and summarized pages.`
  );
}

function localTimeline(pages, input, settings) {
  const byDay = new Map();
  for (const page of pages) {
    const day = String(page.lastSeenAt || page.firstSeenAt || "").slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(page);
  }
  return [...byDay.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .slice(0, 5)
    .map(([day, dayPages]) => ({
      label: day,
      description: localizedText(settings.languageMode, `${dayPages.length} 个页面有活动记录。`, `${dayPages.length} pages had activity.`),
      pageIds: dayPages.slice(0, 10).map((page) => page.id)
    }));
}

function localFollowUps(pages, settings) {
  return pages
    .filter((page) => page.open)
    .slice(0, 5)
    .map((page) => ({
      title: page.title,
      reason: localizedText(settings.languageMode, "仍然打开，可以从这里继续。", "Still open; useful place to continue."),
      pageIds: [page.id]
    }));
}

function coverageNote(input, settings) {
  return localizedText(
    settings.languageMode,
    `已结合 ${input.coverage.includedPages} 个本机页面线索、${input.coverage.sampledEntries} 个页面摘要和当前打开标签页状态。`,
    `Used ${input.coverage.includedPages} local page signals, ${input.coverage.sampledEntries} page summaries, and current open-tab state.`
  );
}

function normalizeEntryMap(cache) {
  return cache?.entries && typeof cache.entries === "object" ? cache.entries : {};
}

function normalizeLifecycleSessions(log) {
  return log?.sessions && typeof log.sessions === "object" ? Object.values(log.sessions) : [];
}

function normalizeEvents(log) {
  return Array.isArray(log?.events) ? log.events : [];
}

function entryOverlapsRange(entry, range) {
  return anyTimeInRange([entry.firstSeenAt, entry.lastSeenAt, entry.sampledAt, entry.lastUsedAt], range);
}

function sessionOverlapsRange(session, range) {
  return intervalOverlaps(session.openedAt || session.firstObservedAt, session.closedAt || session.lastObservedAt, range);
}

function anyTimeInRange(values, range) {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  return values.some((value) => {
    const time = Date.parse(value || "");
    return Number.isFinite(time) && time >= from && time <= to;
  });
}

function intervalOverlaps(startValue, endValue, range) {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const start = Date.parse(startValue || "");
  const end = Date.parse(endValue || startValue || "");
  if (!Number.isFinite(start) && !Number.isFinite(end)) return false;
  return (Number.isFinite(start) ? start : end) <= to && (Number.isFinite(end) ? end : start) >= from;
}

function pageCacheKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `u_${stableHash(`${url.protocol}//${url.hostname}${url.pathname}`)}`;
  } catch {
    return "";
  }
}

function hostnameFromOrigin(origin) {
  try {
    return new URL(String(origin || "").replace(/\*$/, "")).hostname;
  } catch {
    return "";
  }
}

function latestIso(...values) {
  return values
    .map((value) => ({ value, time: Date.parse(value || "") }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => right.time - left.time)[0]?.value || "";
}

function earliestIso(...values) {
  return values
    .map((value) => ({ value, time: Date.parse(value || "") }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time)[0]?.value || "";
}

function compareIsoDesc(left, right) {
  return Date.parse(right || "") - Date.parse(left || "");
}

function ageMs(value, nowValue) {
  const now = Date.parse(nowValue || "");
  const time = Date.parse(value || "");
  if (!Number.isFinite(now) || !Number.isFinite(time)) return 0;
  return Math.max(0, now - time);
}

function rangeLabel(rangeMs, preset) {
  if (preset === "today") return "today";
  const days = Math.max(1, Math.round(rangeMs / DAY_MS));
  return `${days}d`;
}

function dominantToken(page) {
  const tokens = titleTokens([page.title, page.summary?.title, page.summary?.metaDescription, ...(page.summary?.headings || [])].join(" "));
  return tokens[0] || "";
}

function titleTokens(text) {
  const counts = new Map();
  for (const token of String(text || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) || []) {
    if (STOP_WORDS.has(token) || token.length < 3) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([token]) => token);
}

function titleForBucket(key, page) {
  if (page.currentGroupTitle) return page.currentGroupTitle;
  if (page.summary?.contentKind) return page.summary.contentKind;
  if (key === page.hostname) return page.hostname;
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pageIdForTabId(input, tabId) {
  const page = (input.pages || []).find((item) => item.tabId === tabId);
  return page?.id || null;
}

function uniqueNumbers(values) {
  return [...new Set(asArray(values).map((value) => Number(value?.id ?? value)).filter(Number.isInteger))];
}

function normalizeConfidence(value) {
  return ["high", "medium", "low"].includes(value) ? value : "medium";
}

function normalizePriority(value) {
  return ["high", "medium", "low"].includes(value) ? value : "medium";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
