const PROGRESS_COPY_MODEL = "gpt-5.3-codex-spark";
const DEFAULT_ALLOWED_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "claude-opus-4-8", "claude-sonnet-4-6", PROGRESS_COPY_MODEL];
const FORWARDED_CHAT_FIELDS = Object.freeze(["model", "messages", "response_format", "max_tokens", "reasoning_effort", "thinking"]);
const DEFAULT_LIMITS = Object.freeze({
  bodyBytes: 1_000_000,
  maxTokens: 8192,
  ipHourlyRequests: 60,
  installDailyRequests: 100,
  installDailyPageSummaryRequests: 20,
  globalDailyRequests: 3000
});

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

export function createWorkerHandler(options = {}) {
  return (request, env = {}, ctx = {}) => handleRequest(request, env, ctx, options);
}

export async function handleRequest(request, env = {}, ctx = {}, options = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return emptyResponse(204, request);
  if (url.pathname === "/healthz" && request.method === "GET") {
    return jsonResponse({ ok: true }, 200, {}, request);
  }
  if (url.pathname !== "/v1/chat/completions") {
    return jsonError("Not found.", 404, "not_found", {}, request);
  }
  if (request.method !== "POST") {
    return jsonError("Method not allowed.", 405, "method_not_allowed", {}, request);
  }

  const limits = readLimits(env);
  const bodyText = await readBodyText(request, limits.bodyBytes);
  if (!bodyText.ok) {
    return jsonError(bodyText.message, 413, "request_too_large", {}, request);
  }

  let body;
  try {
    body = JSON.parse(bodyText.text);
  } catch {
    return jsonError("Request body must be valid JSON.", 400, "invalid_json", {}, request);
  }

  const validation = validateChatRequest(body, env, limits);
  if (!validation.ok) {
    return jsonError(validation.message, 400, validation.code, {}, request);
  }

  const rateLimit = await checkRateLimits(request, env, limits);
  if (!rateLimit.ok) {
    return jsonError(rateLimit.message, 429, rateLimit.code, rateLimit.headers, request);
  }

  const upstream = upstreamConfig(env);
  if (!upstream.ok) {
    return jsonError(upstream.message, 503, "upstream_not_configured", {}, request);
  }

  const fetchImpl = options.fetchImpl || fetch;
  const upstreamResponse = await fetchImpl(upstream.url, upstreamRequest(JSON.stringify(forwardedChatBody(body)), upstream, request.signal));

  return relayUpstreamResponse(upstreamResponse, request);
}

function readLimits(env) {
  return {
    bodyBytes: positiveInteger(env.MAX_BODY_BYTES, DEFAULT_LIMITS.bodyBytes),
    maxTokens: positiveInteger(env.MAX_TOKENS, DEFAULT_LIMITS.maxTokens),
    ipHourlyRequests: positiveInteger(env.IP_HOURLY_REQUESTS, DEFAULT_LIMITS.ipHourlyRequests),
    installDailyRequests: positiveInteger(env.INSTALL_DAILY_REQUESTS, DEFAULT_LIMITS.installDailyRequests),
    installDailyPageSummaryRequests: positiveInteger(
      env.INSTALL_DAILY_PAGE_SUMMARY_REQUESTS,
      DEFAULT_LIMITS.installDailyPageSummaryRequests
    ),
    globalDailyRequests: positiveInteger(env.GLOBAL_DAILY_REQUESTS, DEFAULT_LIMITS.globalDailyRequests)
  };
}

async function readBodyText(request, byteLimit) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > byteLimit) {
    return { ok: false, message: `Request body is above the ${byteLimit} byte limit.` };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > byteLimit) {
    return { ok: false, message: `Request body is above the ${byteLimit} byte limit.` };
  }
  return { ok: true, text };
}

function validateChatRequest(body, env, limits) {
  const modelAllowlist = allowedModels(env);
  if (!modelAllowlist.includes(body?.model)) {
    return { ok: false, code: "model_not_allowed", message: "This model is not available on the free gateway." };
  }
  const fieldValidation = validateTopLevelFields(body);
  if (!fieldValidation.ok) return fieldValidation;
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return { ok: false, code: "invalid_messages", message: "messages must be a non-empty array." };
  }
  if (body.response_format?.type !== "json_object") {
    return { ok: false, code: "json_required", message: "Tab Tidy gateway requests must use JSON object output." };
  }
  if (Number(body.max_tokens || 0) > limits.maxTokens) {
    return { ok: false, code: "max_tokens_exceeded", message: `max_tokens must be <= ${limits.maxTokens}.` };
  }
  if (body.model === PROGRESS_COPY_MODEL) {
    const sparkValidation = validateProgressCopyRequest(body);
    if (!sparkValidation.ok) return sparkValidation;
  } else {
    const plannerValidation = validatePlannerRequest(body, modelAllowlist);
    if (!plannerValidation.ok) return plannerValidation;
  }
  if (body.base_url || body.baseURL || body.provider_url) {
    return { ok: false, code: "proxy_target_not_allowed", message: "Custom upstream targets are not allowed." };
  }
  return { ok: true };
}

function validateTopLevelFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "invalid_request", message: "Request body must be an object." };
  }
  const allowed = new Set(FORWARDED_CHAT_FIELDS);
  const unsupported = Object.keys(body).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    return {
      ok: false,
      code: "request_shape_not_allowed",
      message: `This gateway only accepts Tab Tidy planner fields. Unsupported field: ${unsupported[0]}.`
    };
  }
  if (body.stream || body.tools || body.functions || body.tool_choice || body.function_call || body.max_completion_tokens) {
    return { ok: false, code: "request_shape_not_allowed", message: "This gateway only accepts Tab Tidy JSON planning requests." };
  }
  return { ok: true };
}

function validatePlannerRequest(body, modelAllowlist) {
  const plannerModels = new Set(modelAllowlist.filter((model) => model !== PROGRESS_COPY_MODEL));
  if (!plannerModels.has(body.model)) {
    return { ok: false, code: "planner_model_not_allowed", message: "This model is not available for Tab Tidy planning." };
  }
  if (body.messages.length !== 2) {
    return { ok: false, code: "planner_shape_required", message: "Planner requests must use the Tab Tidy two-message shape." };
  }
  const [system, user] = body.messages;
  const systemText = messageText(system);
  const userText = messageText(user);
  if (system?.role !== "system" || user?.role !== "user") {
    return { ok: false, code: "planner_shape_required", message: "Planner requests must include one system message and one user message." };
  }
  if (!/Chrome tab organization extension|Chrome extension runtime|Chrome tab organization/i.test(systemText)) {
    return { ok: false, code: "planner_shape_required", message: "Planner system prompt is not recognized as a Tab Tidy request." };
  }
  if (!/browser tabs|browser tab inventory|tab inventory|broad semantic buckets/i.test(userText)) {
    return { ok: false, code: "planner_shape_required", message: "Planner user payload is not recognized as a Tab Tidy request." };
  }
  if (!/"tabFields"\s*:/.test(userText) || !/"tabs"\s*:/.test(userText)) {
    return { ok: false, code: "planner_payload_required", message: "Planner payload must include compact Tab Tidy tab fields." };
  }
  return { ok: true };
}

function validateProgressCopyRequest(body) {
  if (Number(body.max_tokens || 0) > 1200) {
    return { ok: false, code: "spark_token_cap_exceeded", message: "Progress copy max_tokens must be <= 1200." };
  }
  if (body.messages.length !== 2) {
    return { ok: false, code: "spark_shape_required", message: "Progress copy requests must use the Tab Tidy two-message shape." };
  }
  const [system, user] = body.messages;
  const systemText = messageText(system);
  const userText = messageText(user);
  if (system?.role !== "system" || user?.role !== "user") {
    return { ok: false, code: "spark_shape_required", message: "Progress copy requests must include one system message and one user message." };
  }
  if (!/AI browser-tab organization extension|loading captions/i.test(systemText)) {
    return { ok: false, code: "spark_shape_required", message: "Progress copy system prompt is not recognized as a Tab Tidy request." };
  }
  let payload;
  try {
    payload = JSON.parse(userText);
  } catch {
    return { ok: false, code: "spark_payload_required", message: "Progress copy user payload must be JSON." };
  }
  if (!payload || typeof payload !== "object" || !("languageMode" in payload) || !("phase" in payload)) {
    return { ok: false, code: "spark_payload_required", message: "Progress copy payload must include Tab Tidy progress fields." };
  }
  return { ok: true };
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
  }
  return "";
}

