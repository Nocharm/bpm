// 같은 핸들(앵커)로 모이는 엣지의 팬아웃 — 렌더 전용 레인 배정(순수)과 팬 경로 기하.
// 저장 데이터·핸들 변은 건드리지 않는다. 설계: 2026-09-30-edge-fanout-design.md(폐기, git history)
import { Position, type Edge } from "@xyflow/react";

import {
  type AppNode,
  type HandleSide,
  nodeSizeOf,
  type ProcessNodeType,
  sideFromHandleId,
} from "@/lib/canvas";
import { buildRoundedOrthPath, type ObstacleRect } from "@/lib/edge-detour";
import { getBezierEndOffset, VERTICAL_EDGE_STUB } from "@/lib/edge-stub";

/** 첫 아크 반경(px) — 20px 스텁보다 짧아 촘촘한 배치에서도 성립 */
export const FAN_R0 = 14;
/** 레인 간격(px) — 화살촉 7.5px보다 크고 1.5px 선이 또렷이 갈라지는 최소 */
export const FAN_GAP = 10;
/** 대향 분류 문턱 — 상대 앵커가 이 거리보다 정면에 있어야 "앞쪽" 가족 (RF 스텁 20 + R0). 동측 가족의 반경 기저이기도 하다 */
export const FAN_STUB = 20;
/** 아크 반경 상한(px) — 5레인 초과는 노드 크기를 넘어 어색 */
export const FAN_R_MAX = 64;
/** 아크 반경 하한(px) — 측면 거리가 이보다 작으면 아크가 무의미해 현행 경로 */
export const FAN_R_MIN = 6;
/** 압축 시 허용하는 최소 레인 간격(px) — 가까운 형제의 여유가 모자라면 공칭 10 대신 이만큼씩 안으로 좁힌다 */
export const FAN_GAP_MIN = 6;
/** 레인이 성립하려면 측면 거리에서 남아야 하는 여유(px) — 레인 직선 구간 최소 길이. 0이면 0길이 구간 → NaN 경로 */
const LANE_CLEAR = FAN_R_MIN;
/** 라이브 끝점은 핸들 박스 바깥변(11px 핸들 → 양끝 5.5px씩)이라 추정 앵커보다 가깝다 — 수평 여유 캡에 미리 뺀다 */
const HANDLE_OUTSET_TOTAL = 11;
/** 라이브 좌표로 다시 깎은 반경이 배정값보다 이만큼 이상 작으면 순서가 뒤집힐 수 있어 팬을 포기한다(px) */
const LIVE_TOLERANCE = 2;
/** 직선 끝점 분산 간격(px)과 클립(핸들 11px 안) */
export const FAN_SPREAD = 3.5;
export const FAN_SPREAD_CLIP = 4.5;
/** 곡선 팬 끝 제어점 거리 = 반경 × 이 배수(원호 근사) */
const BEZIER_CONTROL_PER_RADIUS = 1.2;
/** 같은 줄 판정(px) — 측면 거리가 이보다 작으면 아크 없이 직선 진입(k=-1) */
const ON_ROW_EPS = 4;
/** 렌더 전용 복제 노드 접두(에디터 Ctrl 드래그 고스트) — 기하는 원본 노드 것을 쓴다 */
const GHOST_PREFIX = "ctrl-ghost:";
/** 프로세스·하위프로세스 좌/우 핸들의 라벨 라인 앵커(px) — process-node.tsx sideAnchorTop과 동기 */
const SIDE_ANCHOR_TOP = 18;

export interface FanLane {
  /** 레인 순번(0=가장 안쪽 아크). -1 = 같은 줄이라 직선 진입 */
  k: number;
  /** 그룹 전체를 측면 좌표 오름차순으로 센 순번 — 직선 끝점 분산용 */
  idx: number;
  /** 그룹(앵커를 공유하는 엣지 끝) 크기 */
  n: number;
  /** 배정 반경(px). 형제들의 측면 거리·수평 여유에 맞춰 안쪽부터 압축한 값. 0 = 이 끝은 팬 없음(현행 경로) */
  r: number;
}

export interface EdgeFan {
  s?: FanLane;
  t?: FanLane;
}

export interface FanNodeGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  nodeType: ProcessNodeType;
}

interface Vec {
  x: number;
  y: number;
}

