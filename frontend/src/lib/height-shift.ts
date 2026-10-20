// 표시 높이(실측)로 커진 노드가 "실제 충돌하는" 아래 노드만 미는 표시 Y 오프셋 — 저장 좌표 불변.
// 성장분은 기존 저장 여백을 먼저 흡수하고, 밀 때 표시 간격은 min(저장 간격, MIN_GAP)을 유지한다.
// 같은 행(저장 Y구간 strict 겹침 체인)은 밀림량을 행 max로 동기화해 가로 정렬을 보존한다.
// 노드 밖 조건 캡션(위=시작·아래=종료)도 표시 높이로 취급해 위아래 노드와 간격을 벌린다.
// PNG 출력 중엔 정렬 유지 이동(lib/print-anchor)을 받아, 행은 저장 좌표로 묶고 충돌만 옮긴 좌표로 판정한다.
import {
  estimateNodeHeight,
  estimateNodeWidth,
  nodeSizeOf,
  type AppNode,
} from "@/lib/canvas";
import { NO_CAPTION_EXTENTS, type CaptionExtents } from "@/lib/condition-captions";
import type { PrintShift } from "@/lib/print-anchor";

// 4px 미만 성장은 무시 — 폰트 렌더 편차로 인한 미세 지터 방지
const EPSILON = 4;
// 밀 때 유지하는 표시 여백 상한(px) — 원래 저장 간격이 더 좁으면 그 좁은 간격을 그대로 유지
export const HEIGHT_MIN_GAP = 16;
const NO_SHIFTS: ReadonlyMap<string, PrintShift> = new Map();

/** 역변환 프로브가 참조하는 푸셔 — 기준높이 아래(base)보다 표시 bottom이 내려온 노드. */
export interface HeightPusher {
  id: string; // 원본 노드 id — 드래그 역변환에서 자기 자신 제외용
  x0: number; // 저장 X 구간(표시 X와 동일 — 인라인 펼침 중엔 height-shift가 게이트 오프, 출력 중엔 정렬 유지 이동 포함)
  x1: number;
  baseBottom: number; // 저장 y + 기준높이 — savedGap 판정 기준
  dispBottom: number; // 저장 y(+ 출력 정렬 유지 이동) + 행 오프셋 + 표시높이
}

export interface HeightShiftField {
  offsets: ReadonlyMap<string, number>;
  pushers: readonly HeightPusher[];
  // 노드 위 캡션 높이 — 역변환이 끌고 있는 노드 자신의 위 캡션을 순변환과 같게 반영
  captionAbove: ReadonlyMap<string, number>;
}

export const EMPTY_HEIGHT_FIELD: HeightShiftField = {
  offsets: new Map(),
  pushers: [],
  captionAbove: new Map(),
};

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
  top: number; // 저장 y — 행 묶기·저장 간격 기준
  layoutTop: number; // 저장 y + 출력 정렬 유지 이동 — 충돌 판정·표시 bottom 기준(평소엔 top과 같다)
  baseBottom: number;
  x0: number;
  x1: number;
  dispH: number;
  capAbove: number;
  capBelow: number;
}

/**
 * 충돌 기반 오프셋 필드 — 행(저장 Y 오름차순)을 위에서부터 처리하며, 각 행의 필요 밀림량
 * (X 구간이 겹치는 위쪽 푸셔의 dispBottom + min(savedGap, MIN_GAP) − top)의 max를 행 전체에
 * 부여한다. 밀리거나 커진 노드는 다시 푸셔가 되어 아래 행으로 연쇄한다.
 * getCaptionExtents: 노드 밖 위·아래 캡션 높이 — 위 캡션은 그 노드의 top을, 아래 캡션은 dispBottom을 넓힌다.
 * shifts: PNG 출력의 정렬 유지 이동(저장 좌표 기준 nodes에 얹을 양). 옮긴 좌표로 행을 묶으면 위로 올린 노드가
 * 윗행에 합쳐져 겹친 채 밀리지 않는다 — 행은 저장 좌표로 묶고, 오프셋은 옮긴 좌표 위에 더할 양으로 돌려준다.
 */
export function buildHeightShiftField(
  nodes: AppNode[],
  getCaptionExtents: (node: AppNode) => CaptionExtents = () => NO_CAPTION_EXTENTS,
  shifts: ReadonlyMap<string, PrintShift> = NO_SHIFTS,
): HeightShiftField {
  const captionAbove = new Map<string, number>();
  const items: FieldItem[] = nodes
    .map((node) => {
      const baseH = nodeSizeOf(node.data.nodeType).h;
      const dispH = getDisplayHeight(node);
      const { above, below } = getCaptionExtents(node);
      if (above > 0) captionAbove.set(node.id, above);
      const shift = shifts.get(node.id);
      const x0 = node.position.x + (shift?.dx ?? 0);
      return {
        id: node.id,
        top: node.position.y,
        layoutTop: node.position.y + (shift?.dy ?? 0),
        baseBottom: node.position.y + baseH,
        x0,
        x1: x0 + getDisplayWidth(node),
        // 지터 가드 — EPSILON 미만 성장은 기준높이로 취급
        dispH: dispH - baseH >= EPSILON ? dispH : baseH,
        capAbove: above,
        capBelow: below,
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
        const needed =
          pusher.dispBottom + Math.min(savedGap, HEIGHT_MIN_GAP) + member.capAbove - member.layoutTop;
        if (needed > rowOffset) rowOffset = needed;
      }
    }
    for (const member of members) {
      if (rowOffset > 0) offsets.set(member.id, rowOffset);
      const dispBottom = member.layoutTop + rowOffset + member.dispH + member.capBelow;
      // 위 캡션이 하나라도 있으면 커지지 않은 노드도 푸셔 — 아래 노드의 위 캡션이 이 노드와 겹치는지 판정해야 한다.
      // 정렬 유지 이동이 있으면 마찬가지 — 위로 올린 아래 노드가 이 노드와 겹치는지 판정해야 한다
      if (dispBottom > member.baseBottom || captionAbove.size > 0 || shifts.size > 0) {
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
  return { offsets, pushers, captionAbove };
}

/**
 * 표시 y → 저장 y (열 [x0, x1] 기준 프로브). 고정 열에서 display(saved) = saved + offset(saved)는
 * 단조 비감소라 이분 탐색으로 최소 저장 y를 찾는다 — 도달 불가 갭(푸셔 baseBottom에서 표시가
 * 점프)은 경계로 클램프되고, 플래토(여러 저장 y → 같은 표시 y)는 최소 저장 y라 forward와 왕복 일치.
 * excludeId: 드래그 중인 노드 자신의 푸셔 제외 — 자기 밴드 그림자에 드롭 시 클램프 점프 방지.
 * 그 노드의 위 캡션 높이도 순변환과 같게 더한다(없으면 0).
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
  const capAbove = excludeId !== undefined ? (field.captionAbove.get(excludeId) ?? 0) : 0;
  const displayAt = (savedY: number): number => {
    let out = savedY;
    for (const pusher of active) {
      if (savedY < pusher.baseBottom) continue; // 저장 공간에서 위/겹침 — 영향 없음
      const value =
        pusher.dispBottom + Math.min(savedY - pusher.baseBottom, HEIGHT_MIN_GAP) + capAbove;
      if (value > out) out = value;
    }
    return out;
  };
  let span = 0;
  for (const pusher of active) {
    span = Math.max(span, pusher.dispBottom + HEIGHT_MIN_GAP + capAbove - pusher.baseBottom);
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
