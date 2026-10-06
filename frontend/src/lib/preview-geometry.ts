// 경량 SVG 프리뷰(ScopePreview) 기하 — 노드 박스·엣지 경로·라벨·viewBox를 순수 함수로 산출한다.
// 조상 창·요약 모달·라이브러리 피크·임포트 리포트·캠페인 태스크 패널이 같은 장면을 그리고,
// 줌 훅(use-preview-zoom)도 같은 viewBox로 첫 배율을 잡는다. 에디터와 같은 규칙(노드 크기 추정·저장된 변·
// 선 모양·라벨 알약·SP 끝 제목 미러)을 따르되 렌더러는 ReactFlow 없이 SVG 하나다.

import { getStraightPath, type Edge } from "@xyflow/react";
import type { CSSProperties } from "react";

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import {
  estimateNodeHeight,
  estimateNodeWidth,
  type HandleSide,
  nodeSizeOf,
  normalizeNodeType,
  type ProcessNodeType,
  sideFromHandleId,
  styleEdgeLabelPill,
  terminalDisplayLabel,
  toPosition,
} from "@/lib/canvas";
import {
  buildDetourPoints,
  buildRoundedOrthPath,
  type EdgeObstacle,
  isPolylineBlocked,
  toEdgeObstacle,
} from "@/lib/edge-detour";
import { EDGE_MIN_STUB, getBezierPathWithStub, getSmoothStepPathWithStub } from "@/lib/edge-stub";
import { isBackEdge } from "@/lib/flow-layout";
import { applyMirroredEndLabels, deriveSubEnds, PRIMARY_END_HANDLE, type SubEnd } from "@/lib/subprocess-embed";

/** 프리뷰 노드 제목 최대 줄 수 — 넘치면 말줄임(노드 높이도 이 줄 수까지만 자란다) */
export const PREVIEW_TITLE_MAX_LINES = 3;
const TITLE_LINE_HEIGHT = 20; // canvas.ts NODE_LINE_HEIGHT와 같은 줄 높이(px)
// SP 노드 폭 조절 범위 — process-node.tsx SP_BASE_WIDTH(180)·SP_MAX_WIDTH(×1.2)와 동기
const SP_MIN_WIDTH = 180;
const SP_MAX_WIDTH = 216;
// 좌·우 핸들을 제목 라인 높이에 고정(px) — process-node NodeHandles sideAnchorTop·SubprocessHandles anchorTop과 동기
const SIDE_ANCHOR_TOP = 18;
/** 역행 통로가 노드 위(아래)로 띄우는 높이 — 연결선 최소 거리(lib/edge-stub)와 같은 값 */
const BACK_EDGE_CLEARANCE = EDGE_MIN_STUB;
/** 같은 노드의 역행 엣지가 포개지지 않게 레인마다 더 띄우는 간격(px) — 에디터 팬아웃 FAN_GAP과 동일 */
const BACK_EDGE_LANE_GAP = 10;
// 같은 줄을 건너뛰는 정방향 엣지가 아래 통로로 내려가기 전 수평으로 빠지는 길이(px) — RF smoothstep 기본 스텁
const SKIP_LANE_STUB = 20;
const VIEW_PAD = 40; // viewBox 좌·우·위·아래 기본 여백(px)
const EDGE_MARGIN = 16; // 통로·스텁 선이 viewBox 가장자리에서 잘리지 않는 여백(px)

export interface PreviewBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  // 노드 타입 — 좌·우 앵커 높이(process·SP는 제목 라인, 그 외는 세로 중앙). 없으면 세로 중앙
  type?: ProcessNodeType;
}

export interface PreviewNodeBox extends PreviewBox {
  id: string;
  type: ProcessNodeType;
  color: string; // 저장된 노드 색(빈 값=타입 기본) — 정본 해석은 렌더러(resolveNodeStroke)
  title: string; // 표시 제목(시작·끝은 캔버스와 같은 표시 규칙)
}