/** 변의 바깥 법선(out)과 측면축(lat, 좌/우 변은 +y·상/하 변은 +x) — 단위 벡터 */
function axesOf(side: HandleSide): { out: Vec; lat: Vec } {
  switch (side) {
    case "left":
      return { out: { x: -1, y: 0 }, lat: { x: 0, y: 1 } };
    case "right":
      return { out: { x: 1, y: 0 }, lat: { x: 0, y: 1 } };
    case "top":
      return { out: { x: 0, y: -1 }, lat: { x: 1, y: 0 } };
    default:
      return { out: { x: 0, y: 1 }, lat: { x: 1, y: 0 } };
  }
}

/** 핸들 앵커 추정 — 실측 handleBounds 없이 노드 bbox와 타입으로 (정렬용, 픽셀 정확도 불필요) */
function anchorOf(g: FanNodeGeom, side: HandleSide): Vec {
  const anchoredTop = g.nodeType === "process" || g.nodeType === "subprocess";
  const ay = anchoredTop ? Math.min(SIDE_ANCHOR_TOP, g.h / 2) : g.h / 2;
  switch (side) {
    case "left":
      return { x: g.x, y: g.y + ay };
    case "right":
      return { x: g.x + g.w, y: g.y + ay };
    case "top":
      return { x: g.x + g.w / 2, y: g.y };
    default:
      return { x: g.x + g.w / 2, y: g.y + g.h };
  }
}

function stripGhost(id: string): string {
  return id.startsWith(GHOST_PREFIX) ? id.slice(GHOST_PREFIX.length) : id;
}

/** 앵커 그룹 키 — 한 변의 핸들은 전부 같은 픽셀(s-/t- 겹침, SP 끝 핸들도 우측 한 점에 겹침, 2026-10-01)이라 변 단위 한 그룹 */
function groupKeyOf(nodeId: string, side: HandleSide): string {
  return `${nodeId}|${side}`;
}

interface EndRef {
  edgeId: string;
  end: "s" | "t";
  /** 상대 앵커의 바깥 법선 거리(+ = 이 변의 정면) */
  u: number;
  /** 상대 앵커의 측면 거리 */
  v: number;
}

/** 대향(정면) 끝의 반경 상한 — 상대 핸들에서 20px 스텁이 남아야 하고, 라이브 끝점은 핸들 돌출만큼 더 가깝다 */
function aheadRadiusCap(u: number): number {
  return (u - FAN_STUB - HANDLE_OUTSET_TOTAL) / 2;
}

function toLocal(anchor: Vec, side: HandleSide, other: Vec): { u: number; v: number } {
  const { out, lat } = axesOf(side);
  const dx = other.x - anchor.x;
  const dy = other.y - anchor.y;
  return { u: dx * out.x + dy * out.y, v: dx * lat.x + dy * lat.y };
}

const compareId = (a: EndRef, b: EndRef) => (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0);

function setLane(out: Map<string, EdgeFan>, ref: EndRef, lane: FanLane): void {
  const fan = out.get(ref.edgeId) ?? {};
  fan[ref.end] = lane;
  out.set(ref.edgeId, fan);
}

/**
 * 한 앵커 그룹의 레인 배정. 측면 부호 × (동측 | 앞쪽 대향)의 네 가족을 따로 센다 —
 * 동측(루프백)은 가까운 상대가 안쪽(무지개, 기저 R0+스텁 — 위·아래 변은 최소 높이 VERTICAL_EDGE_STUB 이상), 대향은 먼 상대가 안쪽. 각각 교차가 생기지 않는
 * 유일한 순서. 같은 측면에 둘 다 있으면 동측이 안쪽이고 대향은 그 바깥에서 시작한다(리뷰 C3).
 * 반경(r)은 공칭 base+10k를 형제의 측면 거리·수평 여유에 맞춰 바깥(가까운 쪽)부터 안으로 압축한다 —
 * 반경만 개별 클램프하면 순서가 뒤집혀 교차한다(리뷰 C2). 여유가 6px 미만이면 그 끝은 팬 없음(r=0). 동률은 엣지 id.
 */
