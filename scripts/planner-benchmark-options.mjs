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
