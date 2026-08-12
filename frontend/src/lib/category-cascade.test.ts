import { describe, expect, it } from "vitest";

import { pickCascadeLevel } from "./category-cascade";

describe("pickCascadeLevel", () => {
  it("체인 구축 — 레벨을 차례로 고르면 그 순서대로 누적된다", () => {
    let chain: number[] = [];
    chain = pickCascadeLevel(chain, 0, 1);
    expect(chain).toEqual([1]);
    chain = pickCascadeLevel(chain, 1, 2);
    expect(chain).toEqual([1, 2]);
    chain = pickCascadeLevel(chain, 2, 3);
    expect(chain).toEqual([1, 2, 3]);
  });

  it("하위 리셋 — 얕은 레벨을 재선택하면 그보다 깊은 선택은 사라진다", () => {
    const chain = [1, 2, 3];
    expect(pickCascadeLevel(chain, 1, 9)).toEqual([1, 9]);
    expect(pickCascadeLevel(chain, 0, 5)).toEqual([5]);
  });
});