function assignGroup(members: EndRef[], out: Map<string, EdgeFan>, isVerticalSide: boolean): void {
  // 루프백 레인 반경 = 변에서 뜨는 높이 — 위·아래 변은 최소 높이(lib/edge-stub) 아래로 내리지 않는다
  const behindBase = isVerticalSide ? Math.max(FAN_R0 + FAN_STUB, VERTICAL_EDGE_STUB) : FAN_R0 + FAN_STUB;
  const n = members.length;
  const byLateral = [...members].sort((a, b) => a.v - b.v || compareId(a, b));
  const lanes = new Map<EndRef, FanLane>();
  byLateral.forEach((ref, idx) => lanes.set(ref, { k: -1, idx, n, r: 0 }));
  for (const side of [-1, 1]) {
    const family = members.filter((ref) => Math.abs(ref.v) >= ON_ROW_EPS && Math.sign(ref.v) === side);
    const ahead = family
      .filter((ref) => ref.u > FAN_R0 + FAN_STUB)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v) || compareId(a, b));
    const behind = family
      .filter((ref) => ref.u <= FAN_R0 + FAN_STUB)
      .sort((a, b) => Math.abs(a.v) - Math.abs(b.v) || compareId(a, b));
    // 동측: 안쪽(가까운 것)부터 바깥으로 — 각 반경은 안쪽 반경 + 최소 간격 이상이어야 하고 측면 거리 안에 들어야 한다
    let innerR: number | null = null;
    let behindMax = 0;
    behind.forEach((ref, k) => {
      const lane = lanes.get(ref)!;
      lane.k = k;
      const r = Math.min(behindBase + k * FAN_GAP, Math.abs(ref.v) - LANE_CLEAR);
      if (r < FAN_R_MIN || (innerR !== null && r < innerR + FAN_GAP_MIN)) {
        return;
      }
      lane.r = r;
      innerR = r;
      behindMax = r;
    });
    // 대향: 먼 것이 안쪽(k=0). 제약(측면 거리·수평 여유)은 가까운 바깥 레인에서 오므로 바깥부터 안으로 계산한다
    const base = behindMax > 0 ? behindMax + FAN_GAP : FAN_R0;
    let outerLimit = Infinity;
    for (let k = ahead.length - 1; k >= 0; k -= 1) {
      const ref = ahead[k];
      const lane = lanes.get(ref)!;
      lane.k = k;
      const r = Math.min(base + k * FAN_GAP, Math.abs(ref.v) - LANE_CLEAR, aheadRadiusCap(ref.u), outerLimit - FAN_GAP_MIN);
      if (r < FAN_R_MIN || (behindMax > 0 && r < behindMax + FAN_GAP_MIN)) {
        continue;
      }
      lane.r = r;
      outerLimit = r;
    }
  }
  for (const [ref, lane] of lanes) {
    setLane(out, ref, lane);
  }
}

/**
 * 렌더 전용 레인 배정 — 엣지 양끝을 (노드, 변, 핸들) 앵커 그룹으로 모아 형제가 2개 이상인 끝에만 레인을 준다.
 * hidden 엣지·기하 미상 노드는 제외. 호출자(에디터 styledEdges·비교 appEdges)가 결과를 edge.data.fan으로 넘긴다.
 */
export function assignFanLanes(
  edges: readonly Edge[],
  geom: ReadonlyMap<string, FanNodeGeom>,
): Map<string, EdgeFan> {
  const groups = new Map<string, EndRef[]>();
  const push = (key: string, ref: EndRef) => {
    const list = groups.get(key);
    if (list) {
      list.push(ref);
    } else {
      groups.set(key, [ref]);
    }
  };
  for (const edge of edges) {
    if (edge.hidden) {
      continue;
    }
    // 고스트 id로 등록된 기하(원위치 사본)가 있으면 그것을, 없으면 원본 노드 기하를 쓴다
    const sourceGeom = geom.get(edge.source) ?? geom.get(stripGhost(edge.source));
    const targetGeom = geom.get(edge.target) ?? geom.get(stripGhost(edge.target));
    if (!sourceGeom || !targetGeom) {
      continue;
    }
    const sourceSide = sideFromHandleId(edge.sourceHandle, "right");
    const targetSide = sideFromHandleId(edge.targetHandle, "left");
    const sourceAnchor = anchorOf(sourceGeom, sourceSide);
    const targetAnchor = anchorOf(targetGeom, targetSide);
    push(groupKeyOf(edge.source, sourceSide), {
      edgeId: edge.id,
      end: "s",
      ...toLocal(sourceAnchor, sourceSide, targetAnchor),
    });
    push(groupKeyOf(edge.target, targetSide), {
      edgeId: edge.id,
      end: "t",
      ...toLocal(targetAnchor, targetSide, sourceAnchor),
    });
  }
  const out = new Map<string, EdgeFan>();
  for (const [key, members] of groups) {
    if (members.length >= 2) {
      assignGroup(members, out, key.endsWith("|top") || key.endsWith("|bottom"));
    }
  }
  return out;
}

