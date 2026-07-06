"use client";

// 버전 비교 화면 — 두 버전을 하나의 병합 캔버스로 렌더. 저장 좌표 무시·dagre 연결 기반 배치,
// 추가/삭제 엣지와 추가/삭제/변경 노드를 색으로 표현하고 변경 목록 클릭으로 포커스. (재작성: spec 2026-06-23)

import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  EdgeLabelRenderer,
  getSmoothStepPath,
  MarkerType,
  type NodeTypes,
  Panel,
  PanOnScrollMode,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  Download,
  Lock,
  Maximize,
  Minus,
  MoveHorizontal,
  MoveVertical,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { NodeSelectionRing } from "@/components/node-selection-ring";
import { ProcessNode } from "@/components/process-node";
import {
  getFullGraph,
  getMap,
  type VersionGraph,
  type VersionStatus,
  type VersionSummary,
} from "@/lib/api";
import {
  getNextNodeAlongFlow,
  getPrevNodeAlongFlow,
  type HandleSide,
  layoutWithDagre,
  nodeSizeOf,
  normalizeNodeType,
  sourceHandleId,
  targetHandleId,
  type AppNode,
} from "@/lib/canvas";
import type { ChangedField } from "@/lib/diff";
import { exportFramedPng } from "@/lib/export";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { NodeActionsContext, type NodeActions } from "@/lib/node-actions";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  buildMergedGraph,
  type MergedEdge,
  type MergedNode,
  type MergedNodeStatus,
} from "@/lib/merge-diff";

const nodeTypes: NodeTypes = { process: ProcessNode };

// passthrough-removed(양끝이 모두 유지 노드) 엣지 — 삽입 노드를 피해 우회하는 아크(red 점선). C2b.
// 삭제된 직접 연결이 새 경로(A→X→B)와 겹치지 않게 부풀린 베지어. 방향은 핸들 변으로 결정:
//   LR(bottom 핸들)=아래로 dip / TB(right 핸들)=오른쪽으로 bulge.
function RemovedArcEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, markerEnd, style,
}: EdgeProps) {
  const side = sourcePosition === Position.Right || sourcePosition === Position.Left;
  const path = side
    ? (() => {
        const bulge = Math.max(sourceX, targetX) + 52;
        return `M${sourceX},${sourceY} C${bulge},${sourceY} ${bulge},${targetY} ${targetX},${targetY}`;
      })()
    : (() => {
        const dip = Math.max(sourceY, targetY) + 52;
        return `M${sourceX},${sourceY} C${sourceX},${dip} ${targetX},${dip} ${targetX},${targetY}`;
      })();
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}

// 라벨 있는 일반 엣지 — smoothstep 경로 + HTML 라벨(EdgeLabelRenderer). 라벨 배경을 반투명+블러로 처리해
// 엣지 선이 라벨에서 "끊긴" 느낌을 줄이면서 글자 가독성 확보(SVG 라벨은 backdrop-blur 불가라 커스텀 처리).
function LabeledSmoothEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  label,
  markerEnd,
  style,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-xs px-1 text-fine text-ink-secondary"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "color-mix(in srgb, var(--color-surface) 55%, transparent)",
              backdropFilter: "blur(3px)",
              WebkitBackdropFilter: "blur(3px)",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes: EdgeTypes = { removedArc: RemovedArcEdge, labeled: LabeledSmoothEdge };

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
      // 비교 엣지는 전부 4변 핸들로 재매핑 — unchanged subprocess도 NodeHandles를 렌더해야 앵커됨 (F1)
      sideHandles: true,
    },
  }));
}

// spine(척추) 판정 — 유지 노드에서 시작해 "분기 없는 단일 연속" 링크로 이어지는 추가 노드(인라인 삽입)까지
// 확장. 선행 outDeg==1 → 후행도 spine, 후행 inDeg==1 → 선행도 spine. 분기/합류의 곁가지·삭제 노드는 제외.
// alignBackbone(직선화)·handleSides(진입 변)가 공유. removed 노드는 present에 없어 항상 off-spine.
function computeSpine(
  presentIds: Set<string>,
  keptIds: Set<string>,
  edges: { source: string; target: string }[],
): Set<string> {
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const edge of edges) {
    if (!presentIds.has(edge.source) || !presentIds.has(edge.target)) continue;
    outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
    inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
  }
  const spine = new Set<string>();
  for (const id of presentIds) if (keptIds.has(id)) spine.add(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (!presentIds.has(edge.source) || !presentIds.has(edge.target)) continue;
      if (spine.has(edge.source) && (outDeg.get(edge.source) ?? 0) === 1 && !spine.has(edge.target)) {
        spine.add(edge.target);
        grew = true;
      }
      if (spine.has(edge.target) && (inDeg.get(edge.target) ?? 0) === 1 && !spine.has(edge.source)) {
        spine.add(edge.source);
        grew = true;
      }
    }
  }
  return spine;
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

