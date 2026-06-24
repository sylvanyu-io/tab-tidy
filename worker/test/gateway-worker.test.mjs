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

  const progressCopyModel = await handle(
    chatRequest({ model: "gpt-5.3-codex-spark", response_format: { type: "json_object" }, max_tokens: 1200 }),
    env
  );
  assert.equal(progressCopyModel.status, 200);
  const sparkToolRequest = await handle(
    chatRequest({ model: "gpt-5.3-codex-spark", response_format: { type: "json_object" }, tools: [{ type: "function" }] }),
    env
  );
  assert.equal(sparkToolRequest.status, 400);
  assert.equal((await sparkToolRequest.json()).error.code, "spark_tools_not_allowed");

  const tooManyTokens = await handle(chatRequest({ max_tokens: 9000 }), env);
  assert.equal(tooManyTokens.status, 400);
  assert.equal((await tooManyTokens.json()).error.code, "max_tokens_exceeded");
});

test("worker rejects oversized bodies using content length", async () => {
  const body = JSON.stringify(validBody());
  const request = new Request("https://cliproxy.example/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
      "x-tab-tidy-install-id": "install-a"
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
});

test("worker applies install id, ip, global, and page-summary quotas", async () => {
  const installLimited = envWithKv({ INSTALL_DAILY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-a" }), installLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-a" }), installLimited)).status, 429);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-b" }), installLimited)).status, 200);

  const ipLimited = envWithKv({ IP_HOURLY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "cf-connecting-ip": "203.0.113.9" }), ipLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "cf-connecting-ip": "203.0.113.9" }), ipLimited)).status, 429);

  const globalLimited = envWithKv({ GLOBAL_DAILY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-a" }), globalLimited)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-b" }), globalLimited)).status, 429);

  const pageSummaryLimited = envWithKv({ INSTALL_DAILY_PAGE_SUMMARY_REQUESTS: "1" });
  assert.equal(
    (await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-a", "x-tab-tidy-page-summary": "1" }), pageSummaryLimited))
      .status,
    200
  );
  assert.equal(
    (await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-a", "x-tab-tidy-page-summary": "1" }), pageSummaryLimited))
      .status,
    429
  );
});

test("page-summary quota failures do not consume the general install quota", async () => {
  const env = envWithKv({ INSTALL_DAILY_REQUESTS: "2", INSTALL_DAILY_PAGE_SUMMARY_REQUESTS: "1" });
  assert.equal((await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-a", "x-tab-tidy-page-summary": "1" }), env)).status, 200);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-a", "x-tab-tidy-page-summary": "1" }), env)).status, 429);
  assert.equal((await handle(chatRequest(undefined, { "x-tab-tidy-install-id": "install-a" }), env)).status, 200);
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
      "x-tab-tidy-install-id": "install-a",
      "cf-connecting-ip": "203.0.113.1",
      ...headers
    },
    body: JSON.stringify(validBody(overrides))
  });
}

function validBody(overrides = {}) {
  return {
    model: "gpt-5.5",
    messages: [{ role: "user", content: "classify tabs" }],
    max_tokens: 1024,
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