/** 표면의 렌더 노드 배열 → 레인 배정용 기하(표시 좌표 + 실측 크기, 없으면 타입 기본 크기) */
export function buildFanGeom(nodes: readonly AppNode[]): Map<string, FanNodeGeom> {
  const geom = new Map<string, FanNodeGeom>();
  for (const node of nodes) {
    const fallback = nodeSizeOf(node.data.nodeType);
    const h = node.measured?.height ?? fallback.h;
    const entry: FanNodeGeom = {
      x: node.position.x,
      y: node.position.y,
      w: node.measured?.width ?? fallback.w,
      h,
      nodeType: node.data.nodeType,
    };
    geom.set(node.id, entry);
  }
  return geom;
}

/** 표면 최종 엣지 배열에 data.fan을 얹는다 — 팬 없는 엣지는 같은 객체(RF memo 유지). */
export function injectFanLanes(edges: readonly Edge[], geom: ReadonlyMap<string, FanNodeGeom>): Edge[] {
  const lanes = assignFanLanes(edges, geom);
  if (lanes.size === 0) {
    return edges as Edge[];
  }
  return edges.map((edge) => {
    const fan = lanes.get(edge.id);
    return fan ? { ...edge, data: { ...edge.data, fan } } : edge;
  });
}

/** edge.data.fan 판별 — 엣지 컴포넌트가 unknown data에서 안전하게 꺼낸다 */
export function isEdgeFan(value: unknown): value is EdgeFan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { s, t } = value as { s?: unknown; t?: unknown };
  const isLane = (lane: unknown) =>
    lane === undefined ||
    (!!lane && typeof lane === "object" && typeof (lane as FanLane).k === "number");
  return isLane(s) && isLane(t) && (s !== undefined || t !== undefined);
}

// ---------------------------------------------------------------------------
// 경로 기하 — 엣지 컴포넌트가 RF 라이브 끝점 + data.fan으로 그린다
// ---------------------------------------------------------------------------

/** RF EdgeProps의 좌표 6개 */
export interface FanPathArgs {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}

export interface FanStepResult {
  d: string;
  labelX: number;
  labelY: number;
  /** 라운드 전 꼭짓점 폴리라인(코너·게이트·아크 꼭짓점·끝점) — 호출자의 장애물 검사용 */
  points: Vec[];
}

function sideOfPosition(position: Position): HandleSide {
  switch (position) {
    case Position.Left:
      return "left";
    case Position.Right:
      return "right";
    case Position.Top:
      return "top";
    default:
      return "bottom";
  }
}

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const fmt = (n: number) => String(Math.round(n * 100) / 100);
/** SVG arc sweep — 진행 방향이 시계(화면 y-down 기준)로 도는지 */
const sweepOf = (dIn: Vec, dOut: Vec) => (dIn.x * dOut.y - dIn.y * dOut.x > 0 ? 1 : 0);

interface FanEnd {
  /** 끝점(앵커) */
  p: Vec;
  out: Vec;
  lat: Vec;
  /** 상대 끝의 측면 부호(+1/-1) */
  side: number;
  /** 아크 반경 */
  r: number;
  /** 아크 꼭짓점(라운드 전 코너) = p + out·r */
  vertex: Vec;
  /** 게이트 = 아크가 시작/끝나는 레인 위 점 */
  gate: Vec;
}

/**
 * 한 끝의 팬 반경 — 배정값(lane.r)을 라이브 좌표로 검증한다. null = 이 끝은 팬 없음(현행 경로):
 * 배정 없음·측면 거리 안에 레인 구간이 안 남음·라이브 여유가 배정 추정보다 빡빡해 반경을 더 깎아야 하는 경우
 * (그대로 그리면 형제와 순서가 뒤집혀 교차하거나 0길이 구간이 NaN 경로를 만든다).
 */
function resolveFanEnd(p: Vec, position: Position, other: Vec, lane: FanLane | undefined): FanEnd | null {
  if (!lane || lane.r < FAN_R_MIN) {
    return null;
  }
  const { out, lat } = axesOf(sideOfPosition(position));
  const rel = { x: other.x - p.x, y: other.y - p.y };
  const u = dot(rel, out);
  const v = dot(rel, lat);
  const vAbs = Math.abs(v);
  let r = Math.min(lane.r, FAN_R_MAX, vAbs - LANE_CLEAR);
  if (u > FAN_R0 + FAN_STUB) {
    r = Math.min(r, (u - FAN_STUB) / 2);
  }
  if (r < FAN_R_MIN || r < lane.r - LIVE_TOLERANCE) {
    return null;
  }
  const side = Math.sign(v);
  const vertex = add(p, out, r);
  return { p, out, lat, side, r, vertex, gate: add(vertex, lat, side * r) };
}

