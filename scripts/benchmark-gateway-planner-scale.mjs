import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { buildPreview } from "../src/core/preview.js";
import { createGatewayPlan } from "../src/core/gateway-planner.js";
import { validatePlan } from "../src/core/plan-validator.js";
import {
  DEFAULT_SETTINGS,
  EXISTING_GROUP_MODES,
  ORGANIZE_MODES,
  PLANNER_PROVIDERS,
  PROMPT_PRESETS,
  REVIEW_GROUP_MODES,
  TARGET_WINDOW_MODES,
  THINKING_INTENSITIES
} from "../src/shared/settings.js";

const DEFAULT_SIZES = [120, 300, 400];
const DEFAULT_BENCHMARK_TIMEOUT_MS = 180_000;
const DEFAULT_STRATEGY_TIMEOUT_MS = 240_000;
const sizes = parseSizes(process.env.BENCHMARK_TAB_COUNTS || "");
const runId = `planner-scale-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const dataDir = resolve("docs/benchmarks/data");
const reportDir = resolve("docs/benchmarks");
const dataPath = resolve(dataDir, `${runId}.json`);
const reportPath = resolve(reportDir, "gateway-planner-scale.md");

const settings = {
  ...DEFAULT_SETTINGS,
  plannerProvider: PLANNER_PROVIDERS.GATEWAY,
  organizeMode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
  targetWindowMode: TARGET_WINDOW_MODES.CURRENT_WINDOW,
  existingGroupMode: EXISTING_GROUP_MODES.DISSOLVE,
  reviewGroupMode: REVIEW_GROUP_MODES.CREATE,
  promptPreset: PROMPT_PRESETS.CONSERVATIVE,
  gatewayBaseUrl: process.env.GATEWAY_BASE_URL || "",
  gatewayApiKey: process.env.GATEWAY_API_KEY || "",
  gatewayModel: process.env.GATEWAY_MODEL || DEFAULT_SETTINGS.gatewayModel,
  gatewayThinkingIntensity: process.env.GATEWAY_THINKING_INTENSITY || THINKING_INTENSITIES.HIGH,
  customPrompt:
    "Benchmark run. Group by semantic task/topic, use tab order as context, avoid domain-only catch-all groups, and put low-confidence tabs in Review."
};

const strategies = [
  {
    key: "hierarchical",
    label: "current hierarchical coarse/refine",
    options: { hierarchical: true }
  },
  {
    key: "single_full_detail",
    label: "single full-detail request",
    options: { hierarchical: false }
  }
];

const results = [];

async function runStrategy({ inventory, tabCount, strategy }) {
  const requests = [];
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let plan = null;
  let validation = null;
  let preview = null;
  let error = null;
  const abortController = new AbortController();

  try {
    plan = await withTimeout(
      createGatewayPlan(inventory, settings, measuredFetch(requests), {
        ...strategy.options,
        installId: `benchmark-${runId}`,
        signal: abortController.signal,
        timeoutMs: Number(process.env.BENCHMARK_TIMEOUT_MS || DEFAULT_BENCHMARK_TIMEOUT_MS),
        onProgress: (event) => {
          requests.push({
            type: "progress",
            at: new Date().toISOString(),
            event
          });
          console.log(`[benchmark] ${tabCount} tabs / ${strategy.key}: ${event.phase} ${event.progress ?? ""} ${event.message ?? ""}`.trim());
        }
      }),
      Number(process.env.BENCHMARK_STRATEGY_TIMEOUT_MS || DEFAULT_STRATEGY_TIMEOUT_MS),
      () => abortController.abort(),
      `${tabCount} tabs / ${strategy.key}`
    );
    validation = validatePlan(plan, inventory, settings);
    preview = buildPreview(plan, inventory, validation, settings);
  } catch (caught) {
    error = {
      name: caught?.name || "Error",
      message: caught?.message || String(caught)
    };
  }

  const elapsedMs = Math.round(performance.now() - started);
  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    tabCount,
    windowCount: inventory.windows.length,
    strategy: strategy.key,
    strategyLabel: strategy.label,
    settings: redactSettings(settings),
    inventory: compactInventoryForPersistence(inventory),
    ok: !error && Boolean(validation?.ok),
    elapsedMs,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
    requestCount: requests.filter((request) => request.type === "fetch").length,
    progressEvents: requests.filter((request) => request.type === "progress"),
    requests: requests.filter((request) => request.type === "fetch"),
    validation,
    preview,
    plan,
    error
  };
}

function measuredFetch(records) {
  return async (url, options = {}) => {
    const requestStarted = performance.now();
    const bodyText = String(options.body || "");
    const body = parseJsonOrNull(bodyText);
    const record = {
      type: "fetch",
      index: records.filter((item) => item.type === "fetch").length + 1,
      url,
      startedAt: new Date().toISOString(),
      requestBytes: Buffer.byteLength(bodyText, "utf8"),
      request: body ? sanitizeRequestBody(body) : null
    };
    records.push(record);

    try {
      const response = await fetch(url, options);
      const responseText = await response.text();
      record.finishedAt = new Date().toISOString();
      record.elapsedMs = Math.round(performance.now() - requestStarted);
      record.status = response.status;
      record.ok = response.ok;
      record.responseBytes = Buffer.byteLength(responseText, "utf8");
      record.response = parseJsonOrText(responseText);

      return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (error) {
      record.finishedAt = new Date().toISOString();
      record.elapsedMs = Math.round(performance.now() - requestStarted);
      record.ok = false;
      record.error = {
        name: error?.name || "Error",
        message: error?.message || String(error)
      };
      throw error;
    }
  };
}

async function writeOutputs({ partial }) {
  const payload = {
    schema: "tab_tidy_gateway_planner_scale_benchmark_v1",
    runId,
    generatedAt: new Date().toISOString(),
    partial,
    sizes,
    strategyOrder: strategies.map(({ key, label }) => ({ key, label })),
    environment: {
      node: process.version,
      gatewayBaseUrl: settings.gatewayBaseUrl || "built-in default",
      gatewayModel: settings.gatewayModel,
      gatewayThinkingIntensity: settings.gatewayThinkingIntensity,
      requestTimeoutMs: Number(process.env.BENCHMARK_TIMEOUT_MS || DEFAULT_BENCHMARK_TIMEOUT_MS),
      strategyTimeoutMs: Number(process.env.BENCHMARK_STRATEGY_TIMEOUT_MS || DEFAULT_STRATEGY_TIMEOUT_MS),
      pageContext: "metadata-only synthetic inventory",
      note: "Synthetic browser tabs only; no user browsing data or gateway keys are stored."
    },
    results
  };
  await writeFile(dataPath, JSON.stringify(payload, null, 2));
  await writeFile(reportPath, renderReport(payload));
}

function renderReport(payload) {
  const completed = payload.results.filter((result) => result.finishedAt);
  const lines = [
    "# Gateway Planner Scale Benchmark",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    "This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request. It uses synthetic metadata-only tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.",
    "",
    "## Configuration",
    "",
    `- Gateway: ${payload.environment.gatewayBaseUrl}`,
    `- Model: ${payload.environment.gatewayModel}`,
    `- Thinking intensity: ${payload.environment.gatewayThinkingIntensity}`,
    `- Page content: ${payload.environment.pageContext}`,
    `- Raw data: \`docs/benchmarks/data/${runId}.json\``,
    "",
    "## Results",
    "",
    "| Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |"
  ];

  for (const result of completed) {
    lines.push(
      [
        result.tabCount,
        result.strategyLabel,
        result.ok ? "ok" : "failed",
        formatSeconds(result.elapsedMs),
        result.requestCount,
        result.preview?.groups?.length ?? "-",
        result.preview?.groupedTabsCount ?? "-",
        result.preview?.reviewTabsCount ?? "-",
        result.validation?.ok ? "ok" : result.error?.message || result.validation?.errors?.join("; ") || "-"
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |")
    );
  }

  const conclusions = summarizeConclusions(completed);
  lines.push("", "## Takeaways", "");
  for (const item of conclusions) lines.push(`- ${item}`);

  lines.push("", "## Notes", "");
  lines.push("- Both strategies use the same synthetic inventory for each tab count.");
  lines.push("- The hierarchical strategy may issue one coarse request plus one or more refinement requests.");
  lines.push("- The single full-detail strategy sends every eligible tab in one planner request.");
  lines.push("- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function summarizeConclusions(completed) {
  const conclusions = [];
  for (const tabCount of sizes) {
    const pair = completed.filter((result) => result.tabCount === tabCount);
    const hierarchical = pair.find((result) => result.strategy === "hierarchical");
    const single = pair.find((result) => result.strategy === "single_full_detail");
    if (!hierarchical || !single || !hierarchical.ok || !single.ok) continue;
    const deltaMs = single.elapsedMs - hierarchical.elapsedMs;
    const ratio = hierarchical.elapsedMs ? single.elapsedMs / hierarchical.elapsedMs : 0;
    const direction = Math.abs(deltaMs) < 2000 ? "roughly tied with" : deltaMs < 0 ? "faster than" : "slower than";
    conclusions.push(
      `${tabCount} tabs: single full-detail was ${direction} hierarchical (${formatSeconds(single.elapsedMs)} vs ${formatSeconds(
        hierarchical.elapsedMs
      )}, ${ratio.toFixed(2)}x).`
    );
  }

  const successfulSingles = completed.filter((result) => result.strategy === "single_full_detail" && result.ok);
  if (successfulSingles.length === sizes.length) {
    conclusions.push(
      "Single full-detail planning completed successfully at every measured size, including the 300-400 tab range."
    );
  }

  if (!conclusions.length) conclusions.push("The benchmark did not complete enough successful pairs to draw a latency conclusion.");
  return conclusions;
}

function buildSyntheticInventory(tabCount, windowCount) {
  const windows = Array.from({ length: windowCount }, (_, index) => ({
    windowId: index + 1,
    type: "normal",
    focused: index === 0,
    incognito: false,
    tabCount: 0
  }));
  const tabs = [];
  const perWindow = Math.ceil(tabCount / windowCount);

  for (let index = 0; index < tabCount; index += 1) {
    const topic = topicForIndex(index);
    const window = windows[Math.min(windowCount - 1, Math.floor(index / perWindow))];
    const tab = buildSyntheticTab(index, topic, window.windowId, window.tabCount);
    window.tabCount += 1;
    tabs.push(tab);
  }

  return {
    schemaVersion: 1,
    mode: ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    scope: {
      kind: "all_normal_windows",
      currentWindowId: null,
      invocationWindowId: 1,
      windowIds: windows.map((window) => window.windowId)
    },
    windows,
    tabs,
    plannerTabs: tabs,
    excludedTabs: [],
    lockedGroups: [],
    pageSamples: [],
    collectedAt: new Date().toISOString()
  };
}

function buildSyntheticTab(index, topic, windowId, windowIndex) {
  const variant = topic.variants[index % topic.variants.length];
  const title =
    index % 11 === 0
      ? `${variant.genericTitle} ${String(index).padStart(3, "0")}`
      : `${topic.title} - ${variant.title} ${String(index).padStart(3, "0")}`;
  const path = `${topic.slug}/${variant.slug}/${index}`;
  return {
    tabId: 10_000 + index,
    windowId,
    index: windowIndex,
    sequenceIndex: index,
    title,
    audible: false,
    discarded: index % 17 === 0,
    pinned: false,
    active: windowIndex === 0,
    incognito: false,
    groupId: -1,
    groupTitle: "",
    groupColor: "",
    groupCollapsed: false,
    favIconUrl: "",
    sampleable: true,
    hostname: topic.hosts[index % topic.hosts.length],
    sanitizedUrl: `https://${topic.hosts[index % topic.hosts.length]}/${path}`,
    urlKind: "web",
    origin: `https://${topic.hosts[index % topic.hosts.length]}`
  };
}

function topicForIndex(index) {
  const session = Math.floor(index / 12);
  const topicIndex = (session * 7 + Math.floor(index / 3) + index) % TOPICS.length;
  return TOPICS[topicIndex];
}

const TOPICS = [
  {
    slug: "ai-coding",
    title: "AI coding agents",
    hosts: ["github.com", "docs.anthropic.com", "openai.com"],
    variants: [
      { slug: "codex", title: "Codex task orchestration notes", genericTitle: "Agent workbench" },
      { slug: "mcp", title: "MCP server integration docs", genericTitle: "Tooling reference" },
      { slug: "review", title: "Automated code review benchmark", genericTitle: "Evaluation page" }
    ]
  },
  {
    slug: "chrome-extension",
    title: "Chrome extension APIs",
    hosts: ["developer.chrome.com", "chromium.googlesource.com", "github.com"],
    variants: [
      { slug: "tabs", title: "tabs and tabGroups API reference", genericTitle: "API docs" },
      { slug: "sidepanel", title: "side panel lifecycle guide", genericTitle: "Extension guide" },
      { slug: "permissions", title: "optional host permissions behavior", genericTitle: "Permissions notes" }
    ]
  },
  {
    slug: "llm-evals",
    title: "LLM evaluation research",
    hosts: ["arxiv.org", "paperswithcode.com", "github.com"],
    variants: [
      { slug: "benchmarks", title: "agent benchmark paper", genericTitle: "Research paper" },
      { slug: "datasets", title: "task dataset discussion", genericTitle: "Dataset notes" },
      { slug: "leaderboard", title: "model leaderboard comparison", genericTitle: "Model comparison" }
    ]
  },
  {
    slug: "design",
    title: "Product UI design",
    hosts: ["figma.com", "mobbin.com", "linear.app"],
    variants: [
      { slug: "sidepanel", title: "compact side panel examples", genericTitle: "UI reference" },
      { slug: "switches", title: "settings switch patterns", genericTitle: "Interaction examples" },
      { slug: "readme", title: "open source README visual layout", genericTitle: "Showcase ideas" }
    ]
  },
  {
    slug: "cloudflare",
    title: "Cloudflare Worker gateway",
    hosts: ["developers.cloudflare.com", "dash.cloudflare.com", "github.com"],
    variants: [
      { slug: "workers", title: "Worker routing and secrets", genericTitle: "Gateway docs" },
      { slug: "tunnel", title: "Cloudflare tunnel diagnostics", genericTitle: "Tunnel notes" },
      { slug: "limits", title: "rate limit and abuse prevention", genericTitle: "Security checklist" }
    ]
  },
  {
    slug: "frontend",
    title: "Frontend implementation",
    hosts: ["react.dev", "developer.mozilla.org", "github.com"],
    variants: [
      { slug: "state", title: "state machine bug analysis", genericTitle: "Bug thread" },
      { slug: "css", title: "CSS panel layout refinement", genericTitle: "Layout notes" },
      { slug: "tests", title: "Playwright smoke test fixture", genericTitle: "Test plan" }
    ]
  },
  {
    slug: "data",
    title: "Database and SQL work",
    hosts: ["postgresql.org", "supabase.com", "stackoverflow.com"],
    variants: [
      { slug: "query", title: "query plan optimization", genericTitle: "SQL reference" },
      { slug: "index", title: "index strategy discussion", genericTitle: "Database notes" },
      { slug: "migration", title: "migration rollback checklist", genericTitle: "Schema checklist" }
    ]
  },
  {
    slug: "reading",
    title: "Read later queue",
    hosts: ["medium.com", "substack.com", "wikipedia.org"],
    variants: [
      { slug: "article", title: "long-form product essay", genericTitle: "Article" },
      { slug: "newsletter", title: "weekly AI newsletter", genericTitle: "Newsletter" },
      { slug: "reference", title: "background reference page", genericTitle: "Reference" }
    ]
  },
  {
    slug: "video",
    title: "Video and media queue",
    hosts: ["youtube.com", "bilibili.com", "vimeo.com"],
    variants: [
      { slug: "tutorial", title: "browser extension tutorial", genericTitle: "Video" },
      { slug: "talk", title: "AI product talk transcript", genericTitle: "Talk" },
      { slug: "playlist", title: "design teardown playlist", genericTitle: "Playlist" }
    ]
  },
  {
    slug: "finance",
    title: "Shopping and finance",
    hosts: ["stripe.com", "amazon.com", "bank.example"],
    variants: [
      { slug: "invoice", title: "invoice and billing portal", genericTitle: "Account page" },
      { slug: "checkout", title: "purchase comparison", genericTitle: "Shopping page" },
      { slug: "pricing", title: "subscription pricing review", genericTitle: "Pricing page" }
    ]
  }
];

function compactInventoryForPersistence(inventory) {
  return {
    ...inventory,
    tabs: inventory.tabs,
    plannerTabs: inventory.plannerTabs
  };
}

function sanitizeRequestBody(body) {
  return {
    ...body,
    messages: (body.messages || []).map((message) => ({
      role: message.role,
      content: message.content
    })),
    // The benchmark stores synthetic prompts but never persists credentials.
    stream: body.stream
  };
}

function redactSettings(value) {
  return {
    ...value,
    gatewayApiKey: value.gatewayApiKey ? "<redacted>" : ""
  };
}

function parseSizes(value) {
  const parsed = value
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item > 0);
  return parsed.length ? parsed : DEFAULT_SIZES;
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJsonOrText(value) {
  const parsed = parseJsonOrNull(value);
  return parsed || { rawText: String(value || "") };
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function withTimeout(promise, timeoutMs, onTimeout, label) {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return promise;

  let timeoutId = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`${label} exceeded benchmark strategy timeout after ${Math.round(timeout / 1000)} seconds.`));
        }, timeout);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(reportDir, { recursive: true });

  for (const tabCount of sizes) {
    const inventory = buildSyntheticInventory(tabCount, 4);
    for (const strategy of strategies) {
      console.log(`[benchmark] ${tabCount} tabs / ${strategy.key} starting`);
      const result = await runStrategy({ inventory, tabCount, strategy });
      results.push(result);
      console.log(
        `[benchmark] ${tabCount} tabs / ${strategy.key} ${result.ok ? "ok" : "failed"} in ${formatSeconds(result.elapsedMs)}`
      );
      await writeOutputs({ partial: true });
    }
  }

  await writeOutputs({ partial: false });
  console.log(
    JSON.stringify(
      {
        runId,
        dataPath,
        reportPath,
        rows: results.map((result) => ({
          tabs: result.tabCount,
          strategy: result.strategy,
          ok: result.ok,
          elapsedMs: result.elapsedMs,
          requests: result.requests.length,
          groups: result.preview?.groups?.length ?? null,
          groupedTabs: result.preview?.groupedTabsCount ?? null,
          reviewTabs: result.preview?.reviewTabsCount ?? null
        }))
      },
      null,
      2
    )
  );
}

await main();
