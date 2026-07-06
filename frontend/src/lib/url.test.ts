import { describe, expect, it } from "vitest";

import { isHttpUrl } from "./url";

describe("isHttpUrl", () => {
  it.each([
    "https://example.com",
    "http://wms.acme-corp.com/inbound/inspect",
    "HTTPS://UPPER.EXAMPLE.COM/path",
    "  https://padded.example.com  ",
  ])("accepts %s", (value) => {
    expect(isHttpUrl(value)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "ftp://files.example.com",
    "example.com",
    "//protocol-relative.example.com",
  ])("rejects %s", (value) => {
    expect(isHttpUrl(value)).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});
