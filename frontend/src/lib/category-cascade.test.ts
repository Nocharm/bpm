import { describe, expect, it } from "vitest";

import { pickCascadeLevel, seedChainIds, seedLevelParents } from "./category-cascade";

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

describe("seedChainIds", () => {
  it("조상 체인(루트→자신) 노드에서 id만 추출한다 — 캐스케이드 선택 체인 시딩값", () => {
    expect(seedChainIds([{ id: 1 }, { id: 2 }, { id: 3 }])).toEqual([1, 2, 3]);
  });
});

describe("seedLevelParents", () => {
  it("depth 0은 루트(undefined), 이후 depth는 이전 depth의 id — 레벨별 옵션 prefetch용 parentId 목록", () => {
    expect(seedLevelParents([1, 2, 3])).toEqual([undefined, 1, 2]);
  });
});
