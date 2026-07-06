import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isHttpUrl, isSafePreviewUrl } from "./url";

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

describe("isSafePreviewUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["https://example.com/page", "http://wms.acme-corp.com/inbound"])(
    "accepts %s",
    (value) => {
      expect(isSafePreviewUrl(value)).toBe(true);
    },
  );

  it.each([
    "http://localhost:3000/maps/2",
    "http://LOCALHOST:3000/x",
    "javascript:alert(1)",
    "",
    "http://",
  ])("rejects %s", (value) => {
    expect(isSafePreviewUrl(value)).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isSafePreviewUrl(null)).toBe(false);
    expect(isSafePreviewUrl(undefined)).toBe(false);
  });
});
