import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerSystemPrompt, createGatewayPlan } from "../src/core/gateway-planner.js";
import { validatePlan } from "../src/core/plan-validator.js";
import { DEFAULT_SETTINGS, GATEWAY_CUSTOM_MODEL_VALUE, PLANNER_PROVIDERS, PROMPT_PRESETS } from "../src/shared/settings.js";

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

test("planner prompt includes the selected organization preset", () => {
  const prompt = buildPlannerSystemPrompt({
    ...DEFAULT_SETTINGS,
    promptPreset: PROMPT_PRESETS.MEDIA_TYPE
  });

  assert.match(prompt, /media type/);
  assert.match(prompt, /code\/issues\/PRs/);
  assert.match(prompt, /shopping\/finance/);
});

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
    assert.equal(url, "http://localhost:8317/v1/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, "Bearer gateway-test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-5.5");
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.reasoning_effort, "high");
    assert.match(body.messages[0].content, /JSON-only planner/);
    assert.match(body.messages[0].content, /compact output/);
    assert.match(body.messages[0].content, /sequenceIndex and index/);
    assert.match(body.messages[0].content, /Write every user-facing string in English/);
    assert.match(body.messages[1].content, /Structured output docs/);
    assert.match(body.messages[1].content, /Software engineering task input/);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.equal(payload.schema, "tab_tidy_compact_v1");
    assert.equal(payload.settings.languageMode, "en-US");
    assert.deepEqual(payload.excludedFields, ["id", "windowId", "reason"]);
    assert.deepEqual(payload.tabFields, [
      "id",
      "windowId",
      "index",
      "sequenceIndex",
      "title",
      "hostname",
      "sanitizedUrl",
      "urlKind",
      "audible",
      "discarded",
      "sampleable",
      "existingGroup",
      "pageSample"
    ]);
    const firstTab = rowToObject(payload.tabFields, payload.tabs[0]);
    const secondTab = rowToObject(payload.tabFields, payload.tabs[1]);
    assert.equal(firstTab.sequenceIndex, 0);
    assert.equal(secondTab.index, 1);
    assert.deepEqual(payload.pageSampleFields, ["status", "title", "metaDescription", "language", "headings", "visibleText", "reason"]);
    const firstSample = rowToObject(payload.pageSampleFields, firstTab.pageSample);
    assert.equal(firstSample.status, "ok");
    assert.equal(firstSample.visibleText, "JSON schema output");
    assert.equal(rowToObject(payload.pageSampleResultFields, payload.pageSampleResults[0]).status, "ok");
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key",
      languageMode: "en-US"
    },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("AI gateway planner sends a custom model name to custom gateways", async () => {
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
        groupKey: "docs",
        title: "Docs",
        color: "blue",
        confidence: 0.9,
        tabRefs: [
          { tabId: 10, windowId: 1 },
          { tabId: 11, windowId: 1 }
        ],
        reason: "Documentation tabs."
      }
    ],
    reviewTabs: []
  };

  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "glm-5.2");
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(options.headers.authorization, "Bearer glm-key");
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "https://open.bigmodel.cn/api/paas/v4/",
      gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
      gatewayCustomModel: "glm-5.2",
      gatewayApiKey: "glm-key",
      languageMode: "en-US"
    },
    fetchImpl
  );

  assert.deepEqual(plan, expectedPlan);
});

test("AI gateway planner rejects custom models on the built-in gateway", async () => {
  await assert.rejects(
    createGatewayPlan(
      inventory,
      {
        ...DEFAULT_SETTINGS,
        plannerProvider: PLANNER_PROVIDERS.GATEWAY,
        gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
        gatewayCustomModel: "glm-5.2"
      },
      async () => {
        throw new Error("fetch should not be called");
      }
    ),
    /自定义模型名需要先填写自定义 AI 网关地址/
  );
});

test("AI gateway planner rejects blank custom model names", async () => {
  await assert.rejects(
    createGatewayPlan(
      inventory,
      {
        ...DEFAULT_SETTINGS,
        plannerProvider: PLANNER_PROVIDERS.GATEWAY,
        gatewayBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
        gatewayModel: GATEWAY_CUSTOM_MODEL_VALUE,
        gatewayCustomModel: ""
      },
      async () => {
        throw new Error("fetch should not be called");
      }
    ),
    /请填写自定义模型名/
  );
});

