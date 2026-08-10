// Framework 탭(홈) lazy 카테고리 트리 — 캐시·펼침 상태 전이는 순수 리듀서로, fetch 오케스트레이션은
// 별도 async 함수로 분리한다. 컴포넌트(framework-tree.tsx)는 이 모듈을 호출하는 thin 렌더러다.
import { listCategoryMaps, listCategoryNodes, type CategoryMaps, type CategoryNode } from "./api";

// 루트(최상위 레벨)의 부모 키 — CategoryNode.id(number)와 겹치지 않는 리터럴 센티널.
export type ParentKey = number | "root";
export const ROOT: ParentKey = "root";

export interface FrameworkTreeState {
  // 1회 fetch 캐시 — 같은 parentId 재펼침 시 재요청하지 않는다.
  childrenByParent: Map<ParentKey, CategoryNode[]>;
  mapsByCategory: Map<number, CategoryMaps>;
  openIds: Set<number>;
  loadingIds: Set<number>;
}

export function createInitialState(): FrameworkTreeState {
  return {
    childrenByParent: new Map(),
    mapsByCategory: new Map(),
    openIds: new Set(),
    loadingIds: new Set(),
  };
}

export type FrameworkTreeAction =
  | { type: "children_loaded"; parentId: ParentKey; nodes: CategoryNode[] }
  | { type: "maps_loaded"; categoryId: number; maps: CategoryMaps; append: boolean }
  | { type: "opened"; categoryId: number }
  | { type: "closed"; categoryId: number }
  | { type: "loading_started"; categoryId: number }
  | { type: "loading_ended"; categoryId: number };

// 순수 상태 전이 — fetch·타이밍 무관. 컴포넌트는 항상 함수형 setState(prev => reduce(prev, action))로
// 적용해 동시 펼침 경합에도 최신 상태 위에 병합한다.
export function reduceFrameworkTree(
  state: FrameworkTreeState,
  action: FrameworkTreeAction,
): FrameworkTreeState {
  switch (action.type) {
    case "children_loaded": {
      const childrenByParent = new Map(state.childrenByParent);
      childrenByParent.set(action.parentId, action.nodes);
      return { ...state, childrenByParent };
    }
    case "maps_loaded": {
      const mapsByCategory = new Map(state.mapsByCategory);
      const prev = mapsByCategory.get(action.categoryId);
      const merged: CategoryMaps =
        action.append && prev
          ? { total: action.maps.total, hidden: action.maps.hidden, maps: [...prev.maps, ...action.maps.maps] }
          : action.maps;
      mapsByCategory.set(action.categoryId, merged);
      return { ...state, mapsByCategory };
    }
    case "opened": {
      const openIds = new Set(state.openIds);
      openIds.add(action.categoryId);
      return { ...state, openIds };
    }
    case "closed": {
      const openIds = new Set(state.openIds);
      openIds.delete(action.categoryId);
      return { ...state, openIds };
    }
    case "loading_started": {
      const loadingIds = new Set(state.loadingIds);
      loadingIds.add(action.categoryId);
      return { ...state, loadingIds };
    }
    case "loading_ended": {
      const loadingIds = new Set(state.loadingIds);
      loadingIds.delete(action.categoryId);
      return { ...state, loadingIds };
    }
    default:
      return state;
  }
}

// 캐시 판단 — true면 펼침 핸들러가 fetch를 건너뛴다.
export function hasCachedChildren(state: FrameworkTreeState, parentId: ParentKey): boolean {
  return state.childrenByParent.has(parentId);
}

// 펼침 fetch 가드 — 캐시가 있거나 이미 인플라이트(닫았다 재펼침해도 첫 요청이 아직 안 끝남)면 재요청하지 않는다.
export function shouldFetchChildren(state: FrameworkTreeState, categoryId: number): boolean {
  return !hasCachedChildren(state, categoryId) && !state.loadingIds.has(categoryId);
}

// "더 보기" fetch 가드 — 인플라이트 중 중복 클릭 시 같은 offset으로 재요청되어 중복 id가 append되는 것을 막는다.
export function shouldFetchMore(state: FrameworkTreeState, categoryId: number): boolean {
  return !state.loadingIds.has(categoryId);
}

// "더 보기" 버튼 노출 조건 — 이미 로드된 맵(가시 maps + 마스킹된 hidden) 합이 total보다 적을 때만 더 있다.
export function hasMoreMaps(state: FrameworkTreeState, categoryId: number): boolean {
  const mapsData = state.mapsByCategory.get(categoryId);
  if (!mapsData) return false;
  return mapsData.total > mapsData.maps.length + mapsData.hidden;
}

// 루트 목록 — parentId 생략 호출(최상위 레벨).
export function fetchRootChildren(): Promise<CategoryNode[]> {
  return listCategoryNodes();
}

// 노드 펼침 — 자식 카테고리 + 그 카테고리 직속 맵을 병렬 fetch. 캐시 여부 판단(hasCachedChildren)은
// 호출부(컴포넌트) 책임 — 여기선 무조건 요청한다.
export async function fetchCategoryChildren(
  categoryId: number,
): Promise<{ nodes: CategoryNode[]; maps: CategoryMaps }> {
  const [nodes, maps] = await Promise.all([listCategoryNodes(categoryId), listCategoryMaps(categoryId)]);
  return { nodes, maps };
}

// fetchCategoryChildren 결과를 "opened" 이후 상태에 병합 — children_loaded → maps_loaded → loading_ended 순.
export function applyCategoryLoaded(
  state: FrameworkTreeState,
  categoryId: number,
  nodes: CategoryNode[],
  maps: CategoryMaps,
): FrameworkTreeState {
  let next = reduceFrameworkTree(state, { type: "children_loaded", parentId: categoryId, nodes });
  next = reduceFrameworkTree(next, { type: "maps_loaded", categoryId, maps, append: false });
  next = reduceFrameworkTree(next, { type: "loading_ended", categoryId });
  return next;
}

// "더 보기" — 현재 로드된 맵 개수를 offset 삼아 다음 페이지 요청.
export function fetchMoreMaps(state: FrameworkTreeState, categoryId: number): Promise<CategoryMaps> {
  const offset = state.mapsByCategory.get(categoryId)?.maps.length ?? 0;
  return listCategoryMaps(categoryId, offset);
}