function forwardedChatBody(body) {
  return Object.fromEntries(FORWARDED_CHAT_FIELDS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}

async function checkRateLimits(request, env, limits) {
  if (!env.RATE_LIMIT_KV) {
    if (String(env.ALLOW_UNMETERED || "").toLowerCase() === "true") return { ok: true };
    return { ok: false, code: "rate_limit_store_missing", message: "Free gateway rate limit store is not configured." };
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const installId = normalizeInstallId(request.headers.get("x-tab-tidy-install-id"));
  const ipKey = normalizeIp(clientIp(request));
  const pageSummary = request.headers.get("x-tab-tidy-page-summary") === "1";
  const checks = [
    ["global", `global:${day}`, limits.globalDailyRequests, secondsUntilNextUtcDay(now) + 3600],
    ["install", `install:${installId}:${day}`, limits.installDailyRequests, secondsUntilNextUtcDay(now) + 3600],
    ["ip", `ip:${ipKey}:${hour}`, limits.ipHourlyRequests, secondsUntilNextUtcHour(now) + 600]
  ];
  if (pageSummary) {
    checks.push([
      "page_summary",
      `page-summary:${installId}:${day}`,
      limits.installDailyPageSummaryRequests,
      secondsUntilNextUtcDay(now) + 3600
    ]);
  }

  const currentCounts = [];
  for (const [kind, key, limit, ttlSeconds] of checks) {
    const current = Number(await env.RATE_LIMIT_KV.get(key)) || 0;
    if (current + 1 > limit) {
      return {
        ok: false,
        code: `${kind}_rate_limited`,
        message: "The free gateway is temporarily rate limited. Please try later or use a custom gateway.",
        headers: { "retry-after": String(Math.min(ttlSeconds, 3600)) }
      };
    }
    currentCounts.push([key, current + 1, ttlSeconds]);
  }

  for (const [key, next, ttlSeconds] of currentCounts) {
    await env.RATE_LIMIT_KV.put(key, String(next), { expirationTtl: ttlSeconds });
  }
  return { ok: true };
}

function upstreamConfig(env) {
  const baseUrl = String(env.UPSTREAM_BASE_URL || "").replace(/\/+$/, "");
  if (!baseUrl) return { ok: false, message: "UPSTREAM_BASE_URL is not configured." };
  if (!env.UPSTREAM_API_KEY) return { ok: false, message: "UPSTREAM_API_KEY is not configured." };
  return {
    ok: true,
    url: `${baseUrl}/chat/completions`,
    apiKey: env.UPSTREAM_API_KEY,
    accessClientId: env.CF_ACCESS_CLIENT_ID || "",
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET || ""
  };
}

function upstreamRequest(bodyText, upstream, signal) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${upstream.apiKey}`
  };
  if (upstream.accessClientId && upstream.accessClientSecret) {
    headers["cf-access-client-id"] = upstream.accessClientId;
    headers["cf-access-client-secret"] = upstream.accessClientSecret;
  }
  return { method: "POST", headers, body: bodyText, signal };
}

function relayUpstreamResponse(response, request) {
  const headers = {
    ...corsHeaders(request),
    "cache-control": "no-store",
    "content-type": response.headers.get("content-type") || "application/json"
  };
  return new Response(response.body, { status: response.status, headers });
}

function allowedModels(env) {
  const configured = String(env.ALLOWED_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = configured.length ? configured : DEFAULT_ALLOWED_MODELS;
  return models
    .filter((model, index, values) => values.indexOf(model) === index);
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function normalizeIp(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9:._-]/g, "_")
    .slice(0, 80) || "unknown";
}

function normalizeInstallId(value) {
  return String(value || "missing")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 80) || "missing";
}

function secondsUntilNextUtcDay(now) {
  return Math.max(60, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));
}

function secondsUntilNextUtcHour(now) {
  return Math.max(60, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1) - now.getTime()) / 1000));
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function jsonError(message, status, code, extraHeaders = {}, request = null) {
  return jsonResponse({ error: { message, code } }, status, extraHeaders, request);
}

function jsonResponse(value, status = 200, extraHeaders = {}, request = null) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

function emptyResponse(status, request = null) {
  return new Response(null, {
    status,
    headers: {
      ...corsHeaders(request),
      "cache-control": "no-store"
    }
  });
}

function corsHeaders(request) {
  const origin = request?.headers?.get?.("origin") || "";
  const allowedOrigin = allowedCorsOrigin(origin);
  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-tab-tidy-install-id,x-tab-tidy-page-summary",
    vary: "Origin"
  };
}

function allowedCorsOrigin(origin) {
  if (!origin) return "*";
  if (/^(chrome|moz)-extension:\/\/[a-z0-9_-]+$/i.test(origin)) return origin;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return origin;
  return "";
}
