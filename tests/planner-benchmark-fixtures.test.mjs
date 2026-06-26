import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerPayload } from "../src/core/gateway-planner.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";
import { BENCHMARK_SCENARIOS, buildBenchmarkInventory, parseBenchmarkScenarios } from "../scripts/planner-benchmark-fixtures.mjs";

test("benchmark scenario parser supports all named coverage fixtures", () => {
  assert.deepEqual(parseBenchmarkScenarios(""), ["task_bursts"]);
  assert.deepEqual(parseBenchmarkScenarios("all"), Object.keys(BENCHMARK_SCENARIOS));
  assert.deepEqual(parseBenchmarkScenarios("domain_traps,media_type"), ["domain_traps", "media_type"]);
  assert.throws(() => parseBenchmarkScenarios("unknown"), /Unknown BENCHMARK_SCENARIOS/);
});

test("benchmark fixtures store ground truth without sending it to planner payload", () => {
  const inventory = buildBenchmarkInventory(24, { scenario: "low_signal_samples", windowCount: 3 });
  assert.equal(inventory.pageSamples.length, 24);
  assert.equal(Object.keys(inventory.benchmarkTruth.topicByTabId).length, 24);

  const payload = buildPlannerPayload(inventory, DEFAULT_SETTINGS);
  const sampleColumn = payload.tabs[0][payload.tabFields.indexOf("pageSample")];
  assert.equal(sampleColumn[payload.pageSampleFields.indexOf("status")], "ok");
  assert.match(sampleColumn[payload.pageSampleFields.indexOf("visibleText")], /Codex|Chrome extension|Model evaluation/);

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("benchmarkTruth"), false);
  assert.equal(serialized.includes("topicByTabId"), false);
  assert.equal(serialized.includes("familyByTabId"), false);
  assert.equal(serialized.includes("staleCandidateByTabId"), false);
});

test("domain trap fixture reuses hosts across unrelated semantic topics", () => {
  const inventory = buildBenchmarkInventory(60, { scenario: "domain_traps", windowCount: 4 });
  const topicsByHost = new Map();
  for (const tab of inventory.plannerTabs) {
    const topics = topicsByHost.get(tab.hostname) || new Set();
    topics.add(inventory.benchmarkTruth.topicByTabId[tab.tabId]);
    topicsByHost.set(tab.hostname, topics);
  }

  assert.ok([...topicsByHost.values()].some((topics) => topics.size >= 4));
});

test("media type fixture uses media categories as evaluation truth", () => {
  const inventory = buildBenchmarkInventory(60, { scenario: "media_type", windowCount: 4 });
  const topicValues = new Set(Object.values(inventory.benchmarkTruth.topicByTabId));
  assert.ok(topicValues.has("video"));
  assert.ok(topicValues.has("docs"));
  assert.ok(topicValues.has("paper"));
});

test("multi-window fixture spreads related topics across windows", () => {
  const inventory = buildBenchmarkInventory(80, { scenario: "multi_window", windowCount: 5 });
  const windowsByTopic = new Map();
  for (const tab of inventory.plannerTabs) {
    const topic = inventory.benchmarkTruth.topicByTabId[tab.tabId];
    const windows = windowsByTopic.get(topic) || new Set();
    windows.add(tab.windowId);
    windowsByTopic.set(topic, windows);
  }

  assert.ok([...windowsByTopic.values()].some((windows) => windows.size >= 3));
});
