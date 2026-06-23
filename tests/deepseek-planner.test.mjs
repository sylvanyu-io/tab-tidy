import assert from "node:assert/strict";
import test from "node:test";
import { createDeepSeekPlan, parsePlanFromDeepSeekResponse } from "../src/core/deepseek-planner.js";
import { DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";

test("DeepSeek planner posts a JSON-mode chat-completions request", async () => {
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [{ tabId: 10, windowId: 1 }],
    excludedTabs: [],
    groups: [
      {
        groupKey: "technical-docs",
        title: "Technical Docs",
        color: "cyan",
        confidence: 0.86,
        tabRefs: [{ tabId: 10, windowId: 1 }],
        reason: "API documentation tab."
      }
    ],
    reviewTabs: []
  };
  const inventory = {
    scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
    windows: [{ windowId: 1, tabCount: 1 }],
    plannerTabs: [{ tabId: 10, windowId: 1, title: "DeepSeek API docs", hostname: "api-docs.deepseek.com" }],
    excludedTabs: [],
    lockedGroups: []
  };

  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, "Bearer deepseek-test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "deepseek-chat");
    assert.equal(body.response_format.type, "json_object");
    assert.match(body.messages[0].content, /valid JSON only/);
    assert.match(body.messages[1].content, /DeepSeek API docs/);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createDeepSeekPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.DEEPSEEK, deepseekApiKey: "deepseek-test-key" },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("DeepSeek planner parses fenced JSON defensively", () => {
  const plan = parsePlanFromDeepSeekResponse({
    choices: [{ message: { content: "```json\n{\"schemaVersion\":1}\n```" } }]
  });
  assert.equal(plan.schemaVersion, 1);
});

test("DeepSeek planner requires an API key", async () => {
  await assert.rejects(
    () => createDeepSeekPlan({}, { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.DEEPSEEK }),
    /API key/
  );
});
