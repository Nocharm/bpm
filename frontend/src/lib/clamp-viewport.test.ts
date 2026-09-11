import { describe, expect, it } from "vitest";

import { placeBesideAnchor } from "@/lib/clamp-viewport";

describe("placeBesideAnchor", () => {
  const viewport = 800;

  it("aligns the flyout top with the anchor top when it fits", () => {
    expect(placeBesideAnchor({ top: 100, bottom: 160 }, 200, viewport)).toBe(100);
  });

  it("flips to bottom alignment when top alignment would overflow the viewport", () => {
    // 700 + 200 > 800 - 8 → 카드 하단(760)에 모달 하단을 맞춘다
    expect(placeBesideAnchor({ top: 700, bottom: 760 }, 200, viewport)).toBe(560);
    expect(placeBesideAnchor({ top: 780, bottom: 795 }, 300, viewport)).toBe(495);
  });

  it("clamps into the viewport when neither alignment fits", () => {
    // 하단 정렬도 위로 삐져나가면(30 - 790 < 8) 여백 안쪽으로 밀어 넣는다
    expect(placeBesideAnchor({ top: 10, bottom: 30 }, 790, viewport)).toBe(8);
  });
});
