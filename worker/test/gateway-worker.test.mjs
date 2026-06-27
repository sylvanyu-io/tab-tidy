import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerHandler } from "../src/index.js";

const handle = createWorkerHandler({
  fetchImpl: async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
});

test("worker health check returns ok without upstream secrets", async () => {
  const response = await handle(new Request("https://cliproxy.example/healthz"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("worker rejects chat requests without a rate limit store", async () => {
  const response = await handle(chatRequest());
  assert.equal(response.status, 429);
  assert.match((await response.json()).error.code, /rate_limit_store_missing/);
});

test("worker validates models and token caps before forwarding", async () => {
  const env = envWithKv();
  const badModel = await handle(chatRequest({ model: "random-model" }), env);
  assert.equal(badModel.status, 400);
  assert.equal((await badModel.json()).error.code, "model_not_allowed");

  const progressCopyModel = await handle(chatRequest(validProgressCopyBody()), env);
  assert.equal(progressCopyModel.status, 200);

  const miniPlannerModel = await handle(chatRequest({ model: "gpt-5.4-mini" }), env);
  assert.equal(miniPlannerModel.status, 200);

  const olderClaudePlannerModel = await handle(chatRequest({ model: "claude-opus-4-7" }), env);
  assert.equal(olderClaudePlannerModel.status, 200);

  const imageModel = await handle(chatRequest({ model: "gpt-image-2" }), env);
  assert.equal(imageModel.status, 400);
  assert.equal((await imageModel.json()).error.code, "model_not_allowed");

  const tooManyTokens = await handle(chatRequest({ max_tokens: 9000 }), env);
  assert.equal(tooManyTokens.status, 400);
  assert.equal((await tooManyTokens.json()).error.code, "max_tokens_exceeded");
});

test("worker derives planner models from the configured allowlist", async () => {
  const env = envWithKv({ ALLOWED_MODELS: "gpt-5.4-mini,gpt-5.3-codex-spark" });
  const planner = await handle(chatRequest({ model: "gpt-5.4-mini" }), env);
  assert.equal(planner.status, 200);

  const sparkPlanner = await handle(
    chatRequest({
      model: "gpt-5.3-codex-spark",
      messages: validBody().messages
    }),
    env
  );
  assert.equal(sparkPlanner.status, 200);
});

test("worker keeps the spark progress-copy cap while allowing spark planner shapes", async () => {
  const env = envWithKv();

  const oversizedProgressCopy = await handle(chatRequest(validProgressCopyBody({ max_tokens: 1500 })), env);
  assert.equal(oversizedProgressCopy.status, 400);
  assert.equal((await oversizedProgressCopy.json()).error.code, "spark_token_cap_exceeded");

  const sparkPlanner = await handle(
    chatRequest({
      ...validBody({ model: "gpt-5.3-codex-spark" }),
      max_tokens: 4096
    }),
    env
  );
  assert.equal(sparkPlanner.status, 200);
});

test("worker only accepts TabRecap request shapes", async () => {
  const env = envWithKv();
  const streamRequest = await handle(chatRequest({ stream: true }), env);
  assert.equal(streamRequest.status, 400);
  assert.equal((await streamRequest.json()).error.code, "request_shape_not_allowed");

  const toolRequest = await handle(chatRequest({ tools: [{ type: "function" }] }), env);
  assert.equal(toolRequest.status, 400);
  assert.equal((await toolRequest.json()).error.code, "request_shape_not_allowed");

  const genericChat = await handle(
    chatRequest({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Write a poem." }
      ]
    }),
    env
  );
  assert.equal(genericChat.status, 400);
  assert.equal((await genericChat.json()).error.code, "planner_shape_required");

  const markdownChat = await handle(chatRequest({ response_format: { type: "text" } }), env);
  assert.equal(markdownChat.status, 400);
  assert.equal((await markdownChat.json()).error.code, "json_required");
});

test("worker rejects oversized bodies using content length", async () => {
  const body = JSON.stringify(validBody());
  const request = new Request("https://cliproxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
      "x-tab-recap-install-id": "install-a"
    },
    body
  });
  const response = await handle(request, { ...envWithKv(), MAX_BODY_BYTES: "10" });
  assert.equal(response.status, 413);
});

test("worker forwards with upstream secret and strips client authorization", async () => {
  const calls = [];
  const localHandle = createWorkerHandler({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const response = await localHandle(chatRequest(undefined, { authorization: "Bearer user-visible-token" }), {
    ...envWithKv(),
    CF_ACCESS_CLIENT_ID: "access-id",
    CF_ACCESS_CLIENT_SECRET: "access-secret"
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://raw-llm.example/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer upstream-secret");
  assert.equal(calls[0].options.headers["cf-access-client-id"], "access-id");
  assert.equal(calls[0].options.headers["cf-access-client-secret"], "access-secret");
  assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)).sort(), [
    "max_tokens",
    "messages",
    "model",
    "reasoning_effort",
    "response_format"
  ]);
});

test("worker applies install id, ip, global, and page-summary quotas", async () => {
  const installLimited = envWithKv({ INSTALL_DAILY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a" }), installLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a" }), installLimited)).status, 429);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-b" }), installLimited)).status, 200);

  const ipLimited = envWithKv({ IP_HOURLY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "cf-connecting-ip": "203.0.113.9" }), ipLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "cf-connecting-ip": "203.0.113.9" }), ipLimited)).status, 429);

  const globalLimited = envWithKv({ GLOBAL_DAILY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a" }), globalLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-b" }), globalLimited)).status, 429);

  const pageSummaryLimited = envWithKv({ INSTALL_DAILY_PAGE_SUMMARY_REQUESTS: "1" });
  assert.equal(
    (await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a", "x-tab-recap-page-summary": "1" }), pageSummaryLimited))
      .status,
    200
  );
  assert.equal(
    (await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a", "x-tab-recap-page-summary": "1" }), pageSummaryLimited))
      .status,
    429
  );
});

