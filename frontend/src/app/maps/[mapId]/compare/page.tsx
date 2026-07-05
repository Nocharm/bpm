"use client";

// 버전 비교 화면 — 두 버전을 하나의 병합 캔버스로 렌더. 저장 좌표 무시·dagre 연결 기반 배치,
// 추가/삭제 엣지와 추가/삭제/변경 노드를 색으로 표현하고 변경 목록 클릭으로 포커스. (재작성: spec 2026-06-23)

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  getNodesBounds,
  getViewportForBounds,
  MarkerType,
  type NodeTypes,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Maximize,
  Minus,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ProcessNode } from "@/components/process-node";
import {
  getFullGraph,
  getMap,
  type VersionGraph,
  type VersionStatus,
  type VersionSummary,
} from "@/lib/api";
import {
  type HandleSide,
  layoutWithDagre,
  nodeSizeOf,
  normalizeNodeType,
  sourceHandleId,
  targetHandleId,
  type AppNode,
  withSubprocessHandles,
} from "@/lib/canvas";
import type { ChangedField } from "@/lib/diff";
import { useI18n } from "@/lib/i18n";
import { NodeActionsContext, type NodeActions } from "@/lib/node-actions";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  buildMergedGraph,
  type MergedEdge,
  type MergedNode,
  type MergedNodeStatus,
} from "@/lib/merge-diff";

const nodeTypes: NodeTypes = { process: ProcessNode };

// passthrough-removed(양끝이 모두 유지 노드) 엣지 — 삽입 노드를 피해 아래로 우회하는 아크(red 점선). C2b.
// 삭제된 직접 연결이 새 경로(A→X→B) 위/아래로 겹치지 않게, source→target을 아래로 부풀린 베지어로.
function RemovedArcEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style }: EdgeProps) {
  // 아래에서 출발해 아래로 도착 — bottom 핸들에서 수직으로 내려가 아래로 우회하는 U자 아크.
  const dip = Math.max(sourceY, targetY) + 52;
  const path = `M${sourceX},${sourceY} C${sourceX},${dip} ${targetX},${dip} ${targetX},${targetY}`;
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}

const edgeTypes: EdgeTypes = { removedArc: RemovedArcEdge };

// 비교뷰 노드 컨텍스트 — 변경은 diff 필로 보여주므로 박스의 BPM 필드 줄을 숨긴다(displayFields: []).
// 노드 높이가 내용과 무관하게 균일해져 백본 정렬(alignBackbone)이 정확해지고 중복 표시도 제거.
const COMPARE_NODE_ACTIONS: NodeActions = {
  onToggleExpand: null,
  expandedInlineIds: new Set<string>(),
  displayFields: [],
  editingNodeId: null,
  onStartRename: null,
  onRename: null,
  onCancelRename: null,
};

const FIELD_MSG: Record<ChangedField, MessageKey> = {
  title: "field.title",
  description: "field.description",
  type: "field.type",
  color: "field.color",
  assignee: "field.assignee",
  department: "field.department",
  system: "field.system",
  duration: "field.duration",
  location: "field.location",
};

// 병합 노드 status → ProcessNode diffStatus (unchanged는 중립=undefined)
function toDiffStatus(status: MergedNodeStatus): "added" | "removed" | "changed" | undefined {
  return status === "unchanged" ? undefined : status;
}

// union 노드를 좌표 없는 AppNode로 — 이후 layoutWithDagre가 위치 산정
type DiffFieldRow = { label: string; before: string; after: string };

function buildAppNodes(
  merged: MergedNode[],
  noteOf: (node: MergedNode) => string | undefined,
  fieldsOf: (node: MergedNode) => DiffFieldRow[] | undefined,
): AppNode[] {
  return merged.map((m) => ({
    id: m.id,
    type: "process",
    position: { x: 0, y: 0 },
    data: {
      label: m.node.title,
      description: m.node.description,
      nodeType: normalizeNodeType(m.node.node_type),
      color: m.node.color,
      assignee: m.node.assignee,
      department: m.node.department,
      system: m.node.system,
      duration: m.node.duration,
      groupIds: m.node.group_ids ?? [],
      hasChildren: false,
      diffStatus: toDiffStatus(m.status),
      diffNote: noteOf(m),
      diffFields: fieldsOf(m),
    },
  }));
}

const SIDE_VECTORS: { side: HandleSide; vx: number; vy: number }[] = [
  { side: "right", vx: 1, vy: 0 },
  { side: "left", vx: -1, vy: 0 },
  { side: "top", vx: 0, vy: -1 },
  { side: "bottom", vx: 0, vy: 1 },
];

