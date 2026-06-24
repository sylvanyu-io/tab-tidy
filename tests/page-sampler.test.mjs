import assert from "node:assert/strict";
import test from "node:test";
import { requestPageSample } from "../src/core/page-sampler.js";
import {
  DEFAULT_SETTINGS,
  HOST_PERMISSION_REQUEST_MODES,
  PAGE_CONTEXT_MODES,
  PAGE_SAMPLING_CONSENT_MODES
} from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("page sampling is blocked until the risk warning is acknowledged", async () => {
  const chrome = createFakeChrome();
  const result = await requestPageSample(
    chrome,
    { id: 10, url: "https://example.com/article" },
    { ...DEFAULT_SETTINGS, pageContextMode: PAGE_CONTEXT_MODES.AMBIGUOUS_WITH_PERMISSION },
    "ambiguous title"
  );

  assert.equal(result.status, "blocked");
});

test("missing host permission returns permission_required when requests are disabled", async () => {
  const chrome = createFakeChrome();
  const result = await requestPageSample(
    chrome,
    { id: 10, url: "https://example.com/article" },
    {
      ...DEFAULT_SETTINGS,
      pageContextMode: PAGE_CONTEXT_MODES.AMBIGUOUS_WITH_PERMISSION,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    "ambiguous title"
  );

  assert.equal(result.status, "permission_required");
  assert.equal(result.origin, "https://example.com/*");
});

test("localhost page sampling uses Chrome match patterns without ports", async () => {
  const chrome = createFakeChrome({ grantedOrigins: ["http://127.0.0.1/*"] });
  const result = await requestPageSample(
    chrome,
    { id: 10, active: false, url: "http://127.0.0.1:53405/article" },
    {
      ...DEFAULT_SETTINGS,
      pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
      hostPermissionRequestMode: HOST_PERMISSION_REQUEST_MODES.ASK_FOR_ALL_VISIBLE_ORIGINS,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    "localhost permission check"
  );

  assert.equal(result.status, "ok");
  assert.equal(result.origin, "http://127.0.0.1/*");
});

test("active_tab_only rejects background tabs", async () => {
  const chrome = createFakeChrome();
  const result = await requestPageSample(
    chrome,
    { id: 10, active: false, url: "https://example.com/article" },
    {
      ...DEFAULT_SETTINGS,
      pageContextMode: PAGE_CONTEXT_MODES.ACTIVE_TAB_ONLY,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    "active tab check"
  );

  assert.equal(result.status, "blocked");
});

test("active_tab_only can sample the active tab without stored host permission", async () => {
  const chrome = createFakeChrome();
  const result = await requestPageSample(
    chrome,
    { id: 10, active: true, url: "https://example.com/article" },
    {
      ...DEFAULT_SETTINGS,
      pageContextMode: PAGE_CONTEXT_MODES.ACTIVE_TAB_ONLY,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    "active tab check"
  );

  assert.equal(result.status, "ok");
  assert.equal(result.sample.title, "Sample");
});

test("host-permission sampling degrades when Chrome still rejects script injection", async () => {
  const chrome = createFakeChrome({ grantedOrigins: ["https://example.com/*"] });
  chrome.scripting.executeScript = async () => {
    throw new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host.");
  };

  const result = await requestPageSample(
    chrome,
    { id: 10, active: false, url: "https://example.com/article" },
    {
      ...DEFAULT_SETTINGS,
      pageContextMode: PAGE_CONTEXT_MODES.ALL_GRANTED_ORIGINS,
      hostPermissionRequestMode: HOST_PERMISSION_REQUEST_MODES.ASK_FOR_ALL_VISIBLE_ORIGINS,
      pageSamplingConsentMode: PAGE_SAMPLING_CONSENT_MODES.ACKNOWLEDGED_FOR_SESSION
    },
    "host permission check"
  );

  assert.equal(result.status, "permission_required");
  assert.equal(result.origin, "https://example.com/*");
  assert.match(result.reason, /Chrome did not allow/);
});