export interface PreviewEdgeShape {
  id: string;
  d: string;
  back: boolean; // 역행 통로(점선)
  stroke: string | null; // 분기 Yes/No 선 색 — null이면 기본선
  label: string | null;
  labelX: number;
  labelY: number;
  labelStyle: CSSProperties | null; // HTML 라벨 스타일(에디터 알약과 같은 출처: styleEdgeLabelPill)
  mirrored: boolean; // SP 끝 제목 미러 라벨(저장 안 됨)
}

export interface PreviewViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PreviewScene {
  boxes: PreviewNodeBox[];
  edges: PreviewEdgeShape[];
  viewBox: PreviewViewBox;
}

interface PreviewEdgeRef {
  id: string;
  source_node_id: string;
  target_node_id: string;
}

type Point = { x: number; y: number };

/** 노드 표시 크기 — 에디터 추정(estimateNodeWidth/Height)과 같은 규칙, SP는 저장 폭(180~216), 높이는 최대 줄 수까지 */
export function getPreviewNodeSize(node: Pick<FlatNode, "node_type" | "title" | "width">): { w: number; h: number } {
  const type = normalizeNodeType(node.node_type);
  const base = nodeSizeOf(type);
  if (type === "subprocess") {
    const w = node.width != null ? Math.min(SP_MAX_WIDTH, Math.max(SP_MIN_WIDTH, node.width)) : base.w;
    return { w, h: base.h };
  }
  const w = estimateNodeWidth(node.title, type);
  const h = estimateNodeHeight(node.title, type, w);
  return { w, h: Math.min(h, base.h + (PREVIEW_TITLE_MAX_LINES - 1) * TITLE_LINE_HEIGHT) };
}

/** 스코프 노드 → 프리뷰 박스 */
export function buildPreviewBoxes(nodes: readonly FlatNode[]): PreviewNodeBox[] {
  return nodes.map((node) => {
    const type = normalizeNodeType(node.node_type);
    const { w, h } = getPreviewNodeSize(node);
    return {
      id: node.id,
      type,
      x: node.pos_x,
      y: node.pos_y,
      w,
      h,
      cx: node.pos_x + w / 2,
      cy: node.pos_y + h / 2,
      color: node.color,
      // 빈 제목 끝(임포트 L6 기본)이 빈 상자로 보이지 않게 "End" — 캔버스와 같은 표시 규칙
      title: type === "start" || type === "end" ? terminalDisplayLabel(type, node.title) : node.title,
    };
  });
}

/** 변의 앵커점 — 위·아래는 변 중앙, 좌·우는 process·SP면 제목 라인(18px), 그 외 세로 중앙 */
export function getPreviewAnchor(box: PreviewBox, side: HandleSide): Point {
  const anchoredTop = box.type === "process" || box.type === "subprocess";
  const ay = anchoredTop ? Math.min(SIDE_ANCHOR_TOP, box.h / 2) : box.h / 2;
  switch (side) {
    case "left":
      return { x: box.x, y: box.y + ay };
    case "right":
      return { x: box.x + box.w, y: box.y + ay };
    case "top":
      return { x: box.cx, y: box.y };
    default:
      return { x: box.cx, y: box.y + box.h };
  }
}

const SIDES: readonly string[] = ["left", "right", "top", "bottom"];

function isHandleSide(value: string): value is HandleSide {
  return SIDES.includes(value);
}

/** 저장된 변 — 핸들 id 우선(s-변·t-변·SP 들어오는 문 in:변), 없으면 source_side/target_side. SP 출구는 우측 한 점 */
export function resolvePreviewSides(
  edge: Pick<GraphEdge, "source_side" | "target_side" | "source_handle" | "target_handle">,
  sourceType: ProcessNodeType,
): { source: HandleSide; target: HandleSide } {
  const sourceFallback = isHandleSide(edge.source_side) ? edge.source_side : "right";
  const targetFallback = isHandleSide(edge.target_side) ? edge.target_side : "left";
  return {
    source: sourceType === "subprocess" ? "right" : sideFromHandleId(edge.source_handle, sourceFallback),
    target: sideFromHandleId(edge.target_handle, targetFallback),
  };
}

