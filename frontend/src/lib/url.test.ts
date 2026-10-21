import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isHttpUrl, isSafePreviewUrl, toSafeHref } from "./url";

describe("toSafeHref", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["  HTTP://UPPER.EXAMPLE.COM  ", "HTTP://UPPER.EXAMPLE.COM"],
    ["mailto:someone@example.com", "mailto:someone@example.com"],
  ])("keeps allowed scheme %s", (value, expected) => {
    expect(toSafeHref(value)).toBe(expected);
  });

  it.each([
    ["www.naver.com", "https://www.naver.com"],
    ["example.com/path?q=1", "https://example.com/path?q=1"],
    ["intranet:8080/wiki", "https://intranet:8080/wiki"],
    ["//cdn.example.com/x", "https://cdn.example.com/x"],
  ])("adds https:// to scheme-less %s", (value, expected) => {
    expect(toSafeHref(value)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "vbscript:msgbox(1)",
    "ftp://files.example.com",
    "file:///etc/passwd",
  ])("blocks %j", (value) => {
    expect(toSafeHref(value)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(toSafeHref("")).toBeNull();
    expect(toSafeHref("   ")).toBeNull();
    expect(toSafeHref(null)).toBeNull();
    expect(toSafeHref(undefined)).toBeNull();
  });
});

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