test("worker accepts legacy Tab Tidy gateway quota headers", async () => {
  const installLimited = envWithKv({ INSTALL_DAILY_REQUESTS: "1" });
  assert.equal((await handle(legacyHeaderRequest({ "x-tab-tidy-install-id": "install-legacy" }), installLimited)).status, 200);
  assert.equal((await handle(legacyHeaderRequest({ "x-tab-tidy-install-id": "install-legacy" }), installLimited)).status, 429);

  const pageSummaryLimited = envWithKv({ INSTALL_DAILY_PAGE_SUMMARY_REQUESTS: "1" });
  assert.equal(
    (await handle(legacyHeaderRequest({ "x-tab-tidy-install-id": "install-legacy", "x-tab-tidy-page-summary": "1" }), pageSummaryLimited))
      .status,
    200
  );
  assert.equal(
    (await handle(legacyHeaderRequest({ "x-tab-tidy-install-id": "install-legacy", "x-tab-tidy-page-summary": "1" }), pageSummaryLimited))
      .status,
    429
  );
});

test("page-summary quota failures do not consume the general install quota", async () => {
  const env = envWithKv({ INSTALL_DAILY_REQUESTS: "2", INSTALL_DAILY_PAGE_SUMMARY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a", "x-tab-recap-page-summary": "1" }), env)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a", "x-tab-recap-page-summary": "1" }), env)).status, 429);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-recap-install-id": "install-a" }), env)).status, 200);
});

test("worker CORS is limited to extension and local debug origins", async () => {
  const extensionResponse = await handle(chatRequest(undefined, { origin: "chrome-extension://abcdefghijklmnop" }), envWithKv());
  assert.equal(extensionResponse.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");

  const webResponse = await handle(chatRequest(undefined, { origin: "https://random.example" }), envWithKv());
  assert.equal(webResponse.status, 200);
  assert.equal(webResponse.headers.get("access-control-allow-origin"), null);
});

function chatRequest(overrides = {}, headers = {}) {
  return new Request("https://cliproxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tab-recap-install-id": "install-a",
      "cf-connecting-ip": "203.0.113.1",
      ...headers
    },
    body: JSON.stringify(validBody(overrides))
  });
}

function legacyHeaderRequest(headers = {}, overrides = {}) {
  return new Request("https://cliproxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.1",
      ...headers
    },
    body: JSON.stringify(validBody(overrides))
  });
}

function validBody(overrides = {}) {
  return {
    model: "gpt-5.5",
    messages: [
      {
        role: "system",
        content: "You are a JSON-only planner for a Chrome tab organization extension."
      },
      {
        role: "user",
        content: [
          "Software engineering task input: classify this browser tab inventory for a Chrome extension runtime.",
          "Return the JSON action plan only.",
          JSON.stringify({
            schema: "tab_tidy_compact_v1",
            tabFields: ["id", "windowId", "index", "sequenceIndex", "title"],
            tabs: [[10, 1, 0, 0, "Chrome tabs API docs"]]
          })
        ].join("\n")
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 1024,
    reasoning_effort: "high",
    ...overrides
  };
}

function validProgressCopyBody(overrides = {}) {
  return {
    model: "gpt-5.3-codex-spark",
    messages: [
      {
        role: "system",
        content: "Write short loading captions for an AI browser-tab organization extension. Return strict JSON only."
      },
      {
        role: "user",
        content: JSON.stringify({ languageMode: "zh-CN", phase: "planning", tabCount: 120, windowCount: 3 })
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200,
    reasoning_effort: undefined,
    ...overrides
  };
}

function envWithKv(overrides = {}) {
  return {
    RATE_LIMIT_KV: new MemoryKv(),
    UPSTREAM_BASE_URL: "https://raw-llm.example/v1",
    UPSTREAM_API_KEY: "upstream-secret",
    ...overrides
  };
}

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}