/**
 * 역행 엣지 레인 — 같은 타깃(또는 같은 소스)의 역행 엣지끼리 가까운 상대가 안쪽(무지개 중첩, 교차 없는 유일한
 * 순서). 두 그룹에 모두 속하면 큰 레인. 역행 판정은 자동정렬과 같은 isBackEdge(LR) — 정방향은 맵에 없음.
 */
export function assignPreviewBackLanes(
  edges: readonly PreviewEdgeRef[],
  centerById: ReadonlyMap<string, { cx: number; cy: number }>,
): Map<string, number> {
  const back = edges.filter((edge) => {
    const source = centerById.get(edge.source_node_id);
    const target = centerById.get(edge.target_node_id);
    return !!source && !!target && isBackEdge("LR", source, target);
  });
  const lanes = new Map<string, number>();
  const span = (e: PreviewEdgeRef) =>
    (centerById.get(e.source_node_id)?.cx ?? 0) - (centerById.get(e.target_node_id)?.cx ?? 0);
  const byId = (a: PreviewEdgeRef, b: PreviewEdgeRef) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const groupsBy = (key: (edge: PreviewEdgeRef) => string) => {
    const groups = new Map<string, PreviewEdgeRef[]>();
    for (const edge of back) {
      const k = key(edge);
      groups.set(k, [...(groups.get(k) ?? []), edge]);
    }
    return [...groups.values()];
  };
  const groups = [...groupsBy((edge) => `t:${edge.target_node_id}`), ...groupsBy((edge) => `s:${edge.source_node_id}`)];
  for (const group of groups) {
    group.sort((a, b) => span(a) - span(b) || byId(a, b)).forEach((edge, k) => lanes.set(edge.id, Math.max(lanes.get(edge.id) ?? 0, k)));
  }
  // 두 그룹(같은 타깃·같은 소스)에 걸친 엣지가 같은 레인에 겹치면 긴 쪽을 한 칸 올린다 — 수렴할 때까지(역행 엣지는 소수)
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const group of groups) {
      let prev = -1;
      for (const edge of [...group].sort((a, b) => (lanes.get(a.id) ?? 0) - (lanes.get(b.id) ?? 0) || span(a) - span(b) || byId(a, b))) {
        const lane = lanes.get(edge.id) ?? 0;
        if (lane <= prev) {
          lanes.set(edge.id, prev + 1);
          changed = true;
          prev += 1;
        } else {
          prev = lane;
        }
      }
    }
    if (!changed) break;
  }
  return lanes;
}

/**
 * 수평 통로 높이 — 두 끝 기준 높이에서 시작해, 통로(xFrom~xTo)가 사이 노드를 지나면 그 노드 너머로 다시 띄운다.
 * 두 끝점만 보면 사이에 올라간 곁가지를 통로가 관통한다. 매 반복 통로가 단조 이동하므로 노드 수 안에 끝난다.
 */
export function findPreviewLaneY(
  startY: number,
  xFrom: number,
  xTo: number,
  below: boolean,
  offset: number,
  obstacles: readonly EdgeObstacle[],
  skipA?: string,
  skipB?: string,
): number {
  let y = startY;
  for (let i = 0; i <= obstacles.length; i += 1) {
    const hit = obstacles.find(
      (o) => o.id !== skipA && o.id !== skipB && isPolylineBlocked([{ x: xFrom, y }, { x: xTo, y }], [o]),
    );
    if (!hit) break;
    y = below ? hit.y + hit.h + BACK_EDGE_CLEARANCE + offset : hit.y - BACK_EDGE_CLEARANCE - offset;
  }
  return y;
}

