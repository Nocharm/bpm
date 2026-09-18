// 홈 업무 체계 드릴다운 뷰의 순수 헬퍼 — 현재 위치 영속, 형제 칩 노출 계산, L5 카드 상태 라벨.
// 렌더러(components/maps/framework-drill.tsx)는 얇게 두고 판정은 여기서 테스트한다 (목업 B안 확정 2026-09-18).

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

export function readPersistedDrill(): number | null {
  try {
    const raw = window.localStorage.getItem(DRILL_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "currentId" in parsed) {
      const id = (parsed as { currentId: unknown }).currentId;
      return typeof id === "number" && Number.isFinite(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function writePersistedDrill(currentId: number | null): void {
  try {
    window.localStorage.setItem(DRILL_STATE_KEY, JSON.stringify({ currentId }));
  } catch {
    // 스토리지 차단(프라이빗 모드 등)은 조용히 무시 — 영속은 편의 기능
  }
}

// 형제 칩 후보 — 같은 부모의 level<5 노드만(L5는 드릴인 대상이 아니라 칩이 아닌 카드).
export function getSiblingRows(parentChildren: CategoryNode[]): CategoryNode[] {
  return parentChildren.filter((n) => n.level < 5);
}

// 헤더 카운트용 현재 노드 — 체인 응답은 카운트가 0 고정이라 부모의 자식 목록에서 같은 id를 찾아 쓴다.
export function resolveCurrentNode(current: CategoryNode, parentChildren: CategoryNode[] | undefined): CategoryNode {
  return parentChildren?.find((n) => n.id === current.id) ?? current;
}

// 형제 칩 노출 인덱스 — 가용 폭 안에 순서대로 채우되 전부 안 들어가면 "더 보기" 버튼 폭을 미리 뺀다.
// 현재 칩은 항상 보이게: 잘린 구간에 있으면 마지막 자리를 현재 칩으로 바꾼다(순서는 원본 유지).
export function pickVisibleChips(
  widths: number[],
  currentIndex: number,
  available: number,
  moreWidth: number,
  gap: number,
): Set<number> {
  const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
  if (total <= available) return new Set(widths.map((_, i) => i));
  const limit = available - moreWidth - gap;
  const picked: number[] = [];
  let used = 0;
  for (let i = 0; i < widths.length; i += 1) {
    const next = used + widths[i] + (picked.length > 0 ? gap : 0);
    if (next > limit) break;
    picked.push(i);
    used = next;
  }
  if (currentIndex >= 0 && !picked.includes(currentIndex)) {
    if (picked.length > 0) picked.pop();
    picked.push(currentIndex);
  }
  return new Set(picked);
}