// 비교뷰 실측 렌더 폭 — TB에서 cross축(X) 정렬·핸들 중심 계산에 사용. nodeSizeOf는 dagre 박스라 실제와
// 다르다(process는 min-w-[150px]=150인데 nodeSizeOf=170 → TB 세로 엣지가 10px 꺾임). 실제 폭으로 계산해야
// handle X가 일치해 [D-U] 세로 엣지가 직선. process 150·terminal 90·decision 96·subprocess 180.
const COMPARE_RENDER_W: Record<string, number> = {
  process: 150,
  decision: 96,
  start: 90,
  end: 90,
  subprocess: 180,
};

// 백본(척추)을 흐름 수직축(cross)에 맞춰 직선화 — LR은 공통 Y, TB는 공통 X로 스냅.
// spine = 유지 노드 ∪ 인라인 삽입(분기 없는 단일 연속으로 이어지는 추가 노드). 병렬 곁가지는 제외.
// spine 노드가 있는 열/행은 그 노드를 backbone에 정확히 맞추고, 나머지 열/행은 최근접 spine shift로
// dagre 오프셋을 보존 → 병렬 곁가지는 라인 밖, 인라인 삽입은 라인 위로 정렬.
function alignBackbone(
  nodes: AppNode[],
  keptIds: Set<string>,
  dir: "LR" | "TB",
  spine: Set<string>,
): AppNode[] {
  const renderH = (node: AppNode) => COMPARE_RENDER_H[node.data.nodeType] ?? 38;
  const renderW = (node: AppNode) =>
    COMPARE_RENDER_W[node.data.nodeType] ?? nodeSizeOf(node.data.nodeType).w;
  // cross = 흐름에 수직인 축(정렬 대상), flow = 흐름 진행축(열/행 그룹 키). LR: cross=Y·flow=X, TB: 반대.
  const cross = (node: AppNode) =>
    dir === "LR" ? node.position.y + renderH(node) / 2 : node.position.x + renderW(node) / 2;
  const flow = (node: AppNode) =>
    dir === "LR" ? node.position.x + renderW(node) / 2 : node.position.y + renderH(node) / 2;
  const kept = nodes.filter((node) => keptIds.has(node.id));
  if (kept.length === 0) return nodes;
  const backboneCross = kept.reduce((sum, node) => sum + cross(node), 0) / kept.length;

  const flowKey = (node: AppNode) => Math.round(flow(node) / 10);
  const groups = new Map<number, AppNode[]>();
  for (const node of nodes) {
    const key = flowKey(node);
    const list = groups.get(key);
    if (list) list.push(node);
    else groups.set(key, [node]);
  }
  // spine 노드가 있는 열/행의 shift(그 노드를 backbone에 정확히 맞춤).
  const spineShift = new Map<number, number>();
  for (const [key, colNodes] of groups) {
    const anchor = colNodes.find((node) => spine.has(node.id));
    if (anchor) spineShift.set(key, backboneCross - cross(anchor));
  }
  // spine 없는 열/행(순수 곁가지)은 가장 가까운 spine 열의 shift를 적용 — 상대 오프셋 보존.
  const nearestSpineShift = (key: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (const [spineKey, shift] of spineShift) {
      const dist = Math.abs(spineKey - key);
      if (dist < bestDist) {
        bestDist = dist;
        best = shift;
      }
    }
    return best;
  };
  const shiftById = new Map<string, number>();
  for (const [key, colNodes] of groups) {
    const shift = spineShift.has(key) ? (spineShift.get(key) ?? 0) : nearestSpineShift(key);
    for (const node of colNodes) shiftById.set(node.id, shift);
  }
  // 곁가지(off-spine)는 라인에서 더 밀어낸다 — 라인에 붙어 있으면 병합 엣지가 마지막에 한 번 더 꺾인다.
  // 있던 방향(위/아래·좌/우)으로 BRANCH_PUSH만큼 추가 이격 → 엣지가 한 번만 꺾이게.
  const BRANCH_PUSH = 60;
  return nodes.map((node) => {
    let shift = shiftById.get(node.id) ?? 0;
    if (!spine.has(node.id)) {
      const resid = cross(node) + shift - backboneCross; // 정렬 후 backbone 기준 편차(부호=위/아래·좌/우)
      shift += resid < 0 ? -BRANCH_PUSH : BRANCH_PUSH;
    }
    return dir === "LR"
      ? { ...node, position: { x: node.position.x, y: node.position.y + shift } }
      : { ...node, position: { x: node.position.x + shift, y: node.position.y } };
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
      type: passthrough ? "removedArc" : "labeled",
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

// 좌하 범례 — 노드 diff 테두리 스타일(추가 실선·삭제 점선·변경 실선) + 건수(좌상 카운트 필과 통합).
function DiffLegend({ counts }: { counts: { added: number; removed: number; changed: number } }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5 text-caption text-ink-secondary" data-id="compare-legend">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-added" /> {t("compare.legendAdded")}
        <span className="font-semibold text-ink">{counts.added}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-dashed border-removed" />{" "}
        {t("compare.legendRemoved")}
        <span className="font-semibold text-ink">{counts.removed}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-changed" /> {t("compare.legendChanged")}
        <span className="font-semibold text-ink">{counts.changed}</span>
      </span>
    </div>
  );
}

// 우측 인스펙터 속성 행 — 라벨 좌·값 우측정렬. divide-y로 구분.
function InspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-20 shrink-0 text-fine text-ink-tertiary">{label}</span>
      <span className="min-w-0 flex-1 text-right text-caption text-ink-secondary">{children}</span>
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
  isEdge: boolean;
  status: MergedNodeStatus;
  title: string;
  detail?: string;
  fields?: DiffFieldRow[];
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
  // 변경 패널 필터 — 상태(all/추가/삭제/변경) + 종류(all/노드/엣지). 칩 클릭으로 목록 좁힘.
  const [filter, setFilter] = useState<"all" | "added" | "removed" | "changed">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "node" | "edge">("all");
  // 흐름 방향 — LR(좌→우, 기본) / TB(상→하). 맵이 한 축으로 너무 길 때 전환.
  const [flowDir, setFlowDir] = useState<"LR" | "TB">("LR");
  // 좌(변경 패널)·우(속성 인스펙터) 접힘 + 제목 드롭다운 — 에디터 헤더와 동일 위치의 토글.
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);

  const merged = useMemo(
    () => buildMergedGraph(baseGraph, targetGraph),
    [baseGraph, targetGraph],
  );

  // 유지(non-removed) 노드 계보키 — passthrough-removed 엣지(양끝 유지) 판정용.
  const keptKeys = useMemo(
    () => new Set(merged.nodes.filter((n) => n.status !== "removed").map((n) => n.id)),
    [merged],
  );

  // spine(척추) — 유지 노드 + 인라인 삽입. 직선화(alignBackbone)·진입 변(handleSides) 공유. removed는 off-spine.
  const spineIds = useMemo(() => {
    const present = new Set(
      merged.nodes.filter((n) => n.status !== "removed").map((n) => n.id),
    );
    const keptStatus = new Set(
      merged.nodes
        .filter((n) => n.status === "unchanged" || n.status === "changed")
        .map((n) => n.id),
    );
    const edges = merged.edges.filter((e) => e.status !== "removed");
    return computeSpine(present, keptStatus, edges);
  }, [merged]);

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
    // 전개방향(흐름축=ranksep) 간격을 촘촘히(한눈에), 수직축(nodesep)은 방향별로. TB는 좌우(nodesep)를
    // 조금 더 벌려 곁가지 구분. LR: nodesep 120·ranksep 120, TB: nodesep 120·ranksep 150.
    const spacing = flowDir === "TB" ? { nodesep: 120, ranksep: 150 } : { nodesep: 120, ranksep: 120 };
    const laid = layoutWithDagre(
      buildAppNodes(
        merged.nodes.filter((node) => node.status !== "removed"),
        noteOf,
        fieldsOf,
      ),
      buildAppEdges(layoutEdges, keptKeys),
      flowDir,
      spacing,
    );
    // 후처리 — 백본(유지+인라인 삽입=spine)을 공통 수직축으로 정렬(직선화 + 병렬 곁가지 라인 밖으로).
    const keptStatusIds = new Set(
      merged.nodes
        .filter((node) => node.status === "unchanged" || node.status === "changed")
        .map((node) => node.id),
    );
    const aligned = alignBackbone(laid, keptStatusIds, flowDir, spineIds);
    // 삭제 노드는 삭제 엣지 이웃(배치된 유지 노드)의 평균 위치에서 곁가지로 밀어낸다(본류 라인 비우기).
    // LR은 아래로(+y), TB는 오른쪽으로(+x) — 흐름축과 겹치지 않는 쪽.
    const posByKey = new Map(aligned.map((node) => [node.id, node.position]));
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
      return flowDir === "LR"
        ? { ...node, position: { x: ax, y: ay + 150 } }
        : { ...node, position: { x: ax + 220, y: ay } };
    });
    return [...aligned, ...removed];
  }, [merged, noteOf, fieldsOf, keptKeys, flowDir, spineIds]);

  // 레이아웃된 노드 중심 좌표 — 엣지 핸들 변 산정용. 실측 렌더 폭/높이(COMPARE_RENDER_*)로 계산해야
  // 핸들 중심이 실제와 일치(nodeSizeOf는 dagre 박스라 어긋남).
  const nodeCenters = useMemo(() => {
    const centers = new Map<string, { cx: number; cy: number }>();
    for (const node of positioned) {
      const type = node.data.nodeType;
      centers.set(node.id, {
        cx: node.position.x + (COMPARE_RENDER_W[type] ?? nodeSizeOf(type).w) / 2,
        cy: node.position.y + (COMPARE_RENDER_H[type] ?? 38) / 2,
      });
    }
    return centers;
  }, [positioned]);


  // 엣지별 붙을 변(핸들) — 의미상 정해진 변을 각 끝에 "직접" 배정(핸들 공유 허용). 이전의 4변 그리디 회피는
  // 결제처리처럼 엣지가 많은 노드(있음·곁가지 2개·다음·재시도=5개)에서 곁가지를 반대편(아래)으로 밀어 꼬았음.
  //  · passthrough(삭제 직접연결)=우회 변(LR bottom / TB right), 역행 루프(back)=우회 변(LR top / TB left)
  //  · 그 외: 곁가지(off-spine) 노드 자신=흐름축 변(이전=뒤·다음=앞), 본류(spine)↔곁가지=본류가 cross측 변,
  //    둘 다 spine=흐름축. → 위 곁가지는 본류에 top으로, 아래 삭제 노드는 bottom으로(재시도와 top 공유 무방).
  const handleSides = useMemo(() => {
    const arcSide: HandleSide = flowDir === "LR" ? "bottom" : "right";
    const backSide: HandleSide = flowDir === "LR" ? "top" : "left";
    const result = new Map<string, { source: HandleSide; target: HandleSide }>();
    for (const edge of merged.edges) {
      const s = nodeCenters.get(edge.source);
      const t = nodeCenters.get(edge.target);
      const passthrough =
        edge.status === "removed" && keptKeys.has(edge.source) && keptKeys.has(edge.target);
      // 흐름 역행 루프 — LR은 타겟이 왼쪽(뒤로), TB는 타겟이 위로(뒤로) & 반대축 이동 작을 때만.
      const back =
        !passthrough && !!s && !!t &&
        (flowDir === "LR"
          ? t.cx < s.cx - 40 && Math.abs(t.cy - s.cy) < 150
          : t.cy < s.cy - 40 && Math.abs(t.cx - s.cx) < 150);
      // 한 끝의 변 — thisC/thisId=이 끝 노드, otherC/otherId=반대 끝 노드.
      const sideFor = (
        thisC: { cx: number; cy: number } | undefined,
        otherC: { cx: number; cy: number } | undefined,
        thisId: string,
        otherId: string,
      ): HandleSide => {
        if (passthrough) return arcSide;
        if (back) return backSide;
        if (!thisC || !otherC) return flowDir === "LR" ? "right" : "bottom";
        const dx = otherC.cx - thisC.cx;
        const dy = otherC.cy - thisC.cy;
        const flowSide: HandleSide =
          flowDir === "LR" ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
        const crossSide: HandleSide =
          flowDir === "LR" ? (dy < 0 ? "top" : "bottom") : dx < 0 ? "left" : "right";
        return spineIds.has(thisId) && !spineIds.has(otherId) ? crossSide : flowSide;
      };
      result.set(edge.id, {
        source: sideFor(s, t, edge.source, edge.target),
        target: sideFor(t, s, edge.target, edge.source),
      });
    }
    return result;
  }, [merged, keptKeys, nodeCenters, flowDir, spineIds]);

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
        // handleSides가 정한 변으로 핸들 지정. 비교뷰 하위프로세스 노드는 4변 핸들(NodeHandles)을 렌더하므로
        // 편집기용 전용 핸들 remap(withSubprocessHandles)은 쓰지 않는다(TB에서 상/하 진입이 막히던 원인).
        const sides = handleSides.get(edge.id);
        if (sides) {
          styled = {
            ...styled,
            sourceHandle: sourceHandleId(sides.source),
            targetHandle: targetHandleId(sides.target),
          };
        }
        if (focusId === edge.id) {
          styled = { ...styled, selected: true, style: { ...(styled.style ?? {}), strokeWidth: 3 } };
        }
        return styled;
      }),
    [merged, focusId, keptKeys, handleSides],
  );

  const titleByKey = useMemo(
    () => new Map(merged.nodes.map((m) => [m.id, m.node.title])),
    [merged],
  );

  // 변경 항목(패널) — 목업 순서: 추가 노드→추가 엣지→삭제 노드→삭제 엣지→변경 노드.
  // 변경 노드는 before→after 필 포함, 엣지는 방향 문자열 + "Edge added/removed" 설명.
  const changeItems: ChangeItem[] = useMemo(() => {
    const nodeItems: ChangeItem[] = merged.nodes
      .filter((m) => m.status !== "unchanged")
      .map((m) => ({
        key: `n-${m.id}`,
        focusId: m.id,
        isEdge: false,
        status: m.status,
        title: m.node.title,
        fields:
          m.status === "changed"
            ? m.fieldChanges.map((fc) => ({
                label: t(FIELD_MSG[fc.field]),
                before: fc.before || t("summary.none"),
                after: fc.after || t("summary.none"),
              }))
            : undefined,
      }));
    // 노드 추가/삭제로 딸려온 엣지는 제외 — 양끝이 모두 "기존"(양 버전 존재=unchanged/changed) 노드인,
    // 즉 실제 배선(선 연결) 변경만 목록에 남긴다. 새/삭제 노드에 붙은 엣지는 노드 항목으로 이미 드러남.
    const bothVersion = new Set(
      merged.nodes
        .filter((n) => n.status === "unchanged" || n.status === "changed")
        .map((n) => n.id),
    );
    const edgeItems: ChangeItem[] = merged.edges
      .filter(
        (e) => e.status !== "unchanged" && bothVersion.has(e.source) && bothVersion.has(e.target),
      )
      .map((e) => ({
        key: `e-${e.id}`,
        focusId: e.id,
        isEdge: true,
        status: e.status,
        title: `${titleByKey.get(e.source) ?? "?"} → ${titleByKey.get(e.target) ?? "?"}`,
        detail: e.status === "added" ? t("compare.edgeAdded") : t("compare.edgeRemoved"),
      }));
    const pick = (items: ChangeItem[], status: MergedNodeStatus) =>
      items.filter((i) => i.status === status);
    return [
      ...pick(nodeItems, "added"),
      ...pick(edgeItems, "added"),
      ...pick(nodeItems, "removed"),
      ...pick(edgeItems, "removed"),
      ...pick(nodeItems, "changed"),
    ];
  }, [merged, titleByKey, t]);

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

  // 병합 캔버스를 PNG로 저장 — 저장 노드 범위를 1600×1000에 맞춰 렌더(공용 export, png-export 보정 포함).
  const handleExport = useCallback(() => {
    void exportFramedPng(flow.getNodes(), `${mapName}-compare.png`, {
      width: 1600,
      height: 1000,
      minZoom: 0.5,
      backgroundColor: "#F6F6F8", // bg-canvas — export 배경(데이터/출력 예외, design.md §1)
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
  // 항목 앞 아이콘(색상 사각) — 추가 ＋ / 삭제 − / 변경 ✎.
  const iconBg: Record<MergedNodeStatus, string> = {
    added: "bg-added",
    removed: "bg-removed",
    changed: "bg-changed",
    unchanged: "",
  };
  const statusIcon = (status: MergedNodeStatus) =>
    status === "added" ? (
      <Plus size={12} strokeWidth={2.5} />
    ) : status === "removed" ? (
      <Minus size={12} strokeWidth={2.5} />
    ) : (
      <Pencil size={11} strokeWidth={2} />
    );

  const hasChanges = changeItems.length > 0;

  // 좌상 카운트 필 + 패널 필터칩 — 노드+엣지를 status별 집계(엣지 추가/삭제 포함, 변경은 노드만).
  const counts = useMemo(() => {
    const acc = { added: 0, removed: 0, changed: 0 };
    for (const item of changeItems) {
      if (item.status === "added" || item.status === "removed" || item.status === "changed") {
        acc[item.status] += 1;
      }
    }
    return acc;
  }, [changeItems]);

  const kindCounts = useMemo(
    () => ({
      node: changeItems.filter((i) => !i.isEdge).length,
      edge: changeItems.filter((i) => i.isEdge).length,
    }),
    [changeItems],
  );

  const filteredChanges = useMemo(
    () =>
      changeItems.filter(
        (i) =>
          (filter === "all" || i.status === filter) &&
          (kindFilter === "all" || (kindFilter === "edge") === i.isEdge),
      ),
    [changeItems, filter, kindFilter],
  );
  // 25개씩 증분 렌더 — 대형 맵 비교에서 변경 목록 전량 렌더 부하 방지
  const {
    visible: shownChanges,
    hasMore: hasMoreChanges,
    sentinelRef: changesSentinelRef,
  } = useInfiniteSlice(filteredChanges, `${filter}:${kindFilter}`);

  // 우측 인스펙터 대상 — 포커스된 id가 노드면 그 노드(엣지면 null → 빈 상태).
  const selectedNode = useMemo(
    () => merged.nodes.find((n) => n.id === focusId) ?? null,
    [merged, focusId],
  );

  // Tab 이동용 흐름 엣지 — 삭제 제외(현재 To-Be 흐름). getNextNodeAlongFlow는 source/target만 읽음.
  const flowEdges = useMemo(
    () =>
      merged.edges
        .filter((e) => e.status !== "removed")
        .map((e) => ({ id: e.id, source: e.source, target: e.target })) as Edge[],
    [merged],
  );

  // Tab / Shift+Tab — 흐름상 다음/이전 노드로 포커스 이동(+화면 중앙). 입력 중엔 제외. 미선택 시 시작 노드.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Tab은 캔버스 내비로 가로챈다 — 브라우저 기본 포커스 이동(패널 버튼 순회) 방지.
      e.preventDefault();
      // 클릭했던 패널 버튼이 포커스를 쥔 채 Tab→focus-visible 파란 아웃라인이 남는 것 제거.
      (document.activeElement as HTMLElement | null)?.blur?.();
      const current = focusId && positioned.some((n) => n.id === focusId) ? focusId : null;
      let target: string | null;
      if (!current) {
        // 미선택(또는 엣지 포커스) — 흐름 시작(입력 엣지 없는 노드)으로.
        const incoming = new Set(flowEdges.map((edge) => edge.target));
        target = positioned.find((n) => !incoming.has(n.id))?.id ?? positioned[0]?.id ?? null;
      } else {
        target = e.shiftKey
          ? getPrevNodeAlongFlow(flowEdges, current)
          : getNextNodeAlongFlow(flowEdges, current);
      }
      if (!target) return;
      setFocusId(target);
      const node = positioned.find((n) => n.id === target);
      if (node) {
        const size = nodeSizeOf(node.data.nodeType);
        void flow.setCenter(node.position.x + size.w / 2, node.position.y + size.h / 2, {
          duration: 350,
          zoom: flow.getZoom(),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flowEdges, focusId, positioned, flow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 메인 캔버스 스타일 참고 — 노드 핸들(히트박스) 숨김 + 노드 호버 시 자기색 강조 링(bpm-node-emph).
          Turbopack이 dev에서 .react-flow__node 셀렉터 규칙을 purge해 raw <style>로 둔다(lessons canvas §5). */}
      <style>{`
.react-flow__handle{opacity:0}
.react-flow__node:hover .bpm-node-emph{box-shadow:0 0 0 3px color-mix(in srgb,var(--nc) 42%,transparent)}
.react-flow__node{z-index:2 !important}
      `}</style>
      <header className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        {/* 좌: 좌측 패널 접기(에디터 PanelLeft 위치) · 제목 드롭다운(누르면 에디터로) · Version compare */}
        <button
          type="button"
          onClick={() => setLeftCollapsed((v) => !v)}
          title={t(leftCollapsed ? "sidebar.expand" : "sidebar.collapse")}
          aria-label={t(leftCollapsed ? "sidebar.expand" : "sidebar.collapse")}
          className="inline-flex items-center justify-center rounded-sm p-1.5 text-ink-secondary hover:bg-surface-alt"
        >
          <PanelLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setTitleMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption font-medium text-ink hover:bg-surface-alt"
          >
            <span className="max-w-[16rem] truncate">{mapName}</span>
            <ChevronDown size={14} strokeWidth={1.5} className="text-ink-tertiary" />
          </button>
          {titleMenuOpen && (
            <>
              <div className="fixed inset-0 z-[1000]" onClick={() => setTitleMenuOpen(false)} />
              <div className="absolute left-0 z-[1001] mt-1 w-56 rounded-md border border-hairline bg-surface py-1 shadow-lg">
                <Link
                  href={`/maps/${mapId}`}
                  onClick={() => setTitleMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                >
                  <ArrowLeft size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                  {t("compare.editorLink")}
                </Link>
              </div>
            </>
          )}
        </div>
        <span className="text-caption text-ink-tertiary">{t("compare.title")}</span>
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
            onClick={() => setFlowDir((dir) => (dir === "LR" ? "TB" : "LR"))}
            title={t(flowDir === "LR" ? "compare.layoutVertical" : "compare.layoutHorizontal")}
            aria-label={t(flowDir === "LR" ? "compare.layoutVertical" : "compare.layoutHorizontal")}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-hairline text-ink-secondary hover:bg-surface-alt"
          >
            {flowDir === "LR" ? (
              <MoveVertical size={14} strokeWidth={1.5} />
            ) : (
              <MoveHorizontal size={14} strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-hairline px-3 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            <Download size={14} strokeWidth={1.5} />
            {t("compare.export")}
          </button>
          <button
            type="button"
            onClick={() => setInspectorOpen((open) => !open)}
            title={t("compare.inspectorToggle")}
            aria-label={t("compare.inspectorToggle")}
            className="inline-flex items-center justify-center rounded-sm p-1.5 text-ink-secondary hover:bg-surface-alt"
          >
            <PanelRight size={16} strokeWidth={1.5} />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {!leftCollapsed && (
        <aside
          className="flex w-72 shrink-0 flex-col border-r border-hairline bg-surface"
          data-id="compare-changes"
        >
          <div className="flex items-center justify-between px-3 pb-2 pt-3">
            <h2 className="text-body-strong text-ink">{t("compare.changes")}</h2>
            <span className="text-caption text-ink-tertiary">{changeItems.length}</span>
          </div>
          {hasChanges && (
            <div className="flex flex-col gap-1.5 border-b border-hairline px-3 pb-2">
              {/* 상태 필터 — 전체/추가/삭제/변경(상태 색점+건수) */}
              <div className="flex gap-1.5">
                {(
                  [
                    { key: "all", label: t("compare.filterAll"), count: changeItems.length, dot: "" },
                    { key: "added", label: "", count: counts.added, dot: "bg-added" },
                    { key: "removed", label: "", count: counts.removed, dot: "bg-removed" },
                    { key: "changed", label: "", count: counts.changed, dot: "bg-changed" },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setFilter(chip.key)}
                    className={`flex h-6 items-center gap-1.5 rounded-full border px-2 text-fine ${
                      filter === chip.key
                        ? "border-accent-tint-border bg-accent-tint text-accent"
                        : "border-hairline text-ink-secondary hover:bg-surface-alt"
                    }`}
                  >
                    {chip.dot && <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} />}
                    {chip.label && <span>{chip.label}</span>}
                    <span className="font-semibold">{chip.count}</span>
                  </button>
                ))}
              </div>
              {/* 종류 필터 — 모두/노드만/엣지만 */}
              <div className="flex gap-1.5">
                {(
                  [
                    { key: "all", label: t("compare.kindAll"), count: changeItems.length },
                    { key: "node", label: t("compare.kindNodes"), count: kindCounts.node },
                    { key: "edge", label: t("compare.kindEdges"), count: kindCounts.edge },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setKindFilter(chip.key)}
                    className={`flex h-6 items-center gap-1.5 rounded-full border px-2 text-fine ${
                      kindFilter === chip.key
                        ? "border-accent-tint-border bg-accent-tint text-accent"
                        : "border-hairline text-ink-secondary hover:bg-surface-alt"
                    }`}
                  >
                    <span>{chip.label}</span>
                    <span className="font-semibold">{chip.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {!hasChanges ? (
              <div className="px-1.5 py-1 text-caption text-ink-tertiary">
                {t("compare.identical")}
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {shownChanges.map((item) => {
                  const selected = focusId === item.focusId;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => {
                          if (item.isEdge) {
                            const edge = merged.edges.find((e) => e.id === item.focusId);
                            if (edge) focusEdge(edge);
                          } else {
                            focusNode(item.focusId);
                          }
                        }}
                        className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left ${
                          selected ? "bg-accent-tint" : "hover:bg-surface-alt"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-on-accent ${iconBg[item.status]}`}
                        >
                          {statusIcon(item.status)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-caption-strong text-ink">{item.title}</span>
                            <span
                              className={`rounded-full px-1.5 text-fine font-semibold ${badgeClass[item.status]}`}
                            >
                              {badgeLabel[item.status]}
                            </span>
                          </span>
                          {item.fields && item.fields.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {item.fields.map((f) => (
                                <span
                                  key={f.label}
                                  className="flex items-center gap-1 rounded-xs border border-changed/30 bg-changed/10 px-1 text-fine"
                                >
                                  <span className="font-semibold text-changed">{f.label}</span>
                                  <span className="text-ink-muted">{f.before}</span>
                                  <span className="text-ink-tertiary">→</span>
                                  <span className="font-semibold text-ink">{f.after}</span>
                                </span>
                              ))}
                            </span>
                          )}
                          {item.detail && (
                            <span className="mt-0.5 block text-fine text-ink-tertiary">
                              {item.detail}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {hasMoreChanges && <li ref={changesSentinelRef} className="h-px shrink-0" />}
              </ul>
            )}
          </div>
        </aside>
        )}
        <div className="relative min-w-0 flex-1 overflow-hidden bg-canvas" data-id="compare-canvas">
          {/* Compare View 워터마크 — 읽기전용 인지(에디터 read-only 워터마크 재활용, dot-grid 대체).
              z-[4]로 노드(z-2) 위에 덮되 opacity .14로 투과 — 에디터 워터마크와 동일. */}
          <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center overflow-hidden">
            <span className="-rotate-[18deg] select-none whitespace-nowrap text-[120px] font-semibold uppercase tracking-widest text-accent opacity-[0.14]">
              {t("compare.watermark")}
            </span>
          </div>
          <NodeActionsContext.Provider value={COMPARE_NODE_ACTIONS}>
          <ReactFlow
            key={flowDir}
            nodes={laidNodes}
            edges={appEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            fitView
            minZoom={0.2}
            onNodeClick={(_, node) => setFocusId(node.id)}
            onEdgeClick={(_, edge) => setFocusId(edge.id)}
            /* 에디터와 동일한 휠/팬 맵핑 — 휠=상하·좌우 팬, Ctrl/⌘+휠=줌, 좌클릭·Space 드래그=팬(그랩). */
            panOnDrag
            panActivationKeyCode="Space"
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomActivationKeyCode={["Control", "Meta"]}
          >
            {/* 선택 노드 위로 슬라이드하는 포커스 링(에디터와 동일 — ViewportPortal로 flow 좌표 정합) */}
            <ViewportPortal>
              <NodeSelectionRing />
            </ViewportPortal>
            {/* dot-grid 제거 · 좌상 카운트 필 제거(좌하 범례로 통합) */}
            <Panel
              position="bottom-left"
              className="rounded-sm border border-hairline bg-surface/80 px-2.5 py-1.5 shadow-sm backdrop-blur-sm"
            >
              <DiffLegend counts={counts} />
            </Panel>
            <Panel position="bottom-right">
              <ZoomBar />
            </Panel>
          </ReactFlow>
          </NodeActionsContext.Provider>
        </div>
        {inspectorOpen && (
          <aside
            className="flex w-72 shrink-0 flex-col border-l border-hairline bg-surface"
            data-id="compare-inspector"
          >
            <div className="flex items-center justify-between border-b border-hairline px-3 pb-2 pt-3">
              <h2 className="text-body-strong text-ink">{t("compare.properties")}</h2>
              <span className="inline-flex items-center gap-1 rounded-sm bg-surface-alt px-2 py-0.5 text-fine font-semibold text-ink-secondary">
                <Lock size={12} strokeWidth={1.7} />
                {t("compare.viewOnly")}
              </span>
            </div>
            {!selectedNode ? (
              <div className="px-3 py-3 text-caption text-ink-tertiary">
                {t("compare.selectNode")}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
                <div>
                  <div className="mb-1 text-fine text-ink-tertiary">{t(FIELD_MSG.title)}</div>
                  <div className="rounded-sm bg-surface-alt px-2 py-1.5 text-caption text-ink-secondary">
                    {selectedNode.node.title || t("summary.none")}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-fine text-ink-tertiary">{t(FIELD_MSG.description)}</div>
                  <div className="min-h-[2rem] whitespace-pre-wrap rounded-sm bg-surface-alt px-2 py-1.5 text-caption leading-relaxed text-ink-tertiary">
                    {selectedNode.node.description || t("summary.none")}
                  </div>
                </div>
                <div className="divide-y divide-divider">
                  <InspectorRow label={t(FIELD_MSG.type)}>
                    {t(`nodeType.${normalizeNodeType(selectedNode.node.node_type)}` as MessageKey)}
                  </InspectorRow>
                  <InspectorRow label={t(FIELD_MSG.color)}>
                    {selectedNode.node.color ? (
                      <span
                        className="inline-block h-5 w-5 rounded-[5px] border align-middle"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${selectedNode.node.color} 18%, white)`,
                          borderColor: selectedNode.node.color,
                        }}
                      />
                    ) : (
                      <span className="text-ink-tertiary">{t("summary.none")}</span>
                    )}
                  </InspectorRow>
                  {(["assignee", "department", "system", "duration"] as const).map((key) => {
                    const change = selectedNode.fieldChanges.find((fc) => fc.field === key);
                    const current = selectedNode.node[key] || "";
                    return (
                      <InspectorRow key={key} label={t(FIELD_MSG[key])}>
                        {change ? (
                          <>
                            <span className="text-ink-muted line-through">
                              {change.before || t("summary.none")}
                            </span>
                            <span className="mx-1 text-ink-tertiary">→</span>
                            <span className="font-semibold text-changed">
                              {change.after || t("summary.none")}
                            </span>
                          </>
                        ) : (
                          <span className={current ? "text-ink-secondary" : "text-ink-tertiary"}>
                            {current || t("summary.none")}
                          </span>
                        )}
                      </InspectorRow>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        )}
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