/** 역행 엣지 — 소스 위(아래)→통로→타깃 위(아래). 저장된 변이 아래면 아래 통로, 그 외 위. lane만큼 통로를 더 띄운다 */
export function buildPreviewBackPoints(
  source: PreviewBox & { id?: string },
  target: PreviewBox & { id?: string },
  below: boolean,
  lane: number,
  obstacles: readonly EdgeObstacle[] = [],
): Point[] {
  const offset = lane * BACK_EDGE_LANE_GAP;
  const s = below ? { x: source.cx, y: source.y + source.h } : { x: source.cx, y: source.y };
  const t = below ? { x: target.cx, y: target.y + target.h } : { x: target.cx, y: target.y };
  const startY = below
    ? Math.max(s.y, t.y) + BACK_EDGE_CLEARANCE + offset
    : Math.min(s.y, t.y) - BACK_EDGE_CLEARANCE - offset;
  const y = findPreviewLaneY(startY, s.x, t.x, below, offset, obstacles, source.id, target.id);
  return [s, { x: s.x, y }, { x: t.x, y }, t];
}

type LineStyle = GraphEdge["line_style"] | undefined;

/**
 * 정방향(역행 아닌) 엣지 경로 — 에디터와 같은 선 모양: 직선·곡선은 RF 경로, 꺾은선(레거시 "" 포함)은
 * 장애물 우회(lib/edge-detour). 같은 줄을 건너뛰는 엣지(A→D가 B·C에 묻혀 순차 흐름처럼 보이던 것)는
 * 중간 회랑만 옮기는 우회로 못 빠지므로 노드 아래 통로로 내려 보낸다.
 */
export function buildPreviewForwardPath(
  source: PreviewBox & { id?: string },
  target: PreviewBox & { id?: string },
  sides: { source: HandleSide; target: HandleSide },
  lineStyle: LineStyle,
  obstacles: readonly EdgeObstacle[] = [],
): { d: string; labelX: number; labelY: number; points: Point[] | null } {
  const sa = getPreviewAnchor(source, sides.source);
  const ta = getPreviewAnchor(target, sides.target);
  const params = {
    sourceX: sa.x,
    sourceY: sa.y,
    sourcePosition: toPosition(sides.source),
    targetX: ta.x,
    targetY: ta.y,
    targetPosition: toPosition(sides.target),
  };
  if (lineStyle === "straight") {
    const [d, labelX, labelY] = getStraightPath(params);
    return { d, labelX, labelY, points: null };
  }
  if (lineStyle === "default") {
    const [d, labelX, labelY] = getBezierPathWithStub(params);
    return { d, labelX, labelY, points: null };
  }
  const others = obstacles.filter((o) => o.id !== source.id && o.id !== target.id);
  const detour = buildDetourPoints({ ...params, obstacles, skipA: source.id, skipB: target.id });
  if (detour) {
    const [d, labelX, labelY] = buildRoundedOrthPath(detour, others);
    return { d, labelX, labelY, points: detour };
  }
  // 우→좌 정방향의 기본 3구간(H·V·H) 근사 — 이것도 막히면(같은 줄 건너뛰기) 아래 통로로
  const isRightToLeft = sides.source === "right" && sides.target === "left" && ta.x - sa.x > SKIP_LANE_STUB * 2;
  if (isRightToLeft) {
    const midX = (sa.x + ta.x) / 2;
    const basic = [sa, { x: midX, y: sa.y }, { x: midX, y: ta.y }, ta];
    if (isPolylineBlocked(basic, others)) {
      const x1 = sa.x + SKIP_LANE_STUB;
      const x2 = ta.x - SKIP_LANE_STUB;
      const startY = Math.max(source.y + source.h, target.y + target.h) + BACK_EDGE_CLEARANCE;
      const y = findPreviewLaneY(startY, x1, x2, true, 0, others);
      const points = [sa, { x: x1, y: sa.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: ta.y }, ta];
      const [d, labelX, labelY] = buildRoundedOrthPath(points, others);
      return { d, labelX, labelY, points };
    }
  }
  const [d, labelX, labelY] = getSmoothStepPathWithStub(params);
  return { d, labelX, labelY, points: null };
}

