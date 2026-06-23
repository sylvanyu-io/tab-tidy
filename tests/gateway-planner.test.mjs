import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayPlan } from "../src/core/gateway-planner.js";
import { validatePlan } from "../src/core/plan-validator.js";
import { DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";

const inventory = {
  scope: { kind: "current_window", currentWindowId: 1, windowIds: [1] },
  windows: [{ windowId: 1, tabCount: 2 }],
  plannerTabs: [
    { tabId: 10, windowId: 1, index: 0, sequenceIndex: 0, title: "Structured output docs", hostname: "docs.example" },
    { tabId: 11, windowId: 1, index: 1, sequenceIndex: 1, title: "Chrome tabGroups API", hostname: "developer.chrome.com" }
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
    assert.equal(body.reasoning_effort, "high");
    assert.match(body.messages[0].content, /JSON-only planner/);
    assert.match(body.messages[0].content, /tabRefs and reviewTabs/);
    assert.match(body.messages[0].content, /sequenceIndex and index/);
    assert.match(body.messages[1].content, /Structured output docs/);
    assert.match(body.messages[1].content, /Software engineering task input/);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.equal(payload.eligibleTabs[0].sequenceIndex, 0);
    assert.equal(payload.eligibleTabs[1].index, 1);
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

test("AI gateway planner maps ultra thinking to gateway-compatible high effort", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.reasoning_effort, "high");
    assert.match(body.messages[0].content, /ultra-high/);
    assert.match(body.messages[1].content, /"thinkingIntensity":"ultra"/);
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
      gatewayThinkingIntensity: "ultra"
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

test("AI gateway planner times out hanging requests", async () => {
  const fetchImpl = async () => new Promise(() => {});

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" },
        fetchImpl,
        { timeoutMs: 5 }
      ),
    /timed out after/
  );
});

test("AI gateway planner uses coarse then refine planning for large inventories", async () => {
  const largeInventory = {
    ...inventory,
    plannerTabs: [
      ...inventory.plannerTabs,
      { tabId: 12, windowId: 1, title: "React docs", hostname: "react.dev" },
      { tabId: 13, windowId: 1, title: "GitHub pull request", hostname: "github.com" },
      { tabId: 14, windowId: 1, title: "Home", hostname: "example.com" }
    ],
    tabs: [
      ...inventory.plannerTabs,
      { tabId: 12, windowId: 1, title: "React docs", hostname: "react.dev" },
      { tabId: 13, windowId: 1, title: "GitHub pull request", hostname: "github.com" },
      { tabId: 14, windowId: 1, title: "Home", hostname: "example.com" }
    ],
    pageSamples: []
  };
  const requests = [];
  const responses = [
    {
      buckets: [
        {
          bucketKey: "technical-docs",
          title: "Technical Docs",
          color: "cyan",
          confidence: 0.92,
          tabIds: [10, 11, 12],
          reason: "Broad technical documentation."
        },
        {
          bucketKey: "project-work",
          title: "Project Work",
          color: "blue",
          confidence: 0.9,
          tabIds: [13],
          reason: "Project workflow."
        }
      ],
      reviewTabIds: [14]
    },
    {
      schemaVersion: 1,
      mode: "current_window",
      scope: { kind: "current_window", windowIds: [1] },
      targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
      eligibleTabs: [
        { tabId: 10, windowId: 1 },
        { tabId: 11, windowId: 1 },
        { tabId: 12, windowId: 1 }
      ],
      excludedTabs: [],
      groups: [
        {
          groupKey: "browser-extension-docs",
          title: "Extension Docs",
          color: "cyan",
          confidence: 0.9,
          tabRefs: [
            { tabId: 10, windowId: 1 },
            { tabId: 11, windowId: 1 }
          ],
          reason: "Chrome extension documentation."
        },
        {
          groupKey: "frontend-docs",
          title: "Frontend Docs",
          color: "green",
          confidence: 0.85,
          tabRefs: [{ tabId: 12, windowId: 1 }],
          reason: "React documentation."
        }
      ],
      reviewTabs: []
    },
    {
      schemaVersion: 1,
      mode: "current_window",
      scope: { kind: "current_window", windowIds: [1] },
      targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
      eligibleTabs: [{ tabId: 14, windowId: 1 }],
      excludedTabs: [],
      groups: [],
      reviewTabs: [{ tabId: 14, windowId: 1, reason: "Generic title." }]
    }
  ];

  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(responses[requests.length - 1]) } }] };
      }
    };
  };

  const settings = { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" };
  const plan = await createGatewayPlan(largeInventory, settings, fetchImpl, {
    hierarchical: true,
    refineBucketMinTabs: 3
  });
  const validation = validatePlan(plan, largeInventory, settings);

  assert.equal(requests.length, 3);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests[1].reasoning_effort, "high");
  assert.match(requests[0].messages[0].content, /fast first-pass/);
  assert.match(requests[1].messages[0].content, /JSON-only planner/);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    [...plan.groups.flatMap((group) => group.tabRefs.map((ref) => ref.tabId)), ...plan.reviewTabs.map((ref) => ref.tabId)].sort(
      (left, right) => left - right
    ),
    [10, 11, 12, 13, 14]
  );
});

test("AI gateway planner splits oversized coarse buckets before refinement", async () => {
  const plannerTabs = [10, 11, 12, 13, 14].map((tabId) => ({
    tabId,
    windowId: 1,
    title: `Large bucket tab ${tabId}`,
    hostname: "example.com"
  }));
  const largeInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];
  const responses = [
    {
      buckets: [
        {
          bucketKey: "large",
          title: "Large Bucket",
          color: "blue",
          confidence: 0.95,
          tabIds: [10, 11, 12, 13, 14],
          reason: "Too broad."
        }
      ],
      reviewTabIds: []
    },
    planForRefs([10, 11], "Part One"),
    planForRefs([12, 13], "Part Two"),
    planForRefs([14], "Part Three")
  ];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(responses[requests.length - 1]) } }] };
      }
    };
  };
  const settings = { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key" };
  const plan = await createGatewayPlan(largeInventory, settings, fetchImpl, {
    hierarchical: true,
    refineBucketMinTabs: 2,
    refineMaxTabsPerRequest: 2
  });
  const validation = validatePlan(plan, largeInventory, settings);

  assert.equal(requests.length, 4);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests.slice(1).every((request) => request.reasoning_effort === "high"), true);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.equal(plan.groups.length, 3);
});

function planForRefs(tabIds, title) {
  return {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: tabIds.map((tabId) => ({ tabId, windowId: 1 })),
    excludedTabs: [],
    groups: [
      {
        groupKey: title.toLowerCase().replace(/\s+/g, "-"),
        title,
        color: "blue",
        confidence: 0.86,
        tabRefs: tabIds.map((tabId) => ({ tabId, windowId: 1 })),
        reason: "Refined chunk."
      }
    ],
    reviewTabs: []
  };
}
