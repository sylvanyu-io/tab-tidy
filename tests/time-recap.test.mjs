import assert from "node:assert/strict";
import test from "node:test";
import { handleRuntimeMessage } from "../src/core/controller.js";
import { buildTimeRecapInput, generateTimeRecap, normalizeTimeRecapRange } from "../src/core/time-recap.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

const NOW = Date.parse("2026-06-27T06:00:00.000Z");

test("time recap input combines local activity, summaries, lifecycle, and current restricted tabs", async () => {
  const chrome = seededRecapChrome();

  const input = await buildTimeRecapInput(
    chrome,
    { ...DEFAULT_SETTINGS, languageMode: "zh-CN" },
    { range: { preset: "7d" }, now: NOW }
  );
  const serialized = JSON.stringify(input);

  assert.equal(input.schema, "tab_tidy_time_recap_input_v1");
  assert.equal(input.pages.some((page) => page.title === "Chrome extensions settings" && page.hostname === "chrome"), true);
  assert.equal(input.pages.some((page) => page.title === "Old unrelated page"), false);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("SECRET123456789012"), false);
  assert.equal(serialized.includes("Readable forum discussion about browser extensions"), true);
  assert.equal(input.coverage.currentOpenTabs, 3);
  assert.equal(input.coverage.includedPages >= 3, true);
});

