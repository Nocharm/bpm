// 위·아래 변 연결선의 최소 높이 — 같은 높이의 위→위 연결이 노드 위 20px(RF 기본 스텁) 안쪽에서 납작하게 돌아
// 답답하던 것(사용자 결정 2026-10-06, 40px). 에디터·L5 캔버스(multiline-edge)·비교(LabeledSmoothEdge)·
// 팬아웃 루프백 레인(lib/edge-fanout)·SP 미리보기(scope-preview)가 이 값을 쓴다.
// 두 끝이 서로 정면인 연결(위 노드 아래 → 아래 노드 위 등)은 가운데에서 꺾여 대상이 아니다 — 40px를 강제하면
// 간격이 좁을 때 선이 지나쳤다 되돌아온다.
import { getBezierPath, getSmoothStepPath, Position } from "@xyflow/react";

/** 위·아래 끝이 꺾기 전에 확보하는 최소 수직 거리(px) */
export const VERTICAL_EDGE_STUB = 40;
/** 곡선 최소 제어점 거리 — 3차 곡선의 꼭짓점은 제어점 거리의 3/4까지만 뜨므로, 꼭짓점이 최소 높이에 닿게 4/3배 */
const BEZIER_MIN_CONTROL = (VERTICAL_EDGE_STUB * 4) / 3;
/** RF getBezierPath 기본 curvature — 역방향(distance<0) 제어점 거리 공식에만 쓰인다 */
const RF_CURVATURE = 0.25;

/** RF EdgeProps의 좌표 6개 */
export interface EdgeEndsArgs {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}

export function isVerticalPosition(position: Position): boolean {
  return position === Position.Top || position === Position.Bottom;
}

/** 변의 바깥 법선 */
function outOf(position: Position): { x: number; y: number } {
  switch (position) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    default:
      return { x: 0, y: 1 };
  }
}

/** 상대 끝이 이 끝의 정면으로 떨어진 거리(+ = 정면, 0·- = 같은 줄·등 뒤) */
function getFrontDistance(x: number, y: number, position: Position, otherX: number, otherY: number): number {
  const out = outOf(position);
  return (otherX - x) * out.x + (otherY - y) * out.y;
}

/** 최소 높이 대상 — 위·아래 끝이 있고 두 끝이 서로 정면이 아닌(같은 변끼리·상대가 등 뒤) 연결 */
export function needsVerticalStub(args: EdgeEndsArgs): boolean {
  if (!isVerticalPosition(args.sourcePosition) && !isVerticalPosition(args.targetPosition)) {
    return false;
  }
  const ds = getFrontDistance(args.sourceX, args.sourceY, args.sourcePosition, args.targetX, args.targetY);
  const dt = getFrontDistance(args.targetX, args.targetY, args.targetPosition, args.sourceX, args.sourceY);
  return !(ds > 0 && dt > 0);
}

/** RF getBezierPath의 제어점 거리 — 정면이면 거리의 절반, 뒤쪽이면 curvature·25·√(-distance) */
export function getRfControlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : RF_CURVATURE * 25 * Math.sqrt(-distance);
}

/** 곡선 한 끝의 제어점 거리 — 최소 높이 대상의 위·아래 끝은 꼭짓점이 VERTICAL_EDGE_STUB 이상 뜨게 */
export function getBezierEndOffset(args: EdgeEndsArgs, end: "source" | "target"): number {
  const isSource = end === "source";
  const position = isSource ? args.sourcePosition : args.targetPosition;
  const distance = isSource
    ? getFrontDistance(args.sourceX, args.sourceY, position, args.targetX, args.targetY)
    : getFrontDistance(args.targetX, args.targetY, position, args.sourceX, args.sourceY);
  const offset = getRfControlOffset(distance);
  return isVerticalPosition(position) && needsVerticalStub(args) ? Math.max(offset, BEZIER_MIN_CONTROL) : offset;
}

/** 꺾은선 — RF 경로에 최소 높이 대상이면 스텁(offset)만 40px로. 반환 [path, labelX, labelY] */
export function getSmoothStepPathWithStub(args: EdgeEndsArgs): [string, number, number] {
  const [path, labelX, labelY] = getSmoothStepPath(
    needsVerticalStub(args) ? { ...args, offset: VERTICAL_EDGE_STUB } : args,
  );
  return [path, labelX, labelY];
}

/** 곡선 — 최소 높이 대상이 아니면 RF 그대로, 대상이면 위·아래 끝 제어점을 늘려 꼭짓점이 40px 이상 뜨는 같은 3차 곡선. */
export function getBezierPathWithStub(args: EdgeEndsArgs): [string, number, number] {
  if (!needsVerticalStub(args)) {
    const [path, labelX, labelY] = getBezierPath(args);
    return [path, labelX, labelY];
  }
  const so = outOf(args.sourcePosition);
  const to = outOf(args.targetPosition);
  const cs = getBezierEndOffset(args, "source");
  const ct = getBezierEndOffset(args, "target");
  const c1 = { x: args.sourceX + so.x * cs, y: args.sourceY + so.y * cs };
  const c2 = { x: args.targetX + to.x * ct, y: args.targetY + to.y * ct };
  const path = `M${args.sourceX},${args.sourceY} C${c1.x},${c1.y} ${c2.x},${c2.y} ${args.targetX},${args.targetY}`;
  // RF getBezierEdgeCenter와 같은 t=0.5 지점
  const at = (a: number, b: number, c: number, e: number) => 0.125 * a + 0.375 * b + 0.375 * c + 0.125 * e;
  return [path, at(args.sourceX, c1.x, c2.x, args.targetX), at(args.sourceY, c1.y, c2.y, args.targetY)];
}
