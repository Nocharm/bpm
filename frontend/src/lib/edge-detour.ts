// 꺾은선(smoothstep) 엣지 장애물 회피 — 기본 3구간(H·V·H / V·H·V) 경로가 다른 노드의 표시
// bbox를 관통하면 중간 회랑을 빈 통로로 옮긴 직각 웨이포인트를 산출한다(사용자 요청 2026-08-24).
// 표시 좌표 기준(핸들 좌표·노드 rect 모두 렌더 공간) — height-shift 트윈 중에도 프레임마다 따라간다.
// 직선·곡선 모양과 대각(혼합) 핸들 방향은 대상 아님 — null 반환 = 기존 기본 경로 사용.
import { Position } from "@xyflow/react";

export interface ObstacleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DetourArgs {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  obstacles: readonly EdgeObstacle[];
  // 엣지 양끝 노드 id — 장애물 스캔에서 스킵(엣지마다 배열을 재구성하지 않기 위한 in-loop 제외)
  skipA?: string;
  skipB?: string;
}

// 노드 여백 + 선 간격 — 회랑이 노드 테두리에 붙지 않게 (px)
const MARGIN = 12;
// 모서리 라운드 반경 — RF smoothstep 기본 5와 통일 (px)
const CORNER_RADIUS = 5;

// 사전 인플레이트 장애물 — 프레임마다 엣지×노드 규모의 inflate 재할당을 없애기 위해
// 호출자가 노드 배열당 1회 산출해 모든 엣지가 공유한다. left/right/top/bottom = MARGIN 경계.
export interface EdgeObstacle extends ObstacleRect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function toEdgeObstacle(id: string, rect: ObstacleRect): EdgeObstacle {
  return {
    id,
    ...rect,
    left: rect.x - MARGIN,
    right: rect.x + rect.w + MARGIN,
    top: rect.y - MARGIN,
    bottom: rect.y + rect.h + MARGIN,
  };
}

// 축 정렬 선분 [a1,a2]×[b] 가 rect를 지나는지 — H/V 공용 구간 검사
function crossesH(y: number, x1: number, x2: number, r: EdgeObstacle): boolean {
  const [lo, hi] = x1 <= x2 ? [x1, x2] : [x2, x1];
  return y > r.top && y < r.bottom && hi > r.left && lo < r.right;
}

function crossesV(x: number, y1: number, y2: number, r: EdgeObstacle): boolean {
  const [lo, hi] = y1 <= y2 ? [y1, y2] : [y2, y1];
  return x > r.left && x < r.right && hi > r.top && lo < r.bottom;
}

/** 수평쌍(H·V·H) 경로가 mid 회랑에서 장애물과 교차하는가. */
function isBlockedH(mid: number, a: DetourArgs, rects: readonly EdgeObstacle[]): boolean {
  return rects.some(
    (r) =>
      crossesH(a.sourceY, a.sourceX, mid, r) ||
      crossesV(mid, a.sourceY, a.targetY, r) ||
      crossesH(a.targetY, mid, a.targetX, r),
  );
}

/** 수직쌍(V·H·V) 경로가 mid 회랑에서 장애물과 교차하는가. */
function isBlockedV(mid: number, a: DetourArgs, rects: readonly EdgeObstacle[]): boolean {
  return rects.some(
    (r) =>
      crossesV(a.sourceX, a.sourceY, mid, r) ||
      crossesH(mid, a.sourceX, a.targetX, r) ||
      crossesV(a.targetX, mid, a.targetY, r),
  );
}

/**
 * 우회 웨이포인트 산출. null = 기본 경로 그대로(교차 없음·대상 외 방향·빈 회랑 없음).
 * 후보 회랑 = 기본 중앙 + 각 장애물의 양쪽 바깥 — 전 구간 무교차인 것 중 기본에서 최소 이탈을 고른다
 * (동률이면 오른쪽/아래 우선 — 트윈 중 프레임 간 좌우 플립 방지용 결정적 타이브레이크).
 */
