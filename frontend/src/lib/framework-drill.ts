// 홈 업무 체계 드릴다운 뷰의 순수 헬퍼 — 현재 위치·방문 기록 영속, 형제 목록, L5 카드 상태 라벨.
// 렌더러(components/maps/framework-drill.tsx)는 얇게 두고 판정은 여기서 테스트한다 (목업 v4 확정 2026-09-19).

import type { CategoryNode } from "@/lib/api";

// 현재 위치(드릴인한 카테고리 id) 영속 키 — 구 트리 openIds 영속(bpm.framework.tree)과 별도.
export const DRILL_STATE_KEY = "bpm.home.frameworkDrill";

export type CanvasState = NonNullable<CategoryNode["canvas_state"]>;

// L5 카드 상태 라벨 — 맵 카드 상태 필과 같은 규칙으로 언어 무관 영어 고정(사용자 결정 2026-09-18).
export const CANVAS_STATE_LABEL_EN: Record<CanvasState, string> = {
  none: "No canvas",
  draft: "Draft",
  confirmed: "Confirmed",
};

// linkage 유무만 아는 노드(/chain 응답 등 canvas_state null)는 draft/none으로 보수적 판정.
export function getCanvasState(node: Pick<CategoryNode, "canvas_state" | "linkage_map_id">): CanvasState {
  if (node.canvas_state) return node.canvas_state;
  return node.linkage_map_id === null ? "none" : "draft";
}

// 최근 연 카테고리 id 목록 상한 — 형제 열의 "최근 열어봄" 점 표시용, 그 이상은 오래된 것부터 버린다.
export const RECENT_CAP = 100;

export interface PersistedDrill {
  currentId: number | null;
  // 최근에 현재 위치였던 카테고리 id, 앞이 최신. 넘친 형제 칩을 "현재 + 최근 연 것"으로 고르는 근거
  recent: number[];
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function readPersistedDrill(): PersistedDrill {
  const empty: PersistedDrill = { currentId: null, recent: [] };
  try {
    const raw = window.localStorage.getItem(DRILL_STATE_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const obj = parsed as { currentId?: unknown; recent?: unknown };
    return {
      currentId: isId(obj.currentId) ? obj.currentId : null,
      recent: Array.isArray(obj.recent) ? obj.recent.filter(isId).slice(0, RECENT_CAP) : [],
    };
  } catch {
    return empty;
  }
}

export function writePersistedDrill(state: PersistedDrill): void {
  try {
    window.localStorage.setItem(DRILL_STATE_KEY, JSON.stringify(state));
  } catch {
    // 스토리지 차단(프라이빗 모드 등)은 조용히 무시 — 영속은 편의 기능
  }
}

// 방문 기록 앞에 id를 올린다(중복 제거·상한). 현재 위치가 바뀔 때마다 호출.
export function bumpRecent(recent: number[], id: number): number[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_CAP);
}

// 형제 열 후보 — 같은 부모의 level<5 노드만(L5는 드릴인 대상이 아니라 형제 열이 아닌 카드).
export function getSiblingRows(parentChildren: CategoryNode[]): CategoryNode[] {
  return parentChildren.filter((n) => n.level < 5);
}

// 헤더 카운트용 현재 노드 — 체인 응답은 카운트가 0 고정이라 부모의 자식 목록에서 같은 id를 찾아 쓴다.
export function resolveCurrentNode(current: CategoryNode, parentChildren: CategoryNode[] | undefined): CategoryNode {
  return parentChildren?.find((n) => n.id === current.id) ?? current;
}

