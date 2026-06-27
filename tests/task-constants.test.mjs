import assert from "node:assert/strict";
import test from "node:test";
import { TIME_RECAP_GATEWAY_TIMEOUT_MS as SHARED_TIME_RECAP_TIMEOUT_MS } from "../src/shared/task-constants.js";
import { TIME_RECAP_GATEWAY_TIMEOUT_MS as CORE_TIME_RECAP_TIMEOUT_MS } from "../src/core/time-recap.js";

test("time recap UI and core use the same long AI timeout", () => {
  assert.equal(SHARED_TIME_RECAP_TIMEOUT_MS, 300_000);
  assert.equal(CORE_TIME_RECAP_TIMEOUT_MS, SHARED_TIME_RECAP_TIMEOUT_MS);
});