export function buildDetourPoints(a: DetourArgs): { x: number; y: number }[] | null {
  const horizontal =
    (a.sourcePosition === Position.Right || a.sourcePosition === Position.Left) &&
    (a.targetPosition === Position.Right || a.targetPosition === Position.Left);
  const vertical =
    (a.sourcePosition === Position.Top || a.sourcePosition === Position.Bottom) &&
    (a.targetPosition === Position.Top || a.targetPosition === Position.Bottom);
  if (!horizontal && !vertical) return null;

  // 관련 장애물 프루닝 — 세 구간(H·V·H / V·H·V) 모두 소스↔타깃이 스팬하는 직교 밴드와
  // 겹치는 rect하고만 교차 가능하므로, 밴드 밖 장애물은 판정·후보에서 제외한다(교차 판정은 동치,
  // 후보 회랑은 밴드 장애물 경계로 한정 — 어차피 그 경계들이 밴드 안 빈 통로를 모두 커버한다).
  const bandLo = horizontal ? Math.min(a.sourceY, a.targetY) : Math.min(a.sourceX, a.targetX);
  const bandHi = horizontal ? Math.max(a.sourceY, a.targetY) : Math.max(a.sourceX, a.targetX);
  const rects: EdgeObstacle[] = [];
  for (const r of a.obstacles) {
    if (r.id === a.skipA || r.id === a.skipB) continue;
    if (horizontal ? r.bottom > bandLo && r.top < bandHi : r.right > bandLo && r.left < bandHi) {
      rects.push(r);
    }
  }
  const isBlocked = horizontal
    ? (mid: number) => isBlockedH(mid, a, rects)
    : (mid: number) => isBlockedV(mid, a, rects);
  const mid0 = horizontal ? (a.sourceX + a.targetX) / 2 : (a.sourceY + a.targetY) / 2;
  if (!isBlocked(mid0)) return null;

  const candidates: number[] = [];
  for (const r of rects) {
    if (horizontal) {
      candidates.push(r.left - 1, r.right + 1);
    } else {
      candidates.push(r.top - 1, r.bottom + 1);
    }
  }
  // 기본 이탈 최소 우선(동률은 오른쪽/아래) 정렬 후 첫 무교차 후보에서 종료 — 전 후보×전 rect
  // 전수 판정(드래그 프레임 예산 킬러)을 최근접 몇 개 판정으로 줄인다. 선택 결과는 전수와 동일.
  candidates.sort((p, q) => Math.abs(p - mid0) - Math.abs(q - mid0) || q - p);
  let best: number | null = null;
  for (const cand of candidates) {
    if (!isBlocked(cand)) {
      best = cand;
      break;
    }
  }
  if (best === null) return null; // 빈 회랑 없음 — 기본 경로 유지(현행 동작)

  const points = horizontal
    ? [
        { x: a.sourceX, y: a.sourceY },
        { x: best, y: a.sourceY },
        { x: best, y: a.targetY },
        { x: a.targetX, y: a.targetY },
      ]
    : [
        { x: a.sourceX, y: a.sourceY },
        { x: a.sourceX, y: best },
        { x: a.targetX, y: best },
        { x: a.targetX, y: a.targetY },
      ];
  // 퇴화 구간(길이 0) 제거 — 같은 점 연속이면 라운드 계산이 0으로 나눔
  return points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
  );
}

// 라벨 가림 판정 반경 — 엣지 라벨 max-width 160의 절반 + 세로 여유. 회랑이 장애물에 붙어
// 지나면(여백 13px) 그 구간 중앙 라벨이 노드 뒤로 숨는다(V라운드 관찰 2) → 가리는 구간은 건너뜀
const LABEL_HALF_W = 80;
const LABEL_HALF_H = 12;

function isLabelClear(x: number, y: number, obstacles: ObstacleRect[]): boolean {
  return !obstacles.some(
    (r) =>
      x > r.x - LABEL_HALF_W &&
      x < r.x + r.w + LABEL_HALF_W &&
      y > r.y - LABEL_HALF_H &&
      y < r.y + r.h + LABEL_HALF_H,
  );
}

/**
 * 직각 웨이포인트 → 모서리 라운드 SVG 경로 + 라벨 앵커.
 * 라벨은 "중앙이 장애물에 가려지지 않는" 구간 중 최장 구간의 중앙 — 전부 가려지면 최장 구간 폴백.
 * 반경은 인접 구간 절반으로 클램프 — 짧은 구간에서 경로가 뒤집히지 않게.
 */
export function buildRoundedOrthPath(
  points: { x: number; y: number }[],
  obstacles: ObstacleRect[] = [],
): [string, number, number] {
  const parts = [`M ${points[0].x},${points[0].y}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(CORNER_RADIUS, inLen / 2, outLen / 2);
    const inX = cur.x - ((cur.x - prev.x) / inLen) * r;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * r;
    const outX = cur.x + ((next.x - cur.x) / outLen) * r;
    const outY = cur.y + ((next.y - cur.y) / outLen) * r;
    parts.push(`L ${inX},${inY}`, `Q ${cur.x},${cur.y} ${outX},${outY}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last.x},${last.y}`);

  let bestLen = -1;
  let labelX = points[0].x;
  let labelY = points[0].y;
  let bestClearLen = -1;
  let clearX = 0;
  let clearY = 0;
  for (let i = 1; i < points.length; i += 1) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const midX = (points[i].x + points[i - 1].x) / 2;
    const midY = (points[i].y + points[i - 1].y) / 2;
    if (len > bestLen) {
      bestLen = len;
      labelX = midX;
      labelY = midY;
    }
    if (len > bestClearLen && isLabelClear(midX, midY, obstacles)) {
      bestClearLen = len;
      clearX = midX;
      clearY = midY;
    }
  }
  return bestClearLen > 0 ? [parts.join(" "), clearX, clearY] : [parts.join(" "), labelX, labelY];
}