test("AI gateway payload omits excluded tab titles", async () => {
  const sensitiveInventory = {
    ...inventory,
    excludedTabs: [
      {
        tabId: 99,
        windowId: 1,
        title: "Private bank account recovery phrase",
        exclusionReason: "Pinned tabs are excluded by policy."
      }
    ]
  };
  const expectedPlan = {
    schemaVersion: 1,
    mode: "current_window",
    scope: { kind: "current_window", windowIds: [1] },
    targetWindow: { kind: "current_window", windowId: 1, title: "Current Window" },
    eligibleTabs: [
      { tabId: 10, windowId: 1 },
      { tabId: 11, windowId: 1 }
    ],
    excludedTabs: [{ tabId: 99, windowId: 1, reason: "Pinned tabs are excluded by policy." }],
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

  const fetchImpl = async (_url, options) => {
    const bodyText = options.body;
    assert.doesNotMatch(bodyText, /Private bank account recovery phrase/);
    const body = JSON.parse(bodyText);
    const payload = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("{")));
    assert.deepEqual(payload.excludedFields, ["id", "windowId", "reason"]);
    assert.deepEqual(payload.excluded, [[99, 1, "Pinned tabs are excluded by policy."]]);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(expectedPlan) } }] };
      }
    };
  };

  const plan = await createGatewayPlan(
    sensitiveInventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: "gateway-test-key"
    },
    fetchImpl
  );

  assert.deepEqual(plan.excludedTabs, expectedPlan.excludedTabs);
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
                "Here is the JSON plan:\n``` json\n" +
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
                "\n```\n"
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

test("AI gateway planner adapts schemaVersion one plans that still use tabIds", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                schemaVersion: 1,
                groups: [
                  {
                    title: "Developer Docs",
                    color: "cyan",
                    tabIds: [10, 11],
                    confidence: 0.84,
                    reason: "Both tabs are developer documentation."
                  }
                ],
                review: []
              })
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

  const validation = validatePlan(plan, inventory, {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key"
  });

  assert.equal(validation.ok, true);
  assert.equal(plan.groups[0].title, "Developer Docs");
  assert.deepEqual(plan.groups[0].tabRefs, [
    { tabId: 10, windowId: 1 },
    { tabId: 11, windowId: 1 }
  ]);
});

test("AI gateway planner adapts compact ids output", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                schema: "tab_tidy_plan_compact_v1",
                groups: [
                  {
                    key: "developer-docs",
                    title: "Developer Docs",
                    color: "cyan",
                    confidence: 0.88,
                    ids: [11, 10],
                    reason: "Both tabs are developer documentation."
                  }
                ],
                review: [{ id: 999, reason: "Unknown tab should be ignored." }]
              })
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
  assert.equal(plan.groups[0].groupKey, "developer-docs");
  assert.deepEqual(plan.groups[0].tabRefs, [
    { tabId: 10, windowId: 1 },
    { tabId: 11, windowId: 1 }
  ]);
  assert.deepEqual(plan.reviewTabs, []);
});

test("AI gateway planner can call a custom free gateway without an API key", async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers["content-type"], "application/json");
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

  const plan = await createGatewayPlan(
    inventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://localhost:8317/v1",
      gatewayApiKey: ""
    },
    fetchImpl
  );
  assert.equal(plan.reviewTabs.length, 2);
});

test("AI gateway planner uses the default free gateway without exposing authorization", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://cliproxy.sylvanyu.io/v1/chat/completions");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers["x-tab-tidy-install-id"], "install-test");
    assert.equal(options.headers["x-tab-tidy-page-summary"], "1");
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

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "" },
    fetchImpl,
    { installId: "install-test" }
  );
  assert.equal(plan.reviewTabs.length, 2);
});

test("AI gateway planner ignores stale user keys for the built-in free gateway", async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers["x-tab-tidy-install-id"], "install-test");
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

  const plan = await createGatewayPlan(
    inventory,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "stale-key" },
    fetchImpl,
    { installId: "install-test" }
  );
  assert.equal(plan.reviewTabs.length, 2);
});

