import assert from "node:assert/strict";
import test from "node:test";
import { reconcileTabLifecycle, recordTabClosed, rememberTabLifecycle, rememberTabsLifecycle } from "../src/core/tab-lifecycle-log.js";
import { STORAGE_KEYS } from "../src/core/storage.js";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";

test("tab lifecycle log records open activation and close without sensitive URL parts", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tab = {
    id: 7,
    windowId: 1,
    index: 0,
    title: "Billing token page",
    url: "https://example.com/project/SECRET123456789012?token=abc#section",
    active: true
  };

  await rememberTabLifecycle(chrome, "tab_created", tab, { now });
  await rememberTabLifecycle(chrome, "tab_activated", tab, { now: now + 1000 });
  const closed = await recordTabClosed(chrome, 7, { windowId: 1, isWindowClosing: false }, { now: now + 2000 });

  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];
  assert.equal(JSON.stringify(log).includes("token=abc"), false);
  assert.equal(JSON.stringify(log).includes("SECRET123456789012"), false);
  assert.equal(closed.closedAt, "2026-06-25T00:00:02.000Z");
  assert.equal(closed.closeReason, "tab_closed");
  assert.equal(Object.values(log.sessions)[0].activeCount, 1);
  assert.equal(log.events.map((event) => event.type).includes("tab_closed"), true);
});

test("tab lifecycle reconciliation infers missed opens and closes", async () => {
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const chrome = createFakeChrome({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 10, title: "Research page", url: "https://example.com/research", active: true }]
      }
    ]
  });

  const firstStats = await reconcileTabLifecycle(chrome, { now });
  assert.equal(firstStats.openSessions, 1);
  assert.equal(firstStats.reconcileStats.inferredOpened, 1);

  chrome.__state.windows.get(1).tabs = [];
  const secondStats = await reconcileTabLifecycle(chrome, { now: now + 5000 });

  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];
  const session = Object.values(log.sessions)[0];
  assert.equal(secondStats.openSessions, 0);
  assert.equal(secondStats.inferredClosed, 1);
  assert.equal(session.closeReason, "missing_after_reconcile");
  assert.equal(log.events.some((event) => event.type === "tab_closed_inferred"), true);
});

test("tab lifecycle writes are queued so concurrent events do not overwrite each other", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");
  const tabs = Array.from({ length: 24 }, (_, index) => ({
    id: 100 + index,
    windowId: 1,
    index,
    title: `Queued tab ${index}`,
    url: `https://example.com/page-${index}`,
    active: index === 0
  }));

  await Promise.all(tabs.map((tab, index) => rememberTabLifecycle(chrome, "tab_seen", tab, { now: now + index })));

  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];
  assert.equal(Object.keys(log.sessions).length, 24);
  assert.equal(log.events.filter((event) => event.type === "tab_seen").length, 24);
});

test("tab lifecycle can store an inventory in one batch", async () => {
  const chrome = createFakeChrome();
  const tabs = [
    { id: 1, windowId: 1, index: 0, title: "A", url: "https://a.example/", active: true },
    { id: 2, windowId: 1, index: 1, title: "B", url: "https://b.example/", active: false }
  ];

  const result = await rememberTabsLifecycle(chrome, tabs, { now: Date.parse("2026-06-25T00:00:00.000Z") });
  const log = chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog];

  assert.equal(result.stored, 2);
  assert.equal(Object.keys(log.sessions).length, 2);
});

test("tab lifecycle activation count only increments on real re-entry", async () => {
  const chrome = createFakeChrome();
  const now = Date.parse("2026-06-25T00:00:00.000Z");

  await rememberTabsLifecycle(
    chrome,
    [
      { id: 1, windowId: 1, index: 0, title: "One", url: "https://a.example/", active: true },
      { id: 2, windowId: 1, index: 1, title: "Two", url: "https://b.example/", active: false }
    ],
    { now }
  );
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { id: 1, windowId: 1, index: 0, title: "One", url: "https://a.example/", active: true },
    { now: now + 1000 }
  );
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { id: 2, windowId: 1, index: 1, title: "Two", url: "https://b.example/", active: true },
    { now: now + 2000 }
  );
  await rememberTabLifecycle(
    chrome,
    "tab_activated",
    { id: 1, windowId: 1, index: 0, title: "One", url: "https://a.example/", active: true },
    { now: now + 3000 }
  );

  const sessions = Object.values(chrome.__state.storage[STORAGE_KEYS.tabLifecycleLog].sessions).sort((left, right) => left.tabId - right.tabId);
  assert.equal(sessions[0].activeCount, 2);
  assert.equal(sessions[1].activeCount, 1);
  assert.equal(sessions[0].active, true);
  assert.equal(sessions[1].active, false);
});
