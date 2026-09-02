// 표시 높이(실측)로 커진 노드가 "실제 충돌하는" 아래 노드만 미는 표시 Y 오프셋 — 저장 좌표 불변.
// 성장분은 기존 저장 여백을 먼저 흡수하고, 밀 때 표시 간격은 min(저장 간격, MIN_GAP)을 유지한다.
// 같은 행(저장 Y구간 strict 겹침 체인)은 밀림량을 행 max로 동기화해 가로 정렬을 보존한다.
import {
  estimateNodeHeight,
  estimateNodeWidth,
  nodeSizeOf,
  type AppNode,
} from "@/lib/canvas";

// 4px 미만 성장은 무시 — 폰트 렌더 편차로 인한 미세 지터 방지
const EPSILON = 4;
// 밀 때 유지하는 표시 여백 상한(px) — 원래 저장 간격이 더 좁으면 그 좁은 간격을 그대로 유지
export const HEIGHT_MIN_GAP = 16;

/** 역변환 프로브가 참조하는 푸셔 — 기준높이 아래(base)보다 표시 bottom이 내려온 노드. */
export interface HeightPusher {
  id: string; // 원본 노드 id — 드래그 역변환에서 자기 자신 제외용
  x0: number; // 저장 X 구간(표시 X와 동일 — 인라인 펼침 중엔 height-shift가 게이트 오프)
  x1: number;
  baseBottom: number; // 저장 y + 기준높이 — savedGap 판정 기준
  dispBottom: number; // 저장 y + 행 오프셋 + 표시높이
}

export interface HeightShiftField {
  offsets: ReadonlyMap<string, number>;
  pushers: readonly HeightPusher[];
}

export const EMPTY_HEIGHT_FIELD: HeightShiftField = { offsets: new Map(), pushers: [] };

/** 표시 높이 — React Flow 실측 우선, 미측정(첫 페인트)은 라벨 기반 추정 폴백. */
export function getDisplayHeight(node: AppNode): number {
  const measured = node.measured?.height;
  if (measured !== undefined && measured > 0) return measured;
  const type = node.data.nodeType;
  return estimateNodeHeight(node.data.label, type, estimateNodeWidth(node.data.label, type));
}

/** 표시 폭 — 실측 우선, 미측정은 라벨 기반 추정 폴백. */
export function getDisplayWidth(node: AppNode): number {
  const measured = node.measured?.width;
  if (measured !== undefined && measured > 0) return measured;
  return estimateNodeWidth(node.data.label, node.data.nodeType);
}

interface FieldItem {
  id: string;
  top: number;
  baseBottom: number;
  x0: number;
  x1: number;
  dispH: number;
}

/**
 * 충돌 기반 오프셋 필드 — 행(저장 Y 오름차순)을 위에서부터 처리하며, 각 행의 필요 밀림량
 * (X 구간이 겹치는 위쪽 푸셔의 dispBottom + min(savedGap, MIN_GAP) − top)의 max를 행 전체에
 * 부여한다. 밀리거나 커진 노드는 다시 푸셔가 되어 아래 행으로 연쇄한다. section은 제외.
 */
export function buildHeightShiftField(nodes: AppNode[]): HeightShiftField {
  const items: FieldItem[] = nodes
    .filter((node) => node.data.nodeType !== "section")
    .map((node) => {
      const baseH = nodeSizeOf(node.data.nodeType).h;
      const dispH = getDisplayHeight(node);
      return {
        id: node.id,
        top: node.position.y,
        baseBottom: node.position.y + baseH,
        x0: node.position.x,
        x1: node.position.x + getDisplayWidth(node),
        // 지터 가드 — EPSILON 미만 성장은 기준높이로 취급
        dispH: dispH - baseH >= EPSILON ? dispH : baseH,
      };
    })
    .sort((a, b) => a.top - b.top);

  // 행 묶기 — [top, baseBottom) strict 겹침 체인. 맞닿은 경계(top == bottom)는 다음 행(밀림 대상).
  const rows: FieldItem[][] = [];
  let row: FieldItem[] | null = null;
  let rowBottom = -Infinity;
  for (const item of items) {
    if (row && item.top < rowBottom) {
      row.push(item);
      rowBottom = Math.max(rowBottom, item.baseBottom);
    } else {
      if (row) rows.push(row);
      row = [item];
      rowBottom = item.baseBottom;
    }
  }
  if (row) rows.push(row);

  const offsets = new Map<string, number>();
  const pushers: HeightPusher[] = [];
  for (const members of rows) {
    let rowOffset = 0;
    for (const member of members) {
      for (const pusher of pushers) {
        if (pusher.x1 < member.x0 || pusher.x0 > member.x1) continue;
        const savedGap = member.top - pusher.baseBottom; // 행 구조상 ≥ 0(윗행 bottom ≤ 이 행 top)
        const needed = pusher.dispBottom + Math.min(savedGap, HEIGHT_MIN_GAP) - member.top;
        if (needed > rowOffset) rowOffset = needed;
      }
    }
    for (const member of members) {
      if (rowOffset > 0) offsets.set(member.id, rowOffset);
      const dispBottom = member.top + rowOffset + member.dispH;
      if (dispBottom > member.baseBottom) {
        pushers.push({
          id: member.id,
          x0: member.x0,
          x1: member.x1,
          baseBottom: member.baseBottom,
          dispBottom,
        });
      }
    }
  }
  return { offsets, pushers };
}

/**
 * 표시 y → 저장 y (열 [x0, x1] 기준 프로브). 고정 열에서 display(saved) = saved + offset(saved)는
 * 단조 비감소라 이분 탐색으로 최소 저장 y를 찾는다 — 도달 불가 갭(푸셔 baseBottom에서 표시가
 * 점프)은 경계로 클램프되고, 플래토(여러 저장 y → 같은 표시 y)는 최소 저장 y라 forward와 왕복 일치.
 * excludeId: 드래그 중인 노드 자신의 푸셔 제외 — 자기 밴드 그림자에 드롭 시 클램프 점프 방지.
 */
export function invertDisplayY(
  field: HeightShiftField,
  x0: number,
  x1: number,
  displayY: number,
  excludeId?: string,
): number {
  const active = field.pushers.filter(
    (pusher) => pusher.id !== excludeId && !(pusher.x1 < x0 || pusher.x0 > x1),
  );
  if (active.length === 0) return displayY;
  const displayAt = (savedY: number): number => {
    let out = savedY;
    for (const pusher of active) {
      if (savedY < pusher.baseBottom) continue; // 저장 공간에서 위/겹침 — 영향 없음
      const value = pusher.dispBottom + Math.min(savedY - pusher.baseBottom, HEIGHT_MIN_GAP);
      if (value > out) out = value;
    }
    return out;
  };
  let span = 0;
  for (const pusher of active) {
    span = Math.max(span, pusher.dispBottom + HEIGHT_MIN_GAP - pusher.baseBottom);
  }
  let lo = displayY - span - 1; // displayAt(lo) ≤ lo + span < displayY — 하한 보장
  let hi = displayY; // displayAt ≥ 항등이라 displayAt(hi) ≥ displayY — 상한 보장
  for (let i = 0; i < 60 && hi - lo > 1e-6; i += 1) {
    const mid = (lo + hi) / 2;
    if (displayAt(mid) >= displayY) hi = mid;
    else lo = mid;
  }
  return hi;
}