/** SP 출구 끝 목록 — 임베드 자식(끝 노드)이 있으면 그것, 없으면 나가는 엣지의 끝 키로 근사(대표 끝 제목은 모름) */
function buildEndsOf(nodes: readonly FlatNode[], edges: readonly GraphEdge[]): (nodeId: string) => SubEnd[] {
  return (nodeId) => {
    const children = nodes.filter((node) => node.parent_node_id === nodeId && node.node_type === "end");
    if (children.length > 0) {
      return deriveSubEnds({ nodes: children, edges: [], groups: [] });
    }
    const keys = new Set(
      edges
        .filter((edge) => edge.source_node_id === nodeId && edge.source_handle && edge.source_handle !== PRIMARY_END_HANDLE)
        .map((edge) => edge.source_handle as string),
    );
    // 보조 끝 키가 하나라도 있으면 끝은 2개 이상(대표 끝 + 보조) — 대표 끝 제목은 빈 값이라 미러하지 않는다
    return keys.size === 0
      ? []
      : [
          { key: PRIMARY_END_HANDLE, title: "", isPrimary: true, nodeId: "" },
          ...[...keys].map((key) => ({ key, title: key, isPrimary: false, nodeId: "" })),
        ];
  };
}

/** HTML 라벨 스타일 — styleEdgeLabelPill의 SVG 어휘(fill/stroke)를 HTML로(multiline-edge renderEdge와 같은 번역) */
function toLabelStyle(edge: Edge): CSSProperties | null {
  if (!edge.label) return null;
  const bg = edge.labelBgStyle;
  const [padX, padY] = edge.labelBgPadding ?? [6, 3];
  return {
    color: edge.labelStyle?.fill,
    fontWeight: edge.labelStyle?.fontWeight,
    fontSize: edge.labelStyle?.fontSize,
    background: bg?.fill,
    border: bg?.stroke ? `1px ${bg.strokeDasharray ? "dashed" : "solid"} ${bg.stroke}` : undefined,
    borderRadius: edge.labelBgBorderRadius,
    padding: `${padY}px ${padX}px`,
  };
}