// 상대 노드 방향(dx,dy)에 잘 맞는 순으로 4변 정렬(내적 내림차순). 노드별 그리디 배정에서
// 최상위부터 시도하되 이미 쓴 변이면 다음 변으로 넘어가 분기 엣지를 4변에 골고루 흩뿌린다.
function preferredSides(dx: number, dy: number): HandleSide[] {
  const len = Math.hypot(dx, dy) || 1;
  return [...SIDE_VECTORS]
    .sort((a, b) => (b.vx * dx + b.vy * dy) / len - (a.vx * dx + a.vy * dy) / len)
    .map((s) => s.side);
}

// dagre 배치 후처리 — 유지(unchanged/changed) 노드를 공통 backbone 중심Y에 맞춰 열(rank)별로 세로 이동.
// ①백본이 완전 직선(중심Y 일치 → smoothstep 직각 계단 제거) ②병렬 곁가지의 유지/변경 노드(예: 관리자 승인)를
// 라인 위로. 추가 노드는 같은 열 내 상대 오프셋을 유지해 위/아래 곁가지로 남는다. 열=중심X로 그룹.
// 비교뷰 실측 렌더 높이(displayFields:[]로 BPM 줄 숨겨 균일). dagre는 nodeSizeOf로 배치하지만
// 렌더 중심은 실제 높이 기준이라, 정렬은 이 값으로 계산해야 handle Y가 정확히 일치(직선).
const COMPARE_RENDER_H: Record<string, number> = {
  process: 38,
  decision: 96,
  start: 38,
  end: 38,
  subprocess: 64,
};

function alignBackbone(nodes: AppNode[], keptIds: Set<string>): AppNode[] {
  const centerY = (node: AppNode) =>
    node.position.y + (COMPARE_RENDER_H[node.data.nodeType] ?? 38) / 2;
  const kept = nodes.filter((node) => keptIds.has(node.id));
  if (kept.length === 0) return nodes;
  const backboneCY = kept.reduce((sum, node) => sum + centerY(node), 0) / kept.length;
  const columnKey = (node: AppNode) =>
    Math.round((node.position.x + nodeSizeOf(node.data.nodeType).w / 2) / 10);
  const columns = new Map<number, AppNode[]>();
  for (const node of nodes) {
    const key = columnKey(node);
    const list = columns.get(key);
    if (list) list.push(node);
    else columns.set(key, [node]);
  }
  // 유지 노드가 있는 열의 shift(그 노드를 backbone에 맞춤).
  const keptShift = new Map<number, number>();
  for (const [key, colNodes] of columns) {
    const keptInCol = colNodes.filter((node) => keptIds.has(node.id));
    if (keptInCol.length) keptShift.set(key, backboneCY - centerY(keptInCol[0]));
  }
  // 유지 노드 없는 열(순수 추가/삭제 열)은 가장 가까운 유지 열의 shift를 그대로 적용 — 추가 노드의
  // dagre 오프셋(위/아래)을 보존한다: 병렬 곁가지(예: 재고 예약)는 라인 밖에 남아 직접 엣지를 안 막고,
  // 인라인 삽입(예: 배송 준비)은 dagre가 라인에 뒀으니 그대로 라인 위.
  const nearestKeptShift = (key: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (const [keptKey, shift] of keptShift) {
      const dist = Math.abs(keptKey - key);
      if (dist < bestDist) {
        bestDist = dist;
        best = shift;
      }
    }
    return best;
  };
  const shiftedY = new Map<string, number>();
  for (const [key, colNodes] of columns) {
    let shift: number;
    if (keptShift.has(key)) {
      shift = keptShift.get(key) ?? 0;
    } else {
      const base = nearestKeptShift(key);
      // 인라인 삽입(dagre가 라인 근처에 배치)이면 라인에 정확히 스냅, 병렬 곁가지(라인에서 먼)면 오프셋 보존.
      const repCenterY = centerY(colNodes[0]);
      shift = Math.abs(repCenterY + base - backboneCY) < 25 ? backboneCY - repCenterY : base;
    }
    for (const node of colNodes) shiftedY.set(node.id, node.position.y + shift);
  }
  return nodes.map((node) => ({
    ...node,
    position: { x: node.position.x, y: shiftedY.get(node.id) ?? node.position.y },
  }));
}

