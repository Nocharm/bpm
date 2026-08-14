import { describe, expect, it } from "vitest";

import { pickFilterDisplayMode } from "./filter-display";

describe("pickFilterDisplayMode", () => {
  const widths = { full: 400, label: 300 };

  it("full+margin이 들어가면 full", () => {
    expect(pickFilterDisplayMode(408, widths)).toBe("full");
  });

  it("full은 안 되고 label은 되면 label", () => {
    expect(pickFilterDisplayMode(407, widths)).toBe("label");
    expect(pickFilterDisplayMode(308, widths)).toBe("label");
  });

  it("label도 안 되면 icon", () => {
    expect(pickFilterDisplayMode(307, widths)).toBe("icon");
  });

  it("측정 전(0 폭)엔 full 유지", () => {
    expect(pickFilterDisplayMode(0, { full: 0, label: 0 })).toBe("full");
    expect(pickFilterDisplayMode(500, { full: 0, label: 0 })).toBe("full");
  });
});
