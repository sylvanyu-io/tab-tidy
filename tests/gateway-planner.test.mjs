import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayPlan } from "../src/core/gateway-planner.js";
import { DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";

const inventory = {
  scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
  windows: [{ windowId: 1, tabCount: 2 }],
  plannerTabs: [
    { tabId: 10, windowId: 1, title: "Structured output docs", hostname: "docs.example" },
    { tabId: 11, windowId: 1, title: "Chrome tabGroups API", hostname: "developer.chrome.com" }
  ],
  excludedTabs: [],
  lockedGroups: [],
  pageSamples: [
    {
      tabId: 10,
      windowId: 1,
      status: "ok",
      sample: { title: "Structured output docs", headings: ["JSON"], visibleText: "JSON schema output" }
    }
  ]
};

test("AI gateway planner posts a chat-completions JSON request", async () => {
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [
      { tabId: 10, windowId: 1 },
      { tabId: 11, windowId: 1 }
    ],
    excludedTabs: [],
    groups: [
      {
        groupKey: "developer-docs",
        title: "Developer Docs",
        color: "cyan",
        confidence: 0.88,
        tabRefs: [
          { tabId: 10, windowId: 1 },
          { tabId: 11, windowId: 1 }
        ],
        reason: "Developer documentation tabs."
      }
    ],
    reviewTabs: []
  };

  const fetchImpl = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:8317/v1/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, "Bearer gateway-test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-5.5");
    assert.equal(body.response_format.type, "json_object");
    assert.match(body.messages[0].content, /JSON-only planner/);
    assert.match(body.messages[0].content, /tabRefs and reviewTabs/);
    assert.match(body.messages[1].content, /Structured output docs/);
    assert.match(body.messages[1].content, /Software engineering task input/);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.equal(payload.eligibleTabs[0].pageSample.status, "ok");
    assert.equal(payload.pageSampleResults[0].status, "ok");
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("AI gateway planner sends reasoning effort only when explicitly selected", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.reasoning_effort, "high");
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  mode: "current_window",
                  scope: { kind: "current_window", windowIds: [1] },
                  targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
                  eligibleTabs: [
                    { tabId: 10, windowId: 1 },
                    { tabId: 11, windowId: 1 }
                  ],
                  excludedTabs: [],
                  groups: [],
                  reviewTabs: [
                    { tabId: 10, windowId: 1, reason: "Review." },
                    { tabId: 11, windowId: 1, reason: "Review." }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayApiKey: "gateway-test-key",
      gatewayThinkingIntensity: "high"
    },
    fetchImpl
  );
});

test("AI gateway planner adapts common tabIds output and strips markdown fences", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content:
                "```json\n" +
                JSON.stringify({
                  groups: [
                    {
                      name: "Developer Docs",
                      color: "green",
                      tabIds: [10, 11],
                      confidence: 0.84,
                      reasoning: "Both tabs are developer documentation."
                    }
                  ],
                  ungrouped: []
                }) +
                "\n```"
            }
          }
        ]
      };
    }
  });

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
    fetchImpl
  );

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.groups[0].title, "Developer Docs");
  assert.deepEqual(plan.groups[0].tabRefs, [
    { tabId: 10, windowId: 1 },
    { tabId: 11, windowId: 1 }
  ]);
  assert.deepEqual(plan.reviewTabs, []);
});

test("AI gateway planner requires an API key", async () => {
  await assert.rejects(
    () => createGatewayPlan({}, { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY }),
    /API key/
  );
});
