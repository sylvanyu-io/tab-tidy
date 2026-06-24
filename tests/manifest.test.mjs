import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("extension uses a persistent action-launched popup window", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
  assert.equal(manifest.side_panel, undefined);
  assert.equal((manifest.permissions || []).includes("sidePanel"), false);
  assert.deepEqual(manifest.host_permissions, ["https://cliproxy.sylvanyu.io/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
});

test("store extension build strips experimental content-reading permissions", async () => {
  const result = spawnSync("npm", ["run", "build:extension:store"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifest = JSON.parse(await readFile("dist/extension/manifest.json", "utf8"));
  assert.equal((manifest.permissions || []).includes("activeTab"), false);
  assert.equal((manifest.optional_permissions || []).includes("scripting"), false);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.deepEqual(manifest.host_permissions, ["https://cliproxy.sylvanyu.io/*"]);
});