// 좌우 과도 확장 방지 — 백본 라인 노드를 X순으로 훑어 한 행이 MAX개를 넘으면 다음 1:1 연결 지점에서
// 다음 행(좌측부터 다시)으로 접는다. 각 노드는 자기 열의 행 오프셋(아래로 ROW_GAP·좌측 정렬)을 받고,
// 곁가지(추가/삭제)는 같은 열이므로 함께 이동. 접힘은 1:1(단일 출구→단일 입구)에서만 — 분기/합류는 유지.
function wrapLayout(
  nodes: AppNode[],
  outDeg: Map<string, number>,
  inDeg: Map<string, number>,
  keptIds: Set<string>,
): AppNode[] {
  const MAX_PER_ROW = 4;
  const ROW_GAP = 300;
  const centerX = (node: AppNode) => node.position.x + nodeSizeOf(node.data.nodeType).w / 2;
  const centerY = (node: AppNode) => node.position.y + (COMPARE_RENDER_H[node.data.nodeType] ?? 38) / 2;
  const kept = nodes.filter((node) => keptIds.has(node.id));
  if (kept.length === 0) return nodes;
  const backboneCY = kept.reduce((sum, node) => sum + centerY(node), 0) / kept.length;
  const backboneSeq = nodes
    .filter((node) => Math.abs(centerY(node) - backboneCY) < 20)
    .sort((a, b) => centerX(a) - centerX(b));
  if (backboneSeq.length <= MAX_PER_ROW) return nodes;
  // 접힘 경계 X — MAX 도달 후 cur→next가 1:1이면 next의 X부터 새 행.
  const boundaries: number[] = [];
  let count = 0;
  for (let i = 0; i < backboneSeq.length; i += 1) {
    count += 1;
    if (count >= MAX_PER_ROW && i + 1 < backboneSeq.length) {
      const cur = backboneSeq[i];
      const next = backboneSeq[i + 1];
      if ((outDeg.get(cur.id) ?? 0) === 1 && (inDeg.get(next.id) ?? 0) === 1) {
        boundaries.push(centerX(next));
        count = 0;
      }
    }
  }
  if (boundaries.length === 0) return nodes;
  const leftBase = Math.min(...backboneSeq.map(centerX));
  const rowStartX = [leftBase, ...boundaries];
  const rowOf = (x: number) => {
    let row = 0;
    for (const boundary of boundaries) if (x >= boundary - 1) row += 1;
    return row;
  };
  return nodes.map((node) => {
    const row = rowOf(centerX(node));
    return {
      ...node,
      position: {
        x: node.position.x + (leftBase - rowStartX[row]),
        y: node.position.y + row * ROW_GAP,
      },
    };
  });
}

function buildAppEdges(merged: MergedEdge[], keptKeys: Set<string>): Edge[] {
  return merged.map((e) => {
    // 양끝이 모두 유지 노드인 removed 엣지 = 삽입 등으로 끊긴 직접 연결 → 우회 아크로 렌더.
    const passthrough =
      e.status === "removed" && keptKeys.has(e.source) && keptKeys.has(e.target);
    const markerColor =
      e.status === "added"
        ? "var(--color-added)"
        : e.status === "removed"
          ? "var(--color-removed)"
          : "var(--color-border-strong)";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      type: passthrough ? "removedArc" : "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: markerColor },
      style:
        e.status === "added"
          ? { stroke: "var(--color-added)", strokeWidth: 2 }
          : e.status === "removed"
            ? { stroke: "var(--color-removed)", strokeWidth: 2, strokeDasharray: "6 3" }
            : undefined,
    };
  });
}

// 버전 상태 → 색점(pill 좌측) — version-status.ts 계열 토큰 재사용, 무채 기본.
const STATUS_DOT: Record<VersionStatus, string> = {
  draft: "bg-ink-tertiary",
  pending: "bg-changed",
  approved: "bg-accent",
  published: "bg-added",
  rejected: "bg-error",
  expired: "bg-ink-tertiary",
};

