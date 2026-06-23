import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeTabUrl } from "../src/core/url-sanitizer.js";
import { URL_PRIVACY_MODES } from "../src/shared/settings.js";

test("sanitized_url strips query strings, fragments, emails, and long ids", () => {
  const result = sanitizeTabUrl(
    "https://example.com/users/alice@example.com/projects/1234567890abcdef1234567890abcdef/docs?token=secret#frag",
    URL_PRIVACY_MODES.SANITIZED_URL
  );

  assert.equal(result.hostname, "example.com");
  assert.equal(result.sanitizedUrl, "https://example.com/users/projects/docs");
  assert.equal(result.fullUrl, "");
});

test("title_only suppresses URL details", () => {
  const result = sanitizeTabUrl("https://example.com/private/path", URL_PRIVACY_MODES.TITLE_ONLY);
  assert.equal(result.hostname, "");
  assert.equal(result.sanitizedUrl, "");
});
