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
  obstacles: ObstacleRect[];
}

// 노드 여백 + 선 간격 — 회랑이 노드 테두리에 붙지 않게 (px)
const MARGIN = 12;
// 모서리 라운드 반경 — RF smoothstep 기본 5와 통일 (px)
const CORNER_RADIUS = 5;

interface Inflated {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function inflate(rect: ObstacleRect): Inflated {
  return {
    left: rect.x - MARGIN,
    right: rect.x + rect.w + MARGIN,
    top: rect.y - MARGIN,
    bottom: rect.y + rect.h + MARGIN,
  };
}

// 축 정렬 선분 [a1,a2]×[b] 가 rect를 지나는지 — H/V 공용 구간 검사
function crossesH(y: number, x1: number, x2: number, r: Inflated): boolean {
  const [lo, hi] = x1 <= x2 ? [x1, x2] : [x2, x1];
  return y > r.top && y < r.bottom && hi > r.left && lo < r.right;
}

function crossesV(x: number, y1: number, y2: number, r: Inflated): boolean {
  const [lo, hi] = y1 <= y2 ? [y1, y2] : [y2, y1];
  return x > r.left && x < r.right && hi > r.top && lo < r.bottom;
}

/** 수평쌍(H·V·H) 경로가 mid 회랑에서 장애물과 교차하는가. */
function isBlockedH(mid: number, a: DetourArgs, rects: Inflated[]): boolean {
  return rects.some(
    (r) =>
      crossesH(a.sourceY, a.sourceX, mid, r) ||
      crossesV(mid, a.sourceY, a.targetY, r) ||
      crossesH(a.targetY, mid, a.targetX, r),
  );
}

/** 수직쌍(V·H·V) 경로가 mid 회랑에서 장애물과 교차하는가. */
function isBlockedV(mid: number, a: DetourArgs, rects: Inflated[]): boolean {
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

  const rects = a.obstacles.map(inflate);
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
  let best: number | null = null;
  for (const cand of candidates) {
    if (isBlocked(cand)) continue;
    if (
      best === null ||
      Math.abs(cand - mid0) < Math.abs(best - mid0) ||
      (Math.abs(cand - mid0) === Math.abs(best - mid0) && cand > best)
    ) {
      best = cand;
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

/**
 * 직각 웨이포인트 → 모서리 라운드 SVG 경로 + 라벨 앵커(최장 구간 중앙).
 * 반경은 인접 구간 절반으로 클램프 — 짧은 구간에서 경로가 뒤집히지 않게.
 */
export function buildRoundedOrthPath(
  points: { x: number; y: number }[],
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
  for (let i = 1; i < points.length; i += 1) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (len > bestLen) {
      bestLen = len;
      labelX = (points[i].x + points[i - 1].x) / 2;
      labelY = (points[i].y + points[i - 1].y) / 2;
    }
  }
  return [parts.join(" "), labelX, labelY];
}
