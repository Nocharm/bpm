import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyCategoryLoaded,
  collectCascadeTargets,
  createInitialState,
  fetchCategoryChildren,
  fetchMoreMaps,
  fetchRootChildren,
  hasCachedChildren,
  hasMoreMaps,
  readPersistedTreeState,
  reduceFrameworkTree,
  ROOT,
  shouldFetchChildren,
  shouldFetchMore,
  writePersistedTreeState,
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
  it("루트 로드 - parentId 없이 listCategoryNodes 호출, children_loaded로 리듀스", async () => {
    const rootNodes: CategoryNode[] = [
      { id: 1, code: "A", name: "Root A", level: 1, sort_order: 0, child_count: 2, map_count: 5, linkage_map_id: null, can_edit_linkage: false },
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
  it("펼침 시 자식+맵을 1회만 fetch - 접었다 재펼침해도 캐시라 재요청 없음", async () => {
    const children: CategoryNode[] = [
      { id: 11, code: "A1", name: "Sub A1", level: 2, sort_order: 0, child_count: 0, map_count: 2, linkage_map_id: null, can_edit_linkage: false },
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

  it("펼침 중(fetch 미완료) 접었다 재펼침해도 fetch는 1회만 발생한다 - loadingIds 가드 회귀", async () => {
    const children: CategoryNode[] = [
      { id: 21, code: "B1", name: "Sub B1", level: 2, sort_order: 0, child_count: 0, map_count: 1, linkage_map_id: null, can_edit_linkage: false },
    ];
    const maps: CategoryMaps = { total: 1, hidden: 0, maps: [] };
    let resolveNodes!: (v: CategoryNode[]) => void;
    let resolveMaps!: (v: CategoryMaps) => void;
    listNodesMock.mockReturnValue(new Promise((resolve) => { resolveNodes = resolve; }));
    listMapsMock.mockReturnValue(new Promise((resolve) => { resolveMaps = resolve; }));

    let state = createInitialState();

    // 펼침 — 인플라이트 시작(아직 응답 안 옴). 컴포넌트 handleToggle과 동일 순서로 시뮬레이션.
    expect(shouldFetchChildren(state, 7)).toBe(true);
    state = reduceFrameworkTree(state, { type: "opened", categoryId: 7 });
    state = reduceFrameworkTree(state, { type: "loading_started", categoryId: 7 });
    const inFlight = fetchCategoryChildren(7);

    // 접기 — loadingIds는 그대로(응답 도착 시에만 loading_ended)
    state = reduceFrameworkTree(state, { type: "closed", categoryId: 7 });
    expect(state.openIds.has(7)).toBe(false);

    // 재펼침 — 캐시도 없고 아직 인플라이트라 가드가 재요청을 막아야 한다
    expect(shouldFetchChildren(state, 7)).toBe(false);
    state = reduceFrameworkTree(state, { type: "opened", categoryId: 7 });

    // 인플라이트 응답 도착 — 정상 반영
    resolveNodes(children);
    resolveMaps(maps);
    const loaded = await inFlight;
    state = applyCategoryLoaded(state, 7, loaded.nodes, loaded.maps);

    expect(listNodesMock).toHaveBeenCalledTimes(1);
    expect(listMapsMock).toHaveBeenCalledTimes(1);
    expect(state.childrenByParent.get(7)).toEqual(children);
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
      linkage_map_id: null,
      can_edit_linkage: false,
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

  it("더 보기 연타(응답 전 중복 클릭)해도 fetch는 1회, 중복 id 없이 append된다 - loadingIds 가드 회귀", async () => {
    const initialMaps: CategoryMaps = { total: 3, hidden: 0, maps: [{ id: 1 } as CategoryMaps["maps"][number]] };
    const page2: CategoryMaps = { total: 3, hidden: 0, maps: [{ id: 2 } as CategoryMaps["maps"][number]] };

    let state = reduceFrameworkTree(createInitialState(), {
      type: "maps_loaded",
      categoryId: 3,
      maps: initialMaps,
      append: false,
    });

    let resolvePage!: (v: CategoryMaps) => void;
    listMapsMock.mockReturnValue(new Promise((resolve) => { resolvePage = resolve; }));

    // 1차 클릭 — 인플라이트 시작. 컴포넌트 handleLoadMore와 동일 순서로 시뮬레이션.
    expect(shouldFetchMore(state, 3)).toBe(true);
    state = reduceFrameworkTree(state, { type: "loading_started", categoryId: 3 });
    const inFlight = fetchMoreMaps(state, 3);

    // 2차 클릭(응답 전) — 가드가 재요청을 막아야 한다(막지 않으면 같은 offset이 두 번 나가 중복 id가 붙는다)
    expect(shouldFetchMore(state, 3)).toBe(false);

    resolvePage(page2);
    const loaded = await inFlight;
    state = reduceFrameworkTree(state, { type: "maps_loaded", categoryId: 3, maps: loaded, append: true });
    state = reduceFrameworkTree(state, { type: "loading_ended", categoryId: 3 });

    expect(listMapsMock).toHaveBeenCalledTimes(1);
    const ids = state.mapsByCategory.get(3)?.maps.map((m) => m.id) ?? [];
    expect(ids).toEqual([1, 2]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("펼침 실패 복구", () => {
  it("fetchCategoryChildren 실패 후 loading_ended를 디스패치하면 shouldFetchChildren이 다시 true가 된다 (M-1 회귀)", async () => {
    listNodesMock.mockRejectedValue(new Error("network"));
    listMapsMock.mockResolvedValue({ total: 0, hidden: 0, maps: [] });

    let state = createInitialState();
    expect(shouldFetchChildren(state, 8)).toBe(true);
    state = reduceFrameworkTree(state, { type: "opened", categoryId: 8 });
    state = reduceFrameworkTree(state, { type: "loading_started", categoryId: 8 });

    // 컴포넌트의 .catch가 하는 일 그대로 재현 — fetch 거부 후 loading_ended만 디스패치.
    await expect(fetchCategoryChildren(8)).rejects.toThrow();
    state = reduceFrameworkTree(state, { type: "loading_ended", categoryId: 8 });

    expect(state.loadingIds.has(8)).toBe(false);
    expect(shouldFetchChildren(state, 8)).toBe(true); // 캐시 없고 인플라이트도 아니므로 재시도 가능
  });
});

describe("hasMoreMaps", () => {
  it("total이 (가시 maps 수 + hidden)보다 클 때만 true - hidden도 합산에 포함해야 한다", () => {
    const loaded = reduceFrameworkTree(createInitialState(), {
      type: "maps_loaded",
      categoryId: 1,
      maps: {
        total: 5,
        hidden: 2,
        maps: [{ id: 1 } as CategoryMaps["maps"][number], { id: 2 } as CategoryMaps["maps"][number]],
      },
      append: false,
    });
    // shown(2) + hidden(2) = 4 < total(5) → 더 있음
    expect(hasMoreMaps(loaded, 1)).toBe(true);

    const exhausted = reduceFrameworkTree(loaded, {
      type: "maps_loaded",
      categoryId: 1,
      maps: { total: 5, hidden: 2, maps: [{ id: 3 } as CategoryMaps["maps"][number]] },
      append: true,
    });
    // shown(3) + hidden(2) = 5 == total(5) → 경계에서 더 없음
    expect(hasMoreMaps(exhausted, 1)).toBe(false);

    // 캐시가 없는 카테고리는 무조건 false
    expect(hasMoreMaps(createInitialState(), 99)).toBe(false);
  });
});

describe("collectCascadeTargets", () => {
  const makeNode = (id: number, mapCount: number): CategoryNode => ({
    id, code: `C${id}`, name: `Cat ${id}`, level: 2, sort_order: id, child_count: 0, map_count: mapCount, linkage_map_id: null, can_edit_linkage: false,
  });

  it("맵 있는(서브트리 rollup>0) 자식만 예산 내에서 - 빈 가지는 제외, 초과분은 잘린다", () => {
    const nodes = [makeNode(1, 3), makeNode(2, 0), makeNode(3, 1), makeNode(4, 2)];
    expect(collectCascadeTargets(nodes, 10)).toEqual([1, 3, 4]);
    expect(collectCascadeTargets(nodes, 2)).toEqual([1, 3]);
    expect(collectCascadeTargets(nodes, 0)).toEqual([]);
    // 음수 예산(과차감 방어)도 빈 배열
    expect(collectCascadeTargets(nodes, -1)).toEqual([]);
  });
});

describe("펼침 상태 영속", () => {
  it("write→read 라운드트립 - openIds·expandedLists 둘 다 배열로 저장·복원된다", () => {
    writePersistedTreeState(new Set([3, 7]), new Set([7]));
    expect(readPersistedTreeState()).toEqual({ openIds: [3, 7], expandedLists: [7] });
  });

  it("손상 JSON·타입 오염·구버전 블롭(expandedLists 없음)은 무해하게 무시", () => {
    window.localStorage.setItem("bpm.framework.tree", "{broken");
    expect(readPersistedTreeState()).toEqual({ openIds: [], expandedLists: [] });
    window.localStorage.setItem(
      "bpm.framework.tree",
      JSON.stringify({ openIds: [1, "x", 2], expandedLists: "nope" }),
    );
    expect(readPersistedTreeState()).toEqual({ openIds: [1, 2], expandedLists: [] });
    // 구버전 블롭 — openIds만 있던 이전 커밋 저장값과의 호환
    window.localStorage.setItem("bpm.framework.tree", JSON.stringify({ openIds: [5] }));
    expect(readPersistedTreeState()).toEqual({ openIds: [5], expandedLists: [] });
    window.localStorage.removeItem("bpm.framework.tree");
    expect(readPersistedTreeState()).toEqual({ openIds: [], expandedLists: [] });
  });
});