// BASE/TARGET 역할 태그 + 상태 색점이 붙은 pill 셀렉터.
function VersionSelect({
  role,
  label,
  versions,
  value,
  onChange,
}: {
  role: string;
  label: string;
  versions: VersionSummary[];
  value: number;
  onChange: (id: number) => void;
}) {
  const current = versions.find((version) => version.id === value);
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-fine font-semibold tracking-wide text-ink-tertiary">{role}</span>
      <div className="relative flex h-7 items-center rounded-sm border border-hairline bg-surface pr-6 pl-2 hover:bg-surface-alt">
        <span
          className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
            current ? STATUS_DOT[current.status] : "bg-ink-tertiary"
          }`}
        />
        <select
          aria-label={label}
          className="cursor-pointer appearance-none bg-transparent text-caption text-ink focus:outline-none"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          strokeWidth={1.5}
          className="pointer-events-none absolute right-1.5 text-ink-tertiary"
        />
      </div>
    </label>
  );
}

// 좌하 범례 — 노드 diff 테두리 스타일 반영(추가 실선·삭제 점선·변경 실선).
function DiffLegend() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5 text-caption text-ink-secondary" data-id="compare-legend">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-added" /> {t("compare.legendAdded")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-dashed border-removed" />{" "}
        {t("compare.legendRemoved")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-changed" /> {t("compare.legendChanged")}
      </span>
    </div>
  );
}

// 우하 줌 바 — `- % +` + fit(전체화면). 라이브 zoom은 store transform에서.
function ZoomBar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const btn =
    "flex h-6 w-6 items-center justify-center rounded-xs text-ink-secondary hover:bg-surface-alt";
  return (
    <div className="flex items-center gap-0.5 rounded-sm border border-hairline bg-surface/90 p-0.5 shadow-sm backdrop-blur-sm">
      <button type="button" onClick={() => zoomOut()} title="Zoom out" className={btn}>
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <span className="w-9 text-center text-fine tabular-nums text-ink-secondary">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" onClick={() => zoomIn()} title="Zoom in" className={btn}>
        <Plus size={14} strokeWidth={1.5} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-divider" />
      <button type="button" onClick={() => fitView({ duration: 300 })} title="Fit view" className={btn}>
        <Maximize size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

interface ChangeItem {
  key: string;
  focusId: string;
  status: MergedNodeStatus;
  title: string;
  detail?: string;
}

function ComparePane({
  mapId,
  mapName,
  versions,
  baseId,
  targetId,
  baseGraph,
  targetGraph,
  onChangeBase,
  onChangeTarget,
}: {
  mapId: number;
  mapName: string;
  versions: VersionSummary[];
  baseId: number;
  targetId: number;
  baseGraph: VersionGraph;
  targetGraph: VersionGraph;
  onChangeBase: (id: number) => void;
  onChangeTarget: (id: number) => void;
}) {
  const { t } = useI18n();
  const flow = useReactFlow();
  const [focusId, setFocusId] = useState<string | null>(null);

  const merged = useMemo(
    () => buildMergedGraph(baseGraph, targetGraph),
    [baseGraph, targetGraph],
  );

  // 유지(non-removed) 노드 계보키 — passthrough-removed 엣지(양끝 유지) 판정용.
  const keptKeys = useMemo(
    () => new Set(merged.nodes.filter((n) => n.status !== "removed").map((n) => n.id)),
    [merged],
  );

  const noteOf = useCallback(
    (m: MergedNode): string | undefined => {
      if (m.status === "changed") {
        return t("compare.changedFields", {
          fields: m.changedFields.map((f) => t(FIELD_MSG[f])).join(", "),
        });
      }
      if (m.status === "added") return t("compare.statusAdded");
      if (m.status === "removed") return t("compare.statusRemoved");
      return undefined;
    },
    [t],
  );

  // 변경 노드의 before→after 필 표시값 — 필드 라벨 i18n + 빈값은 None.
  const fieldsOf = useCallback(
    (m: MergedNode): DiffFieldRow[] | undefined =>
      m.status === "changed"
        ? m.fieldChanges.map((fc) => ({
            label: t(FIELD_MSG[fc.field]),
            before: fc.before || t("summary.none"),
            after: fc.after || t("summary.none"),
          }))
        : undefined,
    [t],
  );

  // 좌표 없는 union 노드 → dagre 배치 (연결 기반, 저장 pos 무시). focus와 무관하게 1회만 계산.
  const positioned = useMemo(() => {
    // 배치는 To-Be(target) 흐름만으로 — 삭제 엣지를 전부 제외해 유지 백본이 깔끔한 직선이 되게 한다.
    // (삭제 엣지를 넣으면 삭제 노드가 본류 라인 위에 끼어 직접 엣지를 막고 노드를 위/아래로 왜곡시킴.)
    const layoutEdges = merged.edges.filter((edge) => edge.status !== "removed");
    const laid = layoutWithDagre(
      buildAppNodes(
        merged.nodes.filter((node) => node.status !== "removed"),
        noteOf,
        fieldsOf,
      ),
      buildAppEdges(layoutEdges, keptKeys),
    );
    // 후처리 — 유지(unchanged/changed) 백본을 공통 중심Y로 정렬(직선화 + 병렬 유지 노드 라인 위로).
    const keptStatusIds = new Set(
      merged.nodes
        .filter((node) => node.status === "unchanged" || node.status === "changed")
        .map((node) => node.id),
    );
    const aligned = alignBackbone(laid, keptStatusIds);
    // 접힘(wrap) — 긴 1:1 백본을 여러 행으로 접어 좌우 폭 축소. To-Be 흐름의 in/out 차수로 1:1 판정.
    const outDeg = new Map<string, number>();
    const inDeg = new Map<string, number>();
    for (const edge of layoutEdges) {
      outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
      inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
    }
    const wrapped = wrapLayout(aligned, outDeg, inDeg, keptStatusIds);
    // 삭제 노드는 삭제 엣지 이웃(배치된 유지 노드)의 평균 위치 아래로 곁가지 배치 — 본류 라인을 비운다.
    const posByKey = new Map(wrapped.map((node) => [node.id, node.position]));
    const removed = buildAppNodes(
      merged.nodes.filter((node) => node.status === "removed"),
      noteOf,
      fieldsOf,
    ).map((node) => {
      const neighbors = merged.edges
        .filter((edge) => edge.status === "removed" && (edge.source === node.id || edge.target === node.id))
        .map((edge) => (edge.source === node.id ? edge.target : edge.source))
        .map((key) => posByKey.get(key))
        .filter((pos): pos is { x: number; y: number } => !!pos);
      if (neighbors.length === 0) return node;
      const ax = neighbors.reduce((sum, pos) => sum + pos.x, 0) / neighbors.length;
      const ay = neighbors.reduce((sum, pos) => sum + pos.y, 0) / neighbors.length;
      return { ...node, position: { x: ax, y: ay + 150 } };
    });
    return [...wrapped, ...removed];
  }, [merged, noteOf, fieldsOf, keptKeys]);

  // 레이아웃된 노드 중심 좌표 — 엣지 핸들 변 산정용(엣지가 타겟 방향 변으로 나가고 들어오게).
  const nodeCenters = useMemo(() => {
    const centers = new Map<string, { cx: number; cy: number }>();
    for (const node of positioned) {
      const size = nodeSizeOf(node.data.nodeType);
      centers.set(node.id, {
        cx: node.position.x + size.w / 2,
        cy: node.position.y + size.h / 2,
      });
    }
    return centers;
  }, [positioned]);

  const subprocessIds = useMemo(
    () =>
      new Set(
        positioned.filter((node) => node.data.nodeType === "subprocess").map((node) => node.id),
      ),
    [positioned],
  );

  // 엣지별 붙을 변(핸들) — 노드마다 자기 엣지들을 4변에 그리디 분산(겹침 최소화). passthrough는
  // 아래(bottom)에서 출발/도착하도록 고정. 방향 확실한 엣지가 선호 변을 먼저 차지.
  const handleSides = useMemo(() => {
    // forced: passthrough(삭제 직접연결)=bottom→bottom, back(뒤로 가는 루프)=top→top(상단 우회). 그 외=방향배정.
    type Endpoint = { edgeId: string; end: "source" | "target"; otherId: string; forced: HandleSide | null };
    const perNode = new Map<string, Endpoint[]>();
    const add = (nodeId: string, ep: Endpoint) => {
      const list = perNode.get(nodeId);
      if (list) list.push(ep);
      else perNode.set(nodeId, [ep]);
    };
    for (const edge of merged.edges) {
      const s = nodeCenters.get(edge.source);
      const t = nodeCenters.get(edge.target);
      const passthrough =
        edge.status === "removed" && keptKeys.has(edge.source) && keptKeys.has(edge.target);
      const dyEdge = s && t ? t.cy - s.cy : 0;
      // 접힘(wrap) 커넥터 — 타겟이 훨씬 아래(다음 행) & 왼쪽 → 아래로 나가 다음 행 왼쪽으로 들어간다.
      const wrap = !passthrough && !!s && !!t && t.cx < s.cx && dyEdge > 150;
      // 흐름 역행 루프(같은 행) → 상단 우회
      const back = !passthrough && !wrap && !!s && !!t && t.cx < s.cx - 40 && Math.abs(dyEdge) < 150;
      const forcedSource: HandleSide | null = passthrough ? "bottom" : back ? "top" : wrap ? "bottom" : null;
      const forcedTarget: HandleSide | null = passthrough ? "bottom" : back ? "top" : wrap ? "left" : null;
      add(edge.source, { edgeId: edge.id, end: "source", otherId: edge.target, forced: forcedSource });
      add(edge.target, { edgeId: edge.id, end: "target", otherId: edge.source, forced: forcedTarget });
    }
    const result = new Map<string, { source: HandleSide; target: HandleSide }>();
    const setSide = (edgeId: string, end: "source" | "target", side: HandleSide) => {
      const row = result.get(edgeId) ?? { source: "right" as HandleSide, target: "left" as HandleSide };
      if (end === "source") row.source = side;
      else row.target = side;
      result.set(edgeId, row);
    };
    for (const [nodeId, endpoints] of perNode) {
      const center = nodeCenters.get(nodeId);
      if (!center) continue;
      const used = new Set<HandleSide>();
      // 고정 변(passthrough=bottom / back=top) 먼저 자리 확보
      for (const ep of endpoints) {
        if (ep.forced) {
          setSide(ep.edgeId, ep.end, ep.forced);
          used.add(ep.forced);
        }
      }
      // 나머지는 방향 확실한 순으로 4변 그리디 배정(이미 쓴 변 회피)
      const normal = endpoints
        .filter((ep) => !ep.forced)
        .map((ep) => {
          const other = nodeCenters.get(ep.otherId);
          const dx = other ? other.cx - center.cx : 1;
          const dy = other ? other.cy - center.cy : 0;
          const len = Math.hypot(dx, dy) || 1;
          return { ep, prefs: preferredSides(dx, dy), certainty: Math.max(Math.abs(dx), Math.abs(dy)) / len };
        });
      normal.sort((a, b) => b.certainty - a.certainty);
      for (const { ep, prefs } of normal) {
        const side = prefs.find((candidate) => !used.has(candidate)) ?? prefs[0];
        used.add(side);
        setSide(ep.edgeId, ep.end, side);
      }
    }
    return result;
  }, [merged, keptKeys, nodeCenters]);

  // 포커스된 노드만 selected 표시 (재레이아웃 없이 얕은 갱신)
  const laidNodes = useMemo(
    () => positioned.map((node) => ({ ...node, selected: focusId === node.id })),
    [positioned, focusId],
  );

  // 포커스된 엣지는 굵게 강조
  const appEdges = useMemo(
    () =>
      buildAppEdges(merged.edges, keptKeys).map((edge) => {
        let styled = edge;
        // 노드별 4변 분산 배정(handleSides) → 핸들 지정 + 하위프로세스 전용 핸들 remap.
        const sides = handleSides.get(edge.id);
        if (sides) {
          styled = {
            ...styled,
            sourceHandle: sourceHandleId(sides.source),
            targetHandle: targetHandleId(sides.target),
          };
          styled = withSubprocessHandles(styled, (id) => subprocessIds.has(id));
        }
        if (focusId === edge.id) {
          styled = { ...styled, selected: true, style: { ...(styled.style ?? {}), strokeWidth: 3 } };
        }
        return styled;
      }),
    [merged, focusId, keptKeys, handleSides, subprocessIds],
  );

  const titleByKey = useMemo(
    () => new Map(merged.nodes.map((m) => [m.id, m.node.title])),
    [merged],
  );

  const nodeChanges: ChangeItem[] = useMemo(
    () =>
      merged.nodes
        .filter((m) => m.status !== "unchanged")
        .map((m) => ({
          key: `n-${m.id}`,
          focusId: m.id,
          status: m.status,
          title: m.node.title,
          detail:
            m.status === "changed"
              ? m.changedFields.map((f) => t(FIELD_MSG[f])).join(", ")
              : undefined,
        })),
    [merged, t],
  );

  const edgeChanges: ChangeItem[] = useMemo(
    () =>
      merged.edges
        .filter((e) => e.status !== "unchanged")
        .map((e) => ({
          key: `e-${e.id}`,
          focusId: e.id,
          status: e.status,
          title: `${titleByKey.get(e.source) ?? "?"} → ${titleByKey.get(e.target) ?? "?"}`,
          detail: e.status === "added" ? t("compare.edgeAdded") : t("compare.edgeRemoved"),
        })),
    [merged, titleByKey, t],
  );

  const focusNode = useCallback(
    (id: string) => {
      setFocusId(id);
      void flow.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.3, padding: 0.4 });
    },
    [flow],
  );

  const focusEdge = useCallback(
    (edge: MergedEdge) => {
      setFocusId(edge.id);
      void flow.fitView({
        nodes: [{ id: edge.source }, { id: edge.target }],
        duration: 400,
        maxZoom: 1.3,
        padding: 0.4,
      });
    },
    [flow],
  );

  const handleSwap = useCallback(() => {
    onChangeBase(targetId);
    onChangeTarget(baseId);
  }, [onChangeBase, onChangeTarget, baseId, targetId]);

  // 병합 캔버스를 PNG로 저장 — 저장 노드 범위를 1600×1000에 맞춰 렌더(React Flow 표준 recipe).
  const handleExport = useCallback(() => {
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) return;
    const width = 1600;
    const height = 1000;
    const vp = getViewportForBounds(getNodesBounds(flow.getNodes()), width, height, 0.5, 2, 0.1);
    void toPng(viewport, {
      backgroundColor: "#F6F6F8", // bg-canvas — export 배경(데이터/출력 예외, design.md §1)
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
      },
    }).then((dataUrl) => {
      const link = document.createElement("a");
      link.download = `${mapName}-compare.png`;
      link.href = dataUrl;
      link.click();
    });
  }, [flow, mapName]);

  const badgeClass: Record<MergedNodeStatus, string> = {
    added: "bg-added/10 text-added",
    removed: "bg-removed/10 text-removed",
    changed: "bg-changed/10 text-changed",
    unchanged: "",
  };
  const badgeLabel: Record<MergedNodeStatus, string> = {
    added: t("compare.legendAdded"),
    removed: t("compare.legendRemoved"),
    changed: t("compare.legendChanged"),
    unchanged: "",
  };

  const hasChanges = nodeChanges.length + edgeChanges.length > 0;

  // 좌상 카운트 필 — 노드+엣지를 status별 집계(엣지 추가/삭제 포함, 변경은 노드만).
  const counts = useMemo(() => {
    const acc = { added: 0, removed: 0, changed: 0 };
    for (const item of [...nodeChanges, ...edgeChanges]) {
      if (item.status === "added" || item.status === "removed" || item.status === "changed") {
        acc[item.status] += 1;
      }
    }
    return acc;
  }, [nodeChanges, edgeChanges]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 메인 캔버스 스타일 참고 — 노드 핸들(히트박스) 숨김 + 노드 호버 시 자기색 강조 링(bpm-node-emph).
          Turbopack이 dev에서 .react-flow__node 셀렉터 규칙을 purge해 raw <style>로 둔다(lessons canvas §5). */}
      <style>{`
