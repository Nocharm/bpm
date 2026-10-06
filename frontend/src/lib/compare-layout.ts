// 비교 화면 배치 보조(순수 함수) — 삭제 노드 곁가지 배치·삭제 직접연결 아크 깊이·SP 출구 라벨 미러. compare/page.tsx 전용.
// 좌표는 전부 flow 좌표(좌상단 기준). LR은 흐름축=x·교차축=y, TB는 흐름축=y·교차축=x.

import { PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

export type CompareFlowDir = "LR" | "TB";

/** 배치된 노드 점유 사각형 — h는 노드 아래로 매달린 diff 필 여유까지 포함한 높이로 호출부가 준다. */
export interface CompareRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompareBox {
  id: string;
  w: number;
  h: number;
}

export interface CompareLink {
  source: string;
  target: string;
}

// 유지 이웃 아래(LR)/오른쪽(TB)으로 띄우는 거리(px) — 이웃 사이 연결선과 라벨이 지나갈 여유.
export const REMOVED_CROSS_GAP = 56;
// 삭제 노드끼리 이어질 때 흐름축 간격(px) — 비교 dagre ranksep(120)보다 촘촘하게.
export const REMOVED_RANK_GAP = 80;
// 겹침 판정 여유(px) — 이보다 가까우면 겹친 것으로 보고 교차축으로 밀어낸다.
export const REMOVED_MIN_GAP = 24;
// 삭제 아크가 장애물 아래로 지나갈 때 남기는 여유(px).
export const ARC_CLEARANCE = 20;
// 아크 최소 깊이(px) — 장애물이 없을 때 종전 고정 깊이와 같다.
export const ARC_MIN_REACH = 52;

// diff 필(process-node DiffFieldPills) 한 줄 높이(px, 11px 글자+패딩+테두리+간격)와 노드와의 간격(mt-1.5)
const DIFF_PILL_ROW = 23;
const DIFF_PILL_TOP = 6;
const DIFF_PILL_MAX_ROWS = 3;

/** 변경 노드 아래 diff 필이 차지하는 높이 — 필은 절대배치라 실측 크기에 없다(최대 3줄 + "+N more" 1줄). */
export function getDiffPillAllowance(fieldCount: number): number {
  if (fieldCount <= 0) return 0;
  const rows = Math.min(fieldCount, DIFF_PILL_MAX_ROWS) + (fieldCount > DIFF_PILL_MAX_ROWS ? 1 : 0);
  return DIFF_PILL_TOP + rows * DIFF_PILL_ROW;
}

interface Axis {
  flowStart: (r: CompareRect) => number;
  flowSize: (r: Pick<CompareRect, "w" | "h">) => number;
  crossStart: (r: CompareRect) => number;
  crossSize: (r: Pick<CompareRect, "w" | "h">) => number;
  toRect: (box: CompareBox, flow: number, cross: number) => CompareRect;
}

function getAxis(flowDir: CompareFlowDir): Axis {
  const isLR = flowDir === "LR";
  return {
    flowStart: (r) => (isLR ? r.x : r.y),
    flowSize: (r) => (isLR ? r.w : r.h),
    crossStart: (r) => (isLR ? r.y : r.x),
    crossSize: (r) => (isLR ? r.h : r.w),
    toRect: (box, flow, cross) =>
      isLR ? { ...box, x: flow, y: cross } : { ...box, x: cross, y: flow },
  };
}

function isOverlapping(a: CompareRect, b: CompareRect, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * 삭제 노드 배치 — 배치된 이웃(유지·추가 노드, 먼저 놓인 삭제 노드)을 기준으로 BFS 차례대로 놓는다.
 *  · 유지 이웃: 이웃 중심의 흐름축 평균, 교차축은 이웃 아래(LR)/오른쪽(TB) — 본류 라인을 비운다.
 *  · 삭제 이웃: 연결 방향대로 흐름축 한 칸 앞/뒤(삭제 사슬이 원점에 포개지지 않게).
 *  · 배치된 이웃이 없는 노드(빈 버전과 비교 등): 전체 bbox 아래(LR)/오른쪽(TB) 한 줄에 차례로.
 * 놓을 자리가 기존 사각형(실측 크기+필 여유)과 겹치면 교차축 방향 다음 빈 자리로 민다.
 * links는 삭제 엣지 — 삭제 노드에 닿지 않는 링크·자기 루프는 무시. 반환은 삭제 노드 id → 좌상단.
 */
export function placeRemovedNodes(
  placed: readonly CompareRect[],
  removed: readonly CompareBox[],
  links: readonly CompareLink[],
  flowDir: CompareFlowDir,
): Map<string, { x: number; y: number }> {
  const axis = getAxis(flowDir);
  const rects = new Map<string, CompareRect>(placed.map((rect) => [rect.id, rect]));
  const keptIds = new Set(placed.map((rect) => rect.id));
  const removedIds = new Set(removed.map((box) => box.id));
  const neighborsOf = new Map<string, { id: string; isSelfSource: boolean }[]>();
  for (const link of links) {
    if (link.source === link.target) continue;
    if (removedIds.has(link.source)) {
      const list = neighborsOf.get(link.source) ?? [];
      list.push({ id: link.target, isSelfSource: true });
      neighborsOf.set(link.source, list);
    }
    if (removedIds.has(link.target)) {
      const list = neighborsOf.get(link.target) ?? [];
      list.push({ id: link.source, isSelfSource: false });
      neighborsOf.set(link.target, list);
    }
  }
  const result = new Map<string, { x: number; y: number }>();
  let orphanRow: { cross: number; cursor: number } | null = null;

  const commit = (box: CompareBox, flow: number, cross: number) => {
    let crossPos = cross;
    for (;;) {
      const candidate = axis.toRect(box, flow, crossPos);
      let blockEnd = Number.NEGATIVE_INFINITY;
      for (const other of rects.values()) {
        if (isOverlapping(candidate, other, REMOVED_MIN_GAP)) {
          blockEnd = Math.max(blockEnd, axis.crossStart(other) + axis.crossSize(other));
        }
      }
      if (blockEnd === Number.NEGATIVE_INFINITY) break;
      crossPos = blockEnd + REMOVED_MIN_GAP;
    }
    const rect = axis.toRect(box, flow, crossPos);
    rects.set(box.id, rect);
    result.set(box.id, { x: rect.x, y: rect.y });
    // 고아 줄(또는 그 아래)에 놓인 노드는 다음 고아의 시작 위치를 그 뒤로 민다
    if (orphanRow && crossPos >= orphanRow.cross) {
      orphanRow.cursor = Math.max(orphanRow.cursor, flow + axis.flowSize(box) + REMOVED_RANK_GAP);
    }
  };

  const getAnchor = (box: CompareBox): { flow: number; cross: number } => {
    const flowCandidates: number[] = [];
    const keptCross: number[] = [];
    const removedCross: number[] = [];
    for (const neighbor of neighborsOf.get(box.id) ?? []) {
      const rect = rects.get(neighbor.id);
      if (!rect) continue;
      const center = axis.flowStart(rect) + axis.flowSize(rect) / 2;
      if (keptIds.has(neighbor.id)) {
        flowCandidates.push(center);
        keptCross.push(axis.crossStart(rect) + axis.crossSize(rect) + REMOVED_CROSS_GAP);
      } else {
        // 나→이웃이면 이웃 앞(흐름 이전), 이웃→나면 이웃 뒤
        const step = axis.flowSize(rect) / 2 + REMOVED_RANK_GAP + axis.flowSize(box) / 2;
        flowCandidates.push(neighbor.isSelfSource ? center - step : center + step);
        removedCross.push(axis.crossStart(rect) + axis.crossSize(rect) / 2 - axis.crossSize(box) / 2);
      }
    }
    return {
      flow: average(flowCandidates) - axis.flowSize(box) / 2,
      cross: keptCross.length > 0 ? Math.max(...keptCross) : average(removedCross),
    };
  };

  const startOrphanRow = () => {
    if (rects.size === 0) return { cross: 0, cursor: 0 };
    const all = [...rects.values()];
    return {
      cross: Math.max(...all.map((r) => axis.crossStart(r) + axis.crossSize(r))) + REMOVED_CROSS_GAP,
      cursor: Math.min(...all.map((r) => axis.flowStart(r))),
    };
  };

  let pending = [...removed];
  while (pending.length > 0) {
    const ready = pending.filter((box) => (neighborsOf.get(box.id) ?? []).some((n) => rects.has(n.id)));
    if (ready.length === 0) {
      const [first, ...rest] = pending;
      orphanRow ??= startOrphanRow();
      commit(first, orphanRow.cursor, orphanRow.cross);
      pending = rest;
      continue;
    }
    // 같은 차례 노드는 이전 차례까지 놓인 이웃만 기준(BFS 층) — 겹침 판정은 방금 놓은 것도 본다
    const anchors = ready.map((box) => ({ box, anchor: getAnchor(box) }));
    for (const { box, anchor } of anchors) commit(box, anchor.flow, anchor.cross);
    const readyIds = new Set(ready.map((box) => box.id));
    pending = pending.filter((box) => !readyIds.has(box.id));
  }
  return result;
}

/**
 * 삭제 직접연결 아크가 지나갈 교차축 수위 — 양끝 노드(필 포함) 아래와, 흐름축 구간 안에 걸친 모든 노드 아래를
 * ARC_CLEARANCE만큼 비켜 간다. 반환값은 LR이면 y, TB면 x(절대 flow 좌표).
 */
export function getRemovedArcLevel(
  source: CompareRect,
  target: CompareRect,
  obstacles: readonly CompareRect[],
  flowDir: CompareFlowDir,
): number {
  const axis = getAxis(flowDir);
  const centerOf = (r: CompareRect) => axis.flowStart(r) + axis.flowSize(r) / 2;
  const crossEndOf = (r: CompareRect) => axis.crossStart(r) + axis.crossSize(r);
  const spanStart = Math.min(centerOf(source), centerOf(target));
  const spanEnd = Math.max(centerOf(source), centerOf(target));
  let level = Math.max(crossEndOf(source), crossEndOf(target));
  for (const rect of obstacles) {
    if (rect.id === source.id || rect.id === target.id) continue;
    const start = axis.flowStart(rect);
    if (start < spanEnd && start + axis.flowSize(rect) > spanStart) level = Math.max(level, crossEndOf(rect));
  }
  return level + ARC_CLEARANCE;
}

/**
 * 아크 베지어 제어점 깊이 — 두 제어점을 같은 깊이 d에 둔 3차 베지어의 중앙(t=0.5)은 (a+b)/8 + 0.75d라,
 * 그 지점이 level에 닿도록 d를 역산한다. 장애물이 없어도 종전 최소 깊이(끝점+ARC_MIN_REACH)는 지킨다.
 * a·b는 두 끝점의 교차축 좌표(LR=y, TB=x).
 */
export function getArcControlDepth(a: number, b: number, level: number): number {
  return Math.max((level - (a + b) / 8) / 0.75, Math.max(a, b) + ARC_MIN_REACH);
}

/**
 * 비교 엣지 표시 라벨 — 직접 라벨이 없고 SP 보조 끝(대표 끝 아님)에서 나가면 끝 키(=끝 제목)를 미러한다.
 * 에디터 applyMirroredEndLabels와 같은 규약(렌더 전용, mirrored면 점선 알약). 대표 끝 제목은 비교에 링크 맵
 * 그래프가 없어 알 수 없으므로 미러하지 않는다.
 */
export function getCompareEdgeLabel(label: string, exit: string): { label: string | undefined; isMirrored: boolean } {
  if (label) return { label, isMirrored: false };
  if (exit && exit !== PRIMARY_END_HANDLE) return { label: exit, isMirrored: true };
  return { label: undefined, isMirrored: false };
}
