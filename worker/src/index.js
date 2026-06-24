const DEFAULT_ALLOWED_MODELS = ["gpt-5.5", "claude-opus-4-8", "claude-sonnet-4-6"];
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
  if (request.method === "OPTIONS") return emptyResponse(204);
  if (url.pathname === "/healthz" && request.method === "GET") {
    return jsonResponse({ ok: true }, 200);
  }
  if (url.pathname !== "/v1/chat/completions") {
    return jsonError("Not found.", 404, "not_found");
  }
  if (request.method !== "POST") {
    return jsonError("Method not allowed.", 405, "method_not_allowed");
  }

  const limits = readLimits(env);
  const bodyText = await readBodyText(request, limits.bodyBytes);
  if (!bodyText.ok) {
    return jsonError(bodyText.message, 413, "request_too_large");
  }

  let body;
  try {
    body = JSON.parse(bodyText.text);
  } catch {
    return jsonError("Request body must be valid JSON.", 400, "invalid_json");
  }

  const validation = validateChatRequest(body, env, limits);
  if (!validation.ok) {
    return jsonError(validation.message, 400, validation.code);
  }

  const rateLimit = await checkRateLimits(request, env, limits);
  if (!rateLimit.ok) {
    return jsonError(rateLimit.message, 429, rateLimit.code, rateLimit.headers);
  }

  const upstream = upstreamConfig(env);
  if (!upstream.ok) {
    return jsonError(upstream.message, 503, "upstream_not_configured");
  }

  const fetchImpl = options.fetchImpl || fetch;
  const upstreamResponse = await fetchImpl(upstream.url, upstreamRequest(bodyText.text, upstream, request.signal));

  return relayUpstreamResponse(upstreamResponse);
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
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return { ok: false, code: "invalid_messages", message: "messages must be a non-empty array." };
  }
  if (Number(body.max_tokens || 0) > limits.maxTokens) {
    return { ok: false, code: "max_tokens_exceeded", message: `max_tokens must be <= ${limits.maxTokens}.` };
  }
  if (body.base_url || body.baseURL || body.provider_url) {
    return { ok: false, code: "proxy_target_not_allowed", message: "Custom upstream targets are not allowed." };
  }
  return { ok: true };
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

  for (const [kind, key, limit, ttlSeconds] of checks) {
    const result = await incrementCounter(env.RATE_LIMIT_KV, key, ttlSeconds, limit);
    if (!result.ok) {
      return {
        ok: false,
        code: `${kind}_rate_limited`,
        message: "The free gateway is temporarily rate limited. Please try later or use a custom gateway.",
        headers: { "retry-after": String(result.retryAfterSeconds) }
      };
    }
  }
  return { ok: true };
}

async function incrementCounter(kv, key, ttlSeconds, limit) {
  const current = Number(await kv.get(key)) || 0;
  const next = current + 1;
  if (next > limit) {
    return { ok: false, retryAfterSeconds: Math.min(ttlSeconds, 3600) };
  }
  await kv.put(key, String(next), { expirationTtl: ttlSeconds });
  return { ok: true, count: next };
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

function relayUpstreamResponse(response) {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-tab-tidy-install-id,x-tab-tidy-page-summary",
    "cache-control": "no-store",
    "content-type": response.headers.get("content-type") || "application/json"
  };
  return new Response(response.body, { status: response.status, headers });
}

function allowedModels(env) {
  return String(env.ALLOWED_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
    .concat(DEFAULT_ALLOWED_MODELS)
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

function jsonError(message, status, code, extraHeaders = {}) {
  return jsonResponse({ error: { message, code } }, status, extraHeaders);
}

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-tab-tidy-install-id,x-tab-tidy-page-summary",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

function emptyResponse(status) {
  return new Response(null, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-tab-tidy-install-id,x-tab-tidy-page-summary",
      "cache-control": "no-store"
    }
  });
}