.react-flow__handle{opacity:0}
.react-flow__node:hover .bpm-node-emph{box-shadow:0 0 0 3px color-mix(in srgb,var(--nc) 42%,transparent)}
.react-flow__node{z-index:2 !important}
      `}</style>
      <header className="flex items-center gap-3 border-b border-hairline bg-surface px-4 py-2.5">
        <Link
          href={`/maps/${mapId}`}
          className="flex items-center gap-1 text-caption text-accent hover:underline"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          {t("compare.editorLink")}
        </Link>
        <span className="h-4 w-px bg-divider" />
        <div className="flex items-baseline gap-2">
          <h1 className="text-body-strong text-ink">{mapName}</h1>
          <span className="text-caption text-ink-tertiary">{t("compare.title")}</span>
        </div>
        <div className="ml-2 flex items-center gap-2">
          <VersionSelect
            role="BASE"
            label={t("compare.base")}
            versions={versions}
            value={baseId}
            onChange={onChangeBase}
          />
          <ArrowRight size={14} strokeWidth={1.5} className="text-ink-tertiary" />
          <VersionSelect
            role="TARGET"
            label={t("compare.target")}
            versions={versions}
            value={targetId}
            onChange={onChangeTarget}
          />
          <button
            type="button"
            onClick={handleSwap}
            title={t("compare.swapAria")}
            aria-label={t("compare.swapAria")}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-hairline text-ink-secondary hover:bg-surface-alt"
          >
            <ArrowLeftRight size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-hairline px-3 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            <Download size={14} strokeWidth={1.5} />
            {t("compare.export")}
          </button>
          <Link
            href={`/maps/${mapId}`}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-caption font-semibold text-on-accent hover:bg-accent/90"
          >
            <Check size={14} strokeWidth={2} />
            {t("compare.applyToBe")}
          </Link>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 bg-canvas" data-id="compare-canvas">
          <NodeActionsContext.Provider value={COMPARE_NODE_ACTIONS}>
          <ReactFlow
            nodes={laidNodes}
            edges={appEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.2}
              color="var(--color-canvas-dot)"
            />
            {hasChanges && (
              <Panel
                position="top-left"
                className="rounded-sm border border-hairline bg-surface/80 px-2.5 py-1.5 shadow-sm backdrop-blur-sm"
              >
                <div className="flex items-center gap-2 text-caption text-ink-secondary">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-added" />
                    {t("compare.legendAdded")}
                    <span className="font-semibold text-ink">{counts.added}</span>
                  </span>
                  <span className="h-3 w-px bg-divider" />
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-removed" />
                    {t("compare.legendRemoved")}
                    <span className="font-semibold text-ink">{counts.removed}</span>
                  </span>
                  <span className="h-3 w-px bg-divider" />
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-changed" />
                    {t("compare.legendChanged")}
                    <span className="font-semibold text-ink">{counts.changed}</span>
                  </span>
                </div>
              </Panel>
            )}
            <Panel
              position="bottom-left"
              className="rounded-sm border border-hairline bg-surface/80 px-2.5 py-1.5 shadow-sm backdrop-blur-sm"
            >
              <DiffLegend />
            </Panel>
            <Panel position="bottom-right">
              <ZoomBar />
            </Panel>
          </ReactFlow>
          </NodeActionsContext.Provider>
        </div>
        <aside
          className="w-72 shrink-0 overflow-auto border-l border-hairline px-3 py-2"
          data-id="compare-changes"
        >
          <div className="mb-2 text-caption-strong text-ink">{t("compare.changes")}</div>
          {!hasChanges && (
            <div className="text-caption text-ink-tertiary">{t("compare.identical")}</div>
          )}
          <ul className="space-y-1 text-body">
            {nodeChanges.map((c) => (
              <li key={c.key}>
                <button
                  className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                  onClick={() => focusNode(c.focusId)}
                >
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-caption ${badgeClass[c.status]}`}>
                    {badgeLabel[c.status]}
                  </span>
                  <span className="text-ink">{c.title}</span>
                  {c.detail && <span className="ml-1 text-caption text-ink-secondary">({c.detail})</span>}
                </button>
              </li>
            ))}
            {edgeChanges.map((c) => {
              const edge = merged.edges.find((e) => e.id === c.focusId);
              return (
                <li key={c.key}>
                  <button
                    className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                    onClick={() => edge && focusEdge(edge)}
                  >
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-caption ${badgeClass[c.status]}`}>
                      {c.detail}
                    </span>
                    <span className="text-ink-secondary">{c.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);

  const [mapName, setMapName] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [baseId, setBaseId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [baseGraph, setBaseGraph] = useState<VersionGraph | null>(null);
  const [targetGraph, setTargetGraph] = useState<VersionGraph | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const detail = await getMap(mapId);
      if (!active) return;
      setMapName(detail.name);
      setVersions(detail.versions);
      // base=게시(published) 버전 우선(없으면 최초), target=최신 — 게시본을 기준선으로 비교.
      const published = detail.versions.find((version) => version.status === "published");
      setBaseId((published ?? detail.versions[0]).id);
      setTargetId(detail.versions[detail.versions.length - 1].id);
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

  useEffect(() => {
    if (baseId === null) return;
    let active = true;
    void (async () => {
      const graph = await getFullGraph(baseId);
      if (active) setBaseGraph(graph);
    })();
    return () => {
      active = false;
    };
  }, [baseId]);

  useEffect(() => {
    if (targetId === null) return;
    let active = true;
    void (async () => {
      const graph = await getFullGraph(targetId);
      if (active) setTargetGraph(graph);
    })();
    return () => {
      active = false;
    };
  }, [targetId]);

  const ready =
    baseId !== null &&
    targetId !== null &&
    versions.length > 0 &&
    baseGraph !== null &&
    targetGraph !== null;

  return (
    <div className="flex h-full flex-col">
      {ready ? (
        <ReactFlowProvider>
          <ComparePane
            mapId={mapId}
            mapName={mapName}
            versions={versions}
            baseId={baseId}
            targetId={targetId}
            baseGraph={baseGraph}
            targetGraph={targetGraph}
            onChangeBase={setBaseId}
            onChangeTarget={setTargetId}
          />
        </ReactFlowProvider>
      ) : (
        <div className="p-8 text-caption text-ink-tertiary">…</div>
      )}
    </div>
  );
}
