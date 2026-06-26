import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
import { BENCHMARK_SCENARIOS, buildBenchmarkInventory, parseBenchmarkScenarios } from "./planner-benchmark-fixtures.mjs";

const DEFAULT_SIZES = [120, 300, 400];
const DEFAULT_BENCHMARK_TIMEOUT_MS = 180_000;
const DEFAULT_STRATEGY_TIMEOUT_MS = 240_000;
const sizes = parseSizes(process.env.BENCHMARK_TAB_COUNTS || "");
const scenarios = parseBenchmarkScenarios(process.env.BENCHMARK_SCENARIOS || "");
const runId = `planner-scale-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const dataDir = resolve("docs/benchmarks/data");
const dataPath = resolve(dataDir, `${runId}.json`);
const reportPath = resolve(process.env.BENCHMARK_REPORT_PATH || "docs/benchmarks/gateway-planner-scale.md");

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

const allStrategies = [
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
const selectedStrategyKeys = selectedStrategies(allStrategies.map((strategy) => strategy.key));
const strategies = allStrategies.filter((strategy) => selectedStrategyKeys.has(strategy.key));

const results = [];

async function runStrategy({ inventory, tabCount, scenario, strategy }) {
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
    scenario,
    scenarioLabel: BENCHMARK_SCENARIOS[scenario]?.label || scenario,
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
    scenarios,
    strategyOrder: strategies.map(({ key, label }) => ({ key, label })),
    scenarioOrder: scenarios.map((scenario) => ({
      key: scenario,
      label: BENCHMARK_SCENARIOS[scenario]?.label || scenario,
      description: BENCHMARK_SCENARIOS[scenario]?.description || ""
    })),
    strategyFilter: process.env.BENCHMARK_STRATEGIES || "",
    scenarioFilter: process.env.BENCHMARK_SCENARIOS || "",
    environment: {
      node: process.version,
      gatewayBaseUrl: settings.gatewayBaseUrl || "built-in default",
      gatewayModel: settings.gatewayModel,
      gatewayThinkingIntensity: settings.gatewayThinkingIntensity,
      requestTimeoutMs: Number(process.env.BENCHMARK_TIMEOUT_MS || DEFAULT_BENCHMARK_TIMEOUT_MS),
      strategyTimeoutMs: Number(process.env.BENCHMARK_STRATEGY_TIMEOUT_MS || DEFAULT_STRATEGY_TIMEOUT_MS),
      pageContext: scenarios.includes("low_signal_samples")
        ? "synthetic inventory with optional page summary snippets"
        : "metadata-only synthetic inventory",
      note: "Synthetic browser tabs only; no user browsing data or gateway keys are stored."
    },
    results
  };
  await writeFile(dataPath, JSON.stringify(payload, null, 2));
  await writeFile(reportPath, renderReport(payload));
}

function renderReport(payload) {
  const completed = payload.results.filter((result) => result.finishedAt);
  const strategyKeys = new Set(payload.strategyOrder.map((strategy) => strategy.key));
  const intro = strategyKeys.has("hierarchical") && strategyKeys.has("single_full_detail")
    ? "This benchmark compares the current hierarchical coarse/refine planner path against a forced single full-detail planner request."
    : "This benchmark records a filtered planner strategy run.";
  const lines = [
    "# Gateway Planner Scale Benchmark",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    `${intro} It uses synthetic tab inventories, so it measures gateway planning latency and output shape without reading real browsing data.`,
    "",
    "## Configuration",
    "",
    `- Gateway: ${payload.environment.gatewayBaseUrl}`,
    `- Model: ${payload.environment.gatewayModel}`,
    `- Thinking intensity: ${payload.environment.gatewayThinkingIntensity}`,
    payload.strategyFilter ? `- Strategy filter: ${payload.strategyFilter}` : "- Strategy filter: none",
    payload.scenarioFilter ? `- Scenario filter: ${payload.scenarioFilter}` : "- Scenario filter: task_bursts",
    `- Page content: ${payload.environment.pageContext}`,
    `- Raw data: \`docs/benchmarks/data/${runId}.json\``,
    "",
    "## Scenario Coverage",
    "",
    ...payload.scenarioOrder.map((scenario) => `- ${scenario.label}: ${scenario.description}`),
    "",
    "## Results",
    "",
    "| Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Grouped Tabs | Review Tabs | Validation |",
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |"
  ];

  for (const result of completed) {
    lines.push(
      [
        result.scenarioLabel || result.scenario || "task_bursts",
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
  lines.push(
    strategyKeys.has("hierarchical") && strategyKeys.has("single_full_detail")
      ? "- Both strategies use the same synthetic inventory for each tab count."
      : "- This filtered run should be compared against a separate baseline report."
  );
  lines.push("- The hierarchical strategy may issue one coarse request plus one or more refinement requests.");
  if (strategyKeys.has("single_full_detail")) {
    lines.push("- The single full-detail strategy sends every eligible tab in one planner request.");
  }
  lines.push("- Full request/response metadata, normalized plans, previews, and validation output are stored in the JSON data file.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function summarizeConclusions(completed) {
  const conclusions = [];
  const strategyKeys = new Set(strategies.map((strategy) => strategy.key));
  if (!strategyKeys.has("hierarchical") || !strategyKeys.has("single_full_detail")) {
    for (const result of completed) {
      if (result.strategy !== "hierarchical") continue;
      conclusions.push(
        `${result.tabCount} tabs: hierarchical completed ${result.ok ? "successfully" : "with failure"} in ${formatSeconds(
          result.elapsedMs
        )} with ${result.requestCount} request(s).`
      );
    }
    if (!conclusions.length) conclusions.push("This filtered benchmark did not complete any comparable strategy rows.");
    return conclusions;
  }

  for (const scenario of scenarios) {
    for (const tabCount of sizes) {
      const pair = completed.filter((result) => result.scenario === scenario && result.tabCount === tabCount);
      const hierarchical = pair.find((result) => result.strategy === "hierarchical");
      const single = pair.find((result) => result.strategy === "single_full_detail");
      if (!hierarchical || !single || !hierarchical.ok || !single.ok) continue;
      const deltaMs = single.elapsedMs - hierarchical.elapsedMs;
      const ratio = hierarchical.elapsedMs ? single.elapsedMs / hierarchical.elapsedMs : 0;
      const direction = Math.abs(deltaMs) < 2000 ? "roughly tied with" : deltaMs < 0 ? "faster than" : "slower than";
      conclusions.push(
        `${BENCHMARK_SCENARIOS[scenario]?.label || scenario}, ${tabCount} tabs: single full-detail was ${direction} hierarchical (${formatSeconds(single.elapsedMs)} vs ${formatSeconds(
          hierarchical.elapsedMs
        )}, ${ratio.toFixed(2)}x).`
      );
    }
  }

  const successfulSingles = completed.filter((result) => result.strategy === "single_full_detail" && result.ok);
  if (successfulSingles.length === sizes.length * scenarios.length) {
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    conclusions.push(
      minSize === maxSize
        ? `Single full-detail planning completed successfully at the measured ${minSize}-tab size.`
        : `Single full-detail planning completed successfully at every measured size from ${minSize} to ${maxSize} tabs.`
    );
  }

  if (!conclusions.length) conclusions.push("The benchmark did not complete enough successful pairs to draw a latency conclusion.");
  return conclusions;
}

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

function selectedStrategies(knownKeys) {
  const parsed = String(process.env.BENCHMARK_STRATEGIES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = new Set(parsed.length ? parsed : ["hierarchical", "single_full_detail"]);
  const known = new Set(knownKeys);
  const unknown = [...selected].filter((item) => !known.has(item));
  if (unknown.length) {
    throw new Error(`Unknown BENCHMARK_STRATEGIES value(s): ${unknown.join(", ")}. Known values: ${knownKeys.join(", ")}.`);
  }
  if (!selected.size) {
    throw new Error("BENCHMARK_STRATEGIES selected no benchmark strategies.");
  }
  return selected;
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
  await mkdir(dirname(reportPath), { recursive: true });

  for (const scenario of scenarios) {
    for (const tabCount of sizes) {
      const inventory = buildBenchmarkInventory(tabCount, { scenario, windowCount: 4 });
      for (const strategy of strategies) {
        console.log(`[benchmark] ${scenario} / ${tabCount} tabs / ${strategy.key} starting`);
        const result = await runStrategy({ inventory, tabCount, scenario, strategy });
        results.push(result);
        console.log(
          `[benchmark] ${scenario} / ${tabCount} tabs / ${strategy.key} ${result.ok ? "ok" : "failed"} in ${formatSeconds(result.elapsedMs)}`
        );
        await writeOutputs({ partial: true });
      }
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
          scenario: result.scenario,
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
