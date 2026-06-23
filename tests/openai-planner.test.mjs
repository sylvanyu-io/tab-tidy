import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIPlan } from "../src/core/openai-planner.js";
import { DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";

test("OpenAI planner posts a structured-output Responses request", async () => {
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [{ tabId: 10, windowId: 1 }],
    excludedTabs: [],
    groups: [
      {
        groupKey: "ai-research",
        title: "AI Research",
        color: "purple",
        confidence: 0.88,
        tabRefs: [{ tabId: 10, windowId: 1 }],
        reason: "OpenAI docs and model references."
      }
    ],
    reviewTabs: []
  };
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    windows: [{ windowId: 1, tabCount: 1 }],
    plannerTabs: [{ tabId: 10, windowId: 1, title: "OpenAI docs", hostname: "platform.openai.com" }],
    excludedTabs: [],
    lockedGroups: [],
    pageSamples: [
      {
        tabId: 10,
        windowId: 1,
        status: "ok",
        sample: { title: "OpenAI docs", headings: ["Structured Outputs"], visibleText: "JSON schema output" }
      }
    ]
  };

  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, "Bearer test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-5.5");
    assert.match(body.instructions, /planner for a Chrome tab organization extension/);
    assert.match(body.input, /OpenAI docs/);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.name, "semantic_tab_action_plan");
    const payload = JSON.parse(body.input);
    assert.equal(payload.eligibleTabs[0].pageSample.status, "ok");
    assert.equal(payload.pageSampleResults[0].status, "ok");
    return {
      ok: true,
      async json() {
        return { output_text: JSON.stringify(expectedPlan) };
      }
    };
  };

  const plan = await createOpenAIPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.OPENAI, openaiApiKey: "test-key" },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("OpenAI planner requires an API key", async () => {
  await assert.rejects(
    () => createOpenAIPlan({}, { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.OPENAI }),
    /API key/
  );
});

test("OpenAI planner honors an OpenAI-compatible base URL", async () => {
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    windows: [{ windowId: 1, tabCount: 1 }],
    plannerTabs: [{ tabId: 10, windowId: 1, title: "Local model docs", hostname: "localhost" }],
    excludedTabs: [],
    lockedGroups: []
  };

  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [{ tabId: 10, windowId: 1 }],
    excludedTabs: [],
    groups: [],
    reviewTabs: [{ tabId: 10, windowId: 1, reason: "Insufficient context." }]
  };

  const fetchImpl = async (url) => {
    assert.equal(url, "http://127.0.0.1:8317/v1/responses");
    return {
      ok: true,
      async json() {
        return { output_text: JSON.stringify(expectedPlan) };
      }
    };
  };

  const plan = await createOpenAIPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.OPENAI,
      openaiApiKey: "test-key",
      openaiBaseUrl: "http://127.0.0.1:8317/v1/"
    },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});