/** 스코프 하나의 프리뷰 장면 — 박스·엣지 경로·라벨·viewBox. 노드가 없으면 null */
export function buildPreviewScene(graph: VersionGraph | null, scopeParentId: string | null): PreviewScene | null {
  const allNodes = graph?.nodes ?? [];
  const scopeNodes = allNodes.filter((node) => node.parent_node_id === scopeParentId);
  if (scopeNodes.length === 0) return null;
  const boxes = buildPreviewBoxes(scopeNodes);
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const rawEdges = (graph?.edges ?? []).filter(
    (edge) => boxById.has(edge.source_node_id) && boxById.has(edge.target_node_id),
  );
  const obstacles = boxes.map((box) => toEdgeObstacle(box.id, box));
  const backLanes = assignPreviewBackLanes(rawEdges, boxById);
  // 라벨 — 직접 라벨 우선, 끝 ≥2 SP의 무라벨 출구는 끝 제목 미러, 알약 스타일은 에디터와 같은 출처
  const labeled = applyMirroredEndLabels(
    rawEdges.map((edge) => ({
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      sourceHandle: boxById.get(edge.source_node_id)?.type === "subprocess" ? edge.source_handle : null,
      label: edge.label || undefined,
    })),
    buildEndsOf(allNodes, rawEdges),
  ).map(styleEdgeLabelPill);

  let edgeTop = Infinity;
  let edgeBottom = -Infinity;
  let edgeLeft = Infinity;
  let edgeRight = -Infinity;
  const edges = rawEdges.map((edge, i): PreviewEdgeShape => {
    const source = boxById.get(edge.source_node_id) as PreviewNodeBox;
    const target = boxById.get(edge.target_node_id) as PreviewNodeBox;
    const sides = resolvePreviewSides(edge, source.type);
    const back = backLanes.has(edge.id);
    let d: string;
    let labelX: number;
    let labelY: number;
    let points: Point[] | null;
    if (back) {
      const below = sides.source === "bottom" || sides.target === "bottom";
      points = buildPreviewBackPoints(source, target, below, backLanes.get(edge.id) ?? 0, obstacles);
      [d, labelX, labelY] = buildRoundedOrthPath(points);
    } else {
      ({ d, labelX, labelY, points } = buildPreviewForwardPath(source, target, sides, edge.line_style, obstacles));
    }
    // viewBox 범위 — 통로·스텁이 잘리지 않게(점을 모르는 RF 경로는 끝의 최소 거리로 근사, 세로 정렬의 좌→좌·우→우 포함)
    const ends = [getPreviewAnchor(source, sides.source), getPreviewAnchor(target, sides.target)];
    for (const p of points ?? ends) {
      edgeTop = Math.min(edgeTop, p.y);
      edgeBottom = Math.max(edgeBottom, p.y);
      edgeLeft = Math.min(edgeLeft, p.x);
      edgeRight = Math.max(edgeRight, p.x);
    }
    if (!points) {
      if (sides.source === "top" || sides.target === "top") edgeTop = Math.min(edgeTop, Math.min(ends[0].y, ends[1].y) - BACK_EDGE_CLEARANCE);
      if (sides.source === "bottom" || sides.target === "bottom") edgeBottom = Math.max(edgeBottom, Math.max(ends[0].y, ends[1].y) + BACK_EDGE_CLEARANCE);
      if (sides.source === "left" || sides.target === "left") edgeLeft = Math.min(edgeLeft, Math.min(ends[0].x, ends[1].x) - BACK_EDGE_CLEARANCE);
      if (sides.source === "right" || sides.target === "right") edgeRight = Math.max(edgeRight, Math.max(ends[0].x, ends[1].x) + BACK_EDGE_CLEARANCE);
    }
    const styled = labeled[i];
    const stroke = typeof styled.style?.stroke === "string" ? styled.style.stroke : null;
    return {
      id: edge.id,
      d,
      back,
      stroke,
      label: typeof styled.label === "string" && styled.label ? styled.label : null,
      labelX,
      labelY,
      labelStyle: toLabelStyle(styled),
      mirrored: styled.data?.labelMirrored === true,
    };
  });

  const minX = Math.min(Math.min(...boxes.map((box) => box.x)) - VIEW_PAD, edgeLeft - EDGE_MARGIN);
  const maxX = Math.max(Math.max(...boxes.map((box) => box.x + box.w)) + VIEW_PAD, edgeRight + EDGE_MARGIN);
  const minY = Math.min(Math.min(...boxes.map((box) => box.y)) - VIEW_PAD, edgeTop - EDGE_MARGIN);
  const maxY = Math.max(Math.max(...boxes.map((box) => box.y + box.h)) + VIEW_PAD, edgeBottom + EDGE_MARGIN);
  return {
    boxes,
    edges,
    viewBox: { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) },
  };
}

/** 프리뷰 viewBox — 임포트 미리보기·줌 훅이 ScopePreview와 같은 여백으로 첫 배율을 계산한다 */
export function computePreviewViewBox(graph: VersionGraph | null, scopeParentId: string | null): PreviewViewBox | null {
  return buildPreviewScene(graph, scopeParentId)?.viewBox ?? null;
}

// 분기 노드는 실캔버스처럼 마름모 — 박스에 내접하는 네 꼭짓점(상·우·하·좌) (2026-09-23)
export function buildDiamondPoints(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
}

