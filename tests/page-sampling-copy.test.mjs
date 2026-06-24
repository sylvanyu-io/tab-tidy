import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowPageSampleCount } from "../src/shared/page-sampling-copy.js";

test("page-sample count copy uses either absolute count or meaningful coverage", () => {
  assert.equal(shouldShowPageSampleCount(2, 244), false);
  assert.equal(shouldShowPageSampleCount(4, 8), true);
  assert.equal(shouldShowPageSampleCount(8, 244), true);
  assert.equal(shouldShowPageSampleCount(1, 2), false);
  assert.equal(shouldShowPageSampleCount(0, 8), false);
});
