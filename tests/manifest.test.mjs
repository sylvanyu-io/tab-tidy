import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("extension uses a persistent action-launched popup window", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
  assert.equal(manifest.side_panel, undefined);
  assert.equal((manifest.permissions || []).includes("sidePanel"), false);
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
});