/**
 * 소형 직각 라우터 — P에서 d1 방향으로 출발해 Q에 d2 방향으로 도착하는 직각 폴리라인.
 * 직교면 코너 1개, 같은 방향이면 중간(절반 + bias)에서 코너 2개, 반대 방향·역행이면 null.
 * raw 끝(팬 없는 실제 핸들)은 RF와 같은 20px 스텁을 확보해야 한다. bias는 소스 레인만큼 중간 구간을
 * 비켜 세우는 값 — 같은 두 노드를 반대로 잇는 양끝 팬 엣지 쌍의 중간 구간이 정확히 포개지지 않게 한다.
 */
function routeOrth(P: Vec, d1: Vec, Q: Vec, d2: Vec, pIsRaw: boolean, qIsRaw: boolean, bias = 0): Vec[] | null {
  const pMin = pIsRaw ? FAN_STUB : 0;
  const qMin = qIsRaw ? FAN_STUB : 0;
  const rel = { x: Q.x - P.x, y: Q.y - P.y };
  const align = dot(d1, d2);
  if (Math.abs(align) < 0.5) {
    const t = dot(rel, d1);
    if (t < pMin) {
      return null;
    }
    const corner = add(P, d1, t);
    const s = dot({ x: Q.x - corner.x, y: Q.y - corner.y }, d2);
    if (s < qMin) {
      return null;
    }
    return [P, corner, Q];
  }
  if (align > 0.5) {
    const along = dot(rel, d1);
    const lead = Math.max(pMin, 1);
    const tail = Math.max(qMin, 1);
    if (along < lead + tail) {
      return null;
    }
    const a = Math.min(Math.max(along / 2 + bias, lead), along - tail);
    const c1 = add(P, d1, a);
    const c2 = add(Q, d1, -(along - a));
    return [P, c1, c2, Q];
  }
  return null;
}

/**
 * 꺾은선 팬 경로 — 팬 끝은 "게이트 포인트 + 원호"(핸들 앞 r 지점의 레인에서 반경 r 원호로 접선 진입/이탈),
 * 그 사이는 직각 라우터 + 5px 라운드. null = 팬 없음(호출자가 현행 우회/RF 경로 사용).
 * labelObstacles를 주면 라벨 앵커가 가려지지 않는 구간을 고른다(edge-detour 규칙).
 */
export function buildFanStepPath(
  args: FanPathArgs,
  fan: EdgeFan,
  labelObstacles: ObstacleRect[] = [],
): FanStepResult | null {
  const S = { x: args.sourceX, y: args.sourceY };
  const E = { x: args.targetX, y: args.targetY };
  const head = resolveFanEnd(S, args.sourcePosition, E, fan.s);
  const tail = resolveFanEnd(E, args.targetPosition, S, fan.t);
  if (!head && !tail) {
    return null;
  }
  const sourceAxes = axesOf(sideOfPosition(args.sourcePosition));
  const targetAxes = axesOf(sideOfPosition(args.targetPosition));
  const P = head ? head.gate : S;
  const d1 = head ? add({ x: 0, y: 0 }, head.lat, head.side) : sourceAxes.out;
  const Q = tail ? tail.gate : E;
  const d2 = tail ? add({ x: 0, y: 0 }, tail.lat, -tail.side) : add({ x: 0, y: 0 }, targetAxes.out, -1);
  const rawRoute = routeOrth(P, d1, Q, d2, !head, !tail, head ? head.r - FAN_R0 : 0);
  if (!rawRoute) {
    return null;
  }
  // 0길이 구간 제거(방어) — 같은 점이 연속이면 buildRoundedOrthPath가 0으로 나눠 NaN 경로가 된다
  const route = rawRoute.filter((pt, i) => i === 0 || pt.x !== rawRoute[i - 1].x || pt.y !== rawRoute[i - 1].y);
  if (route.length < 2) {
    return null;
  }
  const [inner, labelMidX, labelMidY] = buildRoundedOrthPath(route, labelObstacles);
  let labelX = labelMidX;
  let labelY = labelMidY;
  // 양끝 팬 4점 경로(같은 쌍의 왕복 엣지가 나란히 달리는 경우)는 중간 구간이 최장이라 라벨도 같은 자리에
  // 포개진다 — 소스 레인만큼(×4) 구간 방향으로 비켜 둔다. 안쪽 레인(R0)은 그대로.
  if (head && tail && route.length === 4) {
    const a = route[1];
    const b = route[2];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const isMid = labelX === (a.x + b.x) / 2 && labelY === (a.y + b.y) / 2;
    if (isMid && len > 0) {
      const shift = Math.min((head.r - FAN_R0) * 4, Math.max(0, len / 2 - FAN_STUB));
      labelX += ((b.x - a.x) / len) * shift;
      labelY += ((b.y - a.y) / len) * shift;
    }
  }
  let d = inner;
  if (head) {
    const sweep = sweepOf(head.out, d1);
    d =
      `M ${fmt(S.x)},${fmt(S.y)} A ${fmt(head.r)} ${fmt(head.r)} 0 0 ${sweep} ${fmt(head.gate.x)},${fmt(head.gate.y)}` +
      inner.replace(/^M [^ ]+/, "");
  }
  if (tail) {
    const into = add({ x: 0, y: 0 }, tail.out, -1);
    const sweep = sweepOf(d2, into);
    d += ` A ${fmt(tail.r)} ${fmt(tail.r)} 0 0 ${sweep} ${fmt(E.x)},${fmt(E.y)}`;
  }
  const points = [
    ...(head ? [S, head.vertex] : []),
    ...route,
    ...(tail ? [tail.vertex, E] : []),
  ];
  return { d, labelX, labelY, points };
}