test("AI gateway planner surfaces auth failures as product copy", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { error: { message: "Unauthorized" } };
    }
  });

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        {
          ...DEFAULT_SETTINGS,
          plannerProvider: PLANNER_PROVIDERS.GATEWAY,
          gatewayBaseUrl: "http://localhost:8317/v1",
          gatewayApiKey: "bad-key"
        },
        fetchImpl
      ),
    /请检查自定义网关地址和密钥/
  );
});

test("AI gateway planner surfaces plain-text gateway failures without JSON parse noise", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 502,
    async text() {
      return "error code: 502";
    }
  });

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        {
          ...DEFAULT_SETTINGS,
          plannerProvider: PLANNER_PROVIDERS.GATEWAY,
          gatewayBaseUrl: "http://localhost:8317/v1",
          gatewayApiKey: "test-key"
        },
        fetchImpl
      ),
    /AI 服务返回 502：error code: 502/
  );
});

test("AI gateway planner accepts common string error payloads", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    async json() {
      return { error: "upstream overloaded" };
    }
  });

  await assert.rejects(
    () =>
      createGatewayPlan(
        inventory,
        {
          ...DEFAULT_SETTINGS,
          plannerProvider: PLANNER_PROVIDERS.GATEWAY,
          gatewayBaseUrl: "http://localhost:8317/v1",
          gatewayApiKey: "test-key"
        },
        fetchImpl
      ),
    /AI 服务返回 503：upstream overloaded/
  );
});

test("AI gateway planner honors an explicit timeout", async () => {
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

  const settings = {
    ...DEFAULT_SETTINGS,
    plannerProvider: PLANNER_PROVIDERS.GATEWAY,
    gatewayApiKey: "gateway-test-key",
    languageMode: "en-US"
  };
  const plan = await createGatewayPlan(largeInventory, settings, fetchImpl, {
    hierarchical: true,
    refineBucketMinTabs: 3
  });
  const validation = validatePlan(plan, largeInventory, settings);

  assert.equal(requests.length, 3);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests[1].reasoning_effort, "high");
  assert.match(requests[0].messages[0].content, /fast first-pass/);
  assert.match(requests[0].messages[0].content, /Write every user-facing string in English/);
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

test("AI gateway planner splits high-confidence fallback buckets by original order", async () => {
  const plannerTabs = [10, 11, 12, 13, 14].map((tabId, sequenceIndex) => ({
    tabId,
    windowId: 1,
    index: sequenceIndex,
    sequenceIndex,
    title: `Fallback bucket tab ${tabId}`,
    hostname: "example.com"
  }));
  const largeInventory = { ...inventory, plannerTabs, tabs: plannerTabs, pageSamples: [] };
  const requests = [];

  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    buckets: [
                      {
                        bucketKey: "large",
                        title: "Large Bucket",
                        color: "blue",
                        confidence: 0.95,
                        tabIds: [14, 10, 13, 12, 11],
                        reason: "High-confidence but needs refinement."
                      }
                    ],
                    reviewTabIds: []
                  })
                }
              }
            ]
          };
        }
      };
    }
    return {
      ok: false,
      status: 503,
      async json() {
        return { error: { message: "refinement service unavailable" } };
      }
    };
  };

  const settings = { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.GATEWAY, gatewayApiKey: "gateway-test-key", maxTabsPerGroup: 2 };
  const plan = await createGatewayPlan(largeInventory, settings, fetchImpl, {
    hierarchical: true,
    refineBucketMinTabs: 2,
    refineMaxTabsPerRequest: 10
  });
  const validation = validatePlan(plan, largeInventory, settings);

  assert.equal(requests.length, 2);
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.deepEqual(
    plan.groups.map((group) => group.tabRefs.map((ref) => ref.tabId)),
    [
      [10, 11],
      [12, 13],
      [14]
    ]
  );
});

test("AI gateway planner keeps high refinement when large jobs request ultra thinking", async () => {
  const plannerTabs = [10, 11, 12].map((tabId) => ({
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
          tabIds: [10, 11, 12],
          reason: "Needs refinement."
        }
      ],
      reviewTabIds: []
    },
    planForRefs([10, 11, 12], "Refined")
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
  await createGatewayPlan(
    largeInventory,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayApiKey: "gateway-test-key",
      gatewayThinkingIntensity: "ultra"
    },
    fetchImpl,
    {
      hierarchical: true,
      refineBucketMinTabs: 2
    }
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests[1].reasoning_effort, "high");
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

function rowToObject(fields, row) {
  return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
}
