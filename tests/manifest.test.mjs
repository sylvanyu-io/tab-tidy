import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("extension uses an action popup instead of a side panel", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal(manifest.action.default_popup, "src/sidepanel/index.html");
  assert.equal(manifest.side_panel, undefined);
  assert.equal((manifest.permissions || []).includes("sidePanel"), false);
});
