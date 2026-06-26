import { PROMPT_PRESETS } from "../src/shared/settings.js";

export function parseBenchmarkPromptPreset(value, fallback = PROMPT_PRESETS.CONSERVATIVE) {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  const known = Object.values(PROMPT_PRESETS);
  if (!known.includes(normalized)) {
    throw new Error(`Unknown BENCHMARK_PROMPT_PRESET value: ${normalized}. Known values: ${known.join(", ")}.`);
  }
  return normalized;
}

export function parseBenchmarkStrategies(value, knownKeys, fallback = ["hierarchical", "single_full_detail"]) {
  const parsed = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = new Set(parsed.length ? parsed : fallback);
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

export function buildBenchmarkRunId(now = new Date(), pid = process.pid) {
  return `planner-scale-${now.toISOString().replace(/[:.]/g, "-")}-pid${pid}`;
}