/**
 * 곡선 팬 경로 — 팬 끝의 제어점만 1.2r로 당겨 반경이 다른 중첩 아크가 되게 한다. 끝점 불변.
 * 반환 [path, labelX, labelY](t=0.5). null = 팬 없음.
 */
export function buildFanBezierPath(args: FanPathArgs, fan: EdgeFan): [string, number, number] | null {
  const S = { x: args.sourceX, y: args.sourceY };
  const E = { x: args.targetX, y: args.targetY };
  const head = resolveFanEnd(S, args.sourcePosition, E, fan.s);
  const tail = resolveFanEnd(E, args.targetPosition, S, fan.t);
  if (!head && !tail) {
    return null;
  }
  const sourceAxes = axesOf(sideOfPosition(args.sourcePosition));
  const targetAxes = axesOf(sideOfPosition(args.targetPosition));
  // 팬 없는 끝은 RF 제어점 거리 + 위·아래 끝 최소 높이(lib/edge-stub)
  const cs = head ? head.r * BEZIER_CONTROL_PER_RADIUS : getBezierEndOffset(args, "source");
  const ct = tail ? tail.r * BEZIER_CONTROL_PER_RADIUS : getBezierEndOffset(args, "target");
  const c1 = add(S, sourceAxes.out, cs);
  const c2 = add(E, targetAxes.out, ct);
  const d = `M ${fmt(S.x)},${fmt(S.y)} C ${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(E.x)},${fmt(E.y)}`;
  const at = (a: number, b: number, c: number, e: number) => 0.125 * a + 0.375 * b + 0.375 * c + 0.125 * e;
  return [d, at(S.x, c1.x, c2.x, E.x), at(S.y, c1.y, c2.y, E.y)];
}

/** 직선 팬 — 팬 끝을 그룹 순번에 따라 변과 평행하게 ±3.5px씩 벌린다(핸들 11px 안으로 클립). */
export function spreadStraightEndpoints(args: FanPathArgs, fan: EdgeFan): FanPathArgs {
  const offsetOf = (lane: FanLane | undefined) => {
    if (!lane) {
      return 0;
    }
    const raw = (lane.idx - (lane.n - 1) / 2) * FAN_SPREAD;
    return Math.max(-FAN_SPREAD_CLIP, Math.min(FAN_SPREAD_CLIP, raw));
  };
  const sourceLat = axesOf(sideOfPosition(args.sourcePosition)).lat;
  const targetLat = axesOf(sideOfPosition(args.targetPosition)).lat;
  const so = offsetOf(fan.s);
  const to = offsetOf(fan.t);
  return {
    ...args,
    sourceX: args.sourceX + sourceLat.x * so,
    sourceY: args.sourceY + sourceLat.y * so,
    targetX: args.targetX + targetLat.x * to,
    targetY: args.targetY + targetLat.y * to,
  };
}