test("time recap gateway request parses fenced JSON and keeps page references valid", async () => {
  const chrome = seededRecapChrome();
  let capturedRequest = null;
  const fetchImpl = async (url, init) => {
    capturedRequest = { url, init, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "```json\n{\"schema\":\"tab_tidy_time_recap_v1\",\"language\":\"en-US\",\"headline\":\"Extension work dominated the week.\",\"summary\":\"Most useful signals point to TabRecap release and browser extension research.\",\"themes\":[{\"title\":\"Extension release work\",\"description\":\"Release and side panel pages form one thread.\",\"confidence\":\"high\",\"ids\":[1,999],\"evidence\":[\"release\"]}],\"timeline\":[{\"label\":\"This week\",\"description\":\"Mostly extension work.\",\"ids\":[1]}],\"followUps\":[{\"title\":\"Finish release QA\",\"reason\":\"The release checklist is still open.\",\"ids\":[1]}],\"reviewCandidates\":[{\"id\":2,\"priority\":\"medium\",\"reason\":\"This looks like an older research page.\",\"evidence\":[\"older\"]}],\"coverageNote\":\"Used local signals.\"}\n```"
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const result = await generateTimeRecap(
    chrome,
    {
      ...DEFAULT_SETTINGS,
      plannerProvider: PLANNER_PROVIDERS.GATEWAY,
      gatewayBaseUrl: "http://127.0.0.1:8317/v1",
      gatewayApiKey: "test-key",
      languageMode: "en-US"
    },
    {
      range: { preset: "7d" },
      now: NOW,
      fetchImpl,
      installId: "install_test1234"
    }
  );

  assert.equal(capturedRequest.url, "http://127.0.0.1:8317/v1/chat/completions");
  assert.equal(capturedRequest.init.headers.authorization, "Bearer test-key");
  assert.equal(capturedRequest.body.model, "gpt-5.4");
  assert.equal(result.source, "ai");
  assert.equal(result.recap.headline, "Extension work dominated the week.");
  assert.deepEqual(result.recap.themes[0].pageIds, [1]);
  assert.equal(result.recap.reviewCandidates[0].pageId, 2);
});

test("time recap runtime message returns local fallback without mutating tabs", async () => {
  const chrome = seededRecapChrome();

  const result = await handleRuntimeMessage(chrome, {
    type: "activity:generateTimeRecap",
    settings: { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.FAKE, languageMode: "en-US" },
    languageMode: "en-US",
    range: { preset: "30d" }
  });

  assert.equal(result.source, "local");
  assert.equal(result.recap.schema, "tab_tidy_time_recap_v1");
  assert.equal((await chrome.tabs.query({})).length, 3);
});

test("time recap runtime message can be canceled while AI is running", async () => {
  const chrome = seededRecapChrome();
  const originalFetch = globalThis.fetch;
  let sawAbort = false;
  let releaseFetchStart;
  const fetchStarted = new Promise((resolve) => {
    releaseFetchStart = resolve;
  });
  globalThis.fetch = async (_url, init = {}) => {
    releaseFetchStart();
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => {
          sawAbort = true;
          reject(new Error("fetch aborted"));
        },
        { once: true }
      );
    });
  };

  try {
    const pending = handleRuntimeMessage(chrome, {
      type: "activity:generateTimeRecap",
      operationId: "recap_cancel_test",
      settings: {
        ...DEFAULT_SETTINGS,
        plannerProvider: PLANNER_PROVIDERS.GATEWAY,
        gatewayBaseUrl: "http://127.0.0.1:8317/v1",
        gatewayApiKey: "test-key",
        languageMode: "zh-CN"
      },
      range: { preset: "7d" }
    });
    await fetchStarted;
    const canceled = await handleRuntimeMessage(chrome, {
      type: "activity:cancelTimeRecap",
      operationId: "recap_cancel_test"
    });

    assert.equal(canceled.canceled, true);
    await assert.rejects(pending, /已停止生成回顾/);
    assert.equal(sawAbort, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("time recap local themes do not use existing browser groups as the primary axis", async () => {
  const chrome = seededRecapChrome();

  const result = await generateTimeRecap(
    chrome,
    { ...DEFAULT_SETTINGS, plannerProvider: PLANNER_PROVIDERS.FAKE, languageMode: "zh-CN" },
    { range: { preset: "7d" }, now: NOW }
  );

  assert.equal(result.source, "local");
  assert.equal(result.recap.themes.some((theme) => theme.title === "Extension release"), false);
  assert.equal(result.recap.timeline.length > 0, true);
  assert.match(result.recap.summary, /打开次数/);
});

test("time recap custom range is capped and validates ordering", () => {
  const range = normalizeTimeRecapRange(
    {
      preset: "custom",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-27T06:00:00.000Z"
    },
    NOW
  );

  assert.equal(range.label, "90d");
  assert.equal(Date.parse(range.to) - Date.parse(range.from), 90 * 24 * 60 * 60 * 1000);
  assert.throws(
    () => normalizeTimeRecapRange({ preset: "custom", from: "2026-06-28T00:00:00.000Z", to: "2026-06-27T00:00:00.000Z" }, NOW),
    /after the start/
  );
});

test("time recap preset ranges support quick range buttons", () => {
  assert.equal(normalizeTimeRecapRange({ preset: "1d" }, NOW).label, "1d");
  assert.equal(normalizeTimeRecapRange({ preset: "thisWeek" }, NOW).label, "thisWeek");
  assert.equal(normalizeTimeRecapRange({ preset: "thisMonth" }, NOW).label, "thisMonth");
});

function seededRecapChrome() {
  const chrome = createFakeChrome({
    groups: [{ id: 77, windowId: 1, title: "Extension release", color: "blue" }],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          {
            id: 10,
            title: "TabRecap release checklist",
            url: "https://github.com/acme/SECRET123456789012?token=secret#release",
            active: true,
            groupId: 77
          },
          {
            id: 11,
            title: "Forum thread about extension permissions",
            url: "https://forum.example.com/thread/permissions"
          },
          {
            id: 12,
            title: "Chrome extensions settings",
            url: "chrome://extensions"
          }
        ]
      }
    ]
  });

  chrome.__state.storage[STORAGE_KEYS.pageActivityCache] = {
    version: 1,
    entries: {
      release: {
        key: "release",
        title: "TabRecap release checklist",
        hostname: "github.com",
        sanitizedUrl: "https://github.com/acme",
        firstSeenAt: "2026-06-25T02:00:00.000Z",
        lastSeenAt: "2026-06-27T05:00:00.000Z",
        seenCount: 4,
        sampleable: true,
        sample: {
          title: "Release checklist",
          metaDescription: "Extension release checklist",
          contentKind: "project",
          headings: ["QA", "Release"]
        }
      },
      old: {
        key: "old",
        title: "Old unrelated page",
        hostname: "old.example",
        sanitizedUrl: "https://old.example/archive",
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenAt: "2026-04-02T00:00:00.000Z",
        seenCount: 1
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.pageSummaryCache] = {
    version: 1,
    entries: {
      forum: {
        key: "forum",
        origin: "https://forum.example.com/*",
        title: "Forum thread about extension permissions",
        firstSeenAt: "2026-06-26T03:00:00.000Z",
        lastSeenAt: "2026-06-27T03:00:00.000Z",
        sampledAt: "2026-06-27T03:00:00.000Z",
        lastUsedAt: "2026-06-27T03:00:00.000Z",
        seenCount: 2,
        sample: {
          title: "Forum thread about extension permissions",
          metaDescription: "Discussion about extension permissions",
          contentKind: "discussion",
          headings: ["Host permissions"],
          visibleText: "Readable forum discussion about browser extensions and page access."
        }
      }
    }
  };
  chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog] = {
    version: 1,
    sessions: {
      release: {
        sessionId: "release",
        tabId: 10,
        windowId: 1,
        index: 0,
        title: "TabRecap release checklist",
        hostname: "github.com",
        sanitizedUrl: "https://github.com/acme",
        urlKey: "release",
        openedAt: "2026-06-25T02:00:00.000Z",
        firstObservedAt: "2026-06-25T02:00:00.000Z",
        lastObservedAt: "2026-06-27T05:30:00.000Z",
        lastActivatedAt: "2026-06-27T05:30:00.000Z",
        activeCount: 3,
        groupId: 77
      }
    },
    events: []
  };
  return chrome;
}
