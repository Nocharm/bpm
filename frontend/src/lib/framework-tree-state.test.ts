import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyCategoryLoaded,
  createInitialState,
  fetchCategoryChildren,
  fetchRootChildren,
  hasCachedChildren,
  reduceFrameworkTree,
  ROOT,
} from "./framework-tree-state";
import { listCategoryMaps, listCategoryNodes, type CategoryMaps, type CategoryNode } from "./api";

// 외부 API만 모킹 — 캐시/펼침 판단은 실코드 경로로 검증 (self-publish.test.ts와 동일 관례).
vi.mock("./api", () => ({
  listCategoryNodes: vi.fn(),
  listCategoryMaps: vi.fn(),
}));

const listNodesMock = vi.mocked(listCategoryNodes);
const listMapsMock = vi.mocked(listCategoryMaps);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRootChildren", () => {
  it("루트 로드 — parentId 없이 listCategoryNodes 호출, children_loaded로 리듀스", async () => {
    const rootNodes: CategoryNode[] = [
      { id: 1, code: "A", name: "Root A", level: 1, sort_order: 0, child_count: 2, map_count: 5 },
    ];
    listNodesMock.mockResolvedValue(rootNodes);

    const nodes = await fetchRootChildren();
    const state = reduceFrameworkTree(createInitialState(), {
      type: "children_loaded",
      parentId: ROOT,
      nodes,
    });

    expect(listNodesMock).toHaveBeenCalledWith();
    expect(state.childrenByParent.get(ROOT)).toEqual(rootNodes);
  });
});

describe("펼침 캐시", () => {
  it("펼침 시 자식+맵을 1회만 fetch — 접었다 재펼침해도 캐시라 재요청 없음", async () => {
    const children: CategoryNode[] = [
      { id: 11, code: "A1", name: "Sub A1", level: 2, sort_order: 0, child_count: 0, map_count: 2 },
    ];
    const maps: CategoryMaps = { total: 2, hidden: 0, maps: [] };
    listNodesMock.mockResolvedValue(children);
    listMapsMock.mockResolvedValue(maps);

    let state = createInitialState();
    expect(hasCachedChildren(state, 5)).toBe(false);

    // 최초 펼침 — fetch 발생
    const loaded = await fetchCategoryChildren(5);
    state = applyCategoryLoaded(
      reduceFrameworkTree(state, { type: "opened", categoryId: 5 }),
      5,
      loaded.nodes,
      loaded.maps,
    );
    expect(listNodesMock).toHaveBeenCalledTimes(1);
    expect(listMapsMock).toHaveBeenCalledTimes(1);

    // 접기
    state = reduceFrameworkTree(state, { type: "closed", categoryId: 5 });
    expect(state.openIds.has(5)).toBe(false);

    // 재펼침 — 캐시 있으므로 fetch 호출하지 않는다(컴포넌트는 hasCachedChildren로 가드)
    expect(hasCachedChildren(state, 5)).toBe(true);
    state = reduceFrameworkTree(state, { type: "opened", categoryId: 5 });

    expect(listNodesMock).toHaveBeenCalledTimes(1);
    expect(listMapsMock).toHaveBeenCalledTimes(1);
    expect(state.childrenByParent.get(5)).toEqual(children);
  });
});

describe("hidden·빈 카테고리 표시", () => {
  it("hidden>0과 빈 카테고리(map_count=0·child_count=0) 노드를 상태에 그대로 보존한다", async () => {
    const emptyNode: CategoryNode = {
      id: 9,
      code: "C9",
      name: "Empty Cat",
      level: 2,
      sort_order: 1,
      child_count: 0,
      map_count: 0,
    };
    const maps: CategoryMaps = {
      total: 3,
      hidden: 2,
      maps: [{ id: 100, name: "visible map" } as CategoryMaps["maps"][number]],
    };
    listNodesMock.mockResolvedValue([emptyNode]);
    listMapsMock.mockResolvedValue(maps);

    let state = createInitialState();
    const loaded = await fetchCategoryChildren(1);
    state = applyCategoryLoaded(
      reduceFrameworkTree(state, { type: "opened", categoryId: 1 }),
      1,
      loaded.nodes,
      loaded.maps,
    );

    // 빈 카테고리도 목록에서 걸러지지 않는다 — 컴포넌트가 무조건 행으로 렌더할 데이터가 보존됨을 증명
    expect(state.childrenByParent.get(1)).toEqual([emptyNode]);
    expect(state.mapsByCategory.get(1)?.hidden).toBe(2);
    expect(state.mapsByCategory.get(1)?.total).toBe(3);
    expect(state.mapsByCategory.get(1)?.maps).toHaveLength(1);
  });
});

describe("loadMoreMaps", () => {
  it("append=true는 기존 맵 뒤에 새 페이지를 이어붙인다", () => {
    const state1 = reduceFrameworkTree(createInitialState(), {
      type: "maps_loaded",
      categoryId: 1,
      maps: { total: 3, hidden: 0, maps: [{ id: 1 } as CategoryMaps["maps"][number]] },
      append: false,
    });
    const state2 = reduceFrameworkTree(state1, {
      type: "maps_loaded",
      categoryId: 1,
      maps: { total: 3, hidden: 0, maps: [{ id: 2 } as CategoryMaps["maps"][number]] },
      append: true,
    });
    expect(state2.mapsByCategory.get(1)?.maps.map((m) => m.id)).toEqual([1, 2]);
  });
});
