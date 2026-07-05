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
  Position,
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
  MoveHorizontal,
  MoveVertical,
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
  const renderW = (node: AppNode) => nodeSizeOf(node.data.nodeType).w;
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
  // 흐름 방향 — LR(좌→우, 기본) / TB(상→하). 맵이 한 축으로 너무 길 때 전환.
  const [flowDir, setFlowDir] = useState<"LR" | "TB">("LR");

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
            key={flowDir}
            nodes={laidNodes}
            edges={appEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
            minZoom={0.2}
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
